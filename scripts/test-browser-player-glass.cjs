const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
let blocked = false, draws = 0, samples = 0, reads = 0, mutation;
const callbacks = new Map(), events = new Map(), contexts = [];
let id = 0;
const props = new Map(), attrs = new Map(), children = [], skipChildren = [];
const skipAttrs = new Map([['data-player-skip', '']]);
let surfaceLeft = 10;
const surface = {
  clientLeft: 0, clientTop: 0,
  matches: selector => selector === '[data-player-selection-drawer]' && attrs.has('data-player-selection-drawer'),
  getAnimations: () => [],
  style: { setProperty: (k,v) => props.set(k,v), removeProperty: k => props.delete(k) },
  hasAttribute: k => attrs.has(k), getAttribute: k => attrs.get(k),
  setAttribute: (k,v) => attrs.set(k,v), removeAttribute: k => attrs.delete(k),
  getClientRects: () => [1], getBoundingClientRect: () => { reads++; return { left: surfaceLeft, top: 20 }; },
  appendChild(canvas) {
    assert.ok(attrs.has('data-browser-glass'), 'Glass positioning must be active before inserting the canvas');
    assert.ok(canvas.getContext('2d', { colorSpace: 'srgb' }).lastDraw, 'The inserted canvas already has pixels');
    children.push(canvas);
  },
};
function makeCanvas() {
  const context = { filter: 'none', lastDraw: null, fillRect() {}, putImageData() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    drawImage(...args) { this.lastDraw = args; draws++; if (args[0] instanceof Video) samples++; if (blocked) throw Error('SecurityError'); } };
  contexts.push(context);
  return { width: 0, height: 0, style: {}, setAttribute() {}, remove() { for (const layers of [children, skipChildren]) { const at = layers.indexOf(this); if (at >= 0) layers.splice(at, 1); } },
    getContext: (_, options) => { assert.equal(options.colorSpace, 'srgb'); return context; },
    toDataURL() { throw Error('Live glass must never JPEG-encode or read back video pixels'); } };
}
const skip = {
  ...surface,
  style: { setProperty() {}, removeProperty() {} },
  setAttribute: (key, value) => skipAttrs.set(key, value),
  removeAttribute: key => skipAttrs.delete(key),
  hasAttribute: key => skipAttrs.has(key),
  getAttribute: key => skipAttrs.get(key),
  appendChild(canvas) { skipChildren.push(canvas); },
};
const doc = { hidden: false, body: {}, querySelectorAll: () => [surface, skip], createElement: makeCanvas,
  addEventListener: (k,v) => events.set(k,v), removeEventListener: k => events.delete(k) };
class Video extends EventTarget {
  readyState = 2; videoWidth = 3840; videoHeight = 2160; paused = false;
  getBoundingClientRect() { reads++; return { left: 0, top: 0, width: 1000, height: 500 }; }
  requestVideoFrameCallback(fn) { callbacks.set(++id, fn); return id; }
  cancelVideoFrameCallback(key) { callbacks.delete(key); }
}
const context = { exports: {}, document: doc,
  window: { innerWidth: 1000, innerHeight: 500, addEventListener: (k,v) => events.set(k,v), removeEventListener: k => events.delete(k) },
  getComputedStyle: node => (node === surface || node === skip) ? { visibility: attrs.has('hidden') ? 'hidden' : 'visible', backgroundColor: 'rgba(0,0,0,.64)', backgroundImage: 'none' } : { objectFit: 'contain' },
  MutationObserver: class { constructor(fn) { mutation = fn; } observe() {} disconnect() {} },
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/media/browser-player-glass.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, context);
const tick = time => { const queued = [...callbacks.values()]; callbacks.clear(); for (const fn of queued) fn(time, {}); };
const video = new Video();
video.readyState = 1;
let cleanup = context.exports.attachBrowserPlayerGlass(video);
assert.equal(children.length, 0, 'An empty canvas must not enter the button’s flex layout before the first video frame');
assert.equal(attrs.has('data-browser-glass'), false, 'Use the fallback material while the first frame is unavailable');
video.readyState = 2;
video.dispatchEvent(new Event('loadeddata'));
assert.ok(attrs.has('data-browser-glass'), 'Both SDR and HDR have glass, without depending on HDR metadata support');
assert.equal(children.length, 1, 'The surface displays a live canvas rather than a repeatedly encoded background image');
assert.equal(props.get('--browser-glass-x'), '-10px');
assert.equal(props.get('--browser-glass-y'), '-20px');
const frame = children[0], skipFrame = skipChildren[0];
assert.ok(skipAttrs.has('data-browser-glass') && skipFrame, 'Skip uses a sampled video blur');
assert.ok(frame.width <= 640 && frame.height <= 360);
const master = contexts.find(c => c.lastDraw?.[0] === video);
assert.ok(master.lastDraw[1] > 0 && master.lastDraw[3] < frame.width, 'Fit mode keeps the same black bars as playback');
const before = draws, beforeReads = reads;
for (const time of [0, 16, 33, 50, 66, 83]) tick(time);
assert.equal(draws - before, 18, 'Every presented frame updates the shared bitmap and visible canvas; there is no 250ms gate');
assert.equal(reads, beforeReads, 'Frame updates must not measure layout');
const beforeMutation = samples;
mutation([]); mutation([]);
assert.equal(samples, beforeMutation, 'DOM changes reuse the latest pixels');
video.paused = true;
video.dispatchEvent(new Event('pause'));
assert.equal(callbacks.size, 0, 'Pause stops requesting video frames');
assert.ok(attrs.has('data-browser-glass'), 'Pause keeps the visible glass');
assert.equal(skipChildren[0], skipFrame, 'Pausing retains the Skip blur layer');
attrs.set('hidden', ''); mutation([]);
attrs.delete('hidden'); mutation([]);
assert.equal(samples, beforeMutation, 'A control that reappears while paused reuses the displayed frame');
video.dispatchEvent(new Event('seeked'));
assert.equal(samples, beforeMutation + 1, 'A paused seek refreshes the glass once');
assert.equal(callbacks.size, 0, 'A paused seek does not restart frame requests');
video.paused = false;
video.dispatchEvent(new Event('playing'));
assert.equal(callbacks.size, 1, 'Playing resumes frame requests');
assert.equal(skipChildren[0], skipFrame, 'Resuming retains the same Skip blur layer');
assert.equal(samples, beforeMutation + 2, 'Resume refreshes the blur immediately');
tick(100);
assert.equal(samples, beforeMutation + 3, 'The next presented frame continues live blur');
attrs.set('hidden', ''); mutation([]); assert.equal(callbacks.size, 0);
attrs.delete('hidden'); mutation([]); assert.equal(callbacks.size, 1);
doc.hidden = true; events.get('visibilitychange')(); assert.equal(callbacks.size, 0);
cleanup();
assert.equal(children.length, 0); assert.equal(skipChildren.length, 0); assert.equal(props.size, 0); assert.equal(attrs.has('data-browser-glass'), false); assert.equal(events.size, 0);
doc.hidden = false; blocked = true;
cleanup = context.exports.attachBrowserPlayerGlass(new Video());
assert.equal(attrs.has('data-browser-glass'), false, 'Protected frames retain CSS glass without a failing capture loop');
assert.equal(callbacks.size, 0); cleanup(); assert.equal(props.size, 0); assert.equal(children.length, 0);
console.log('PASS: SDR/HDR live canvas glass, presentation-rate updates without JPEG/readback/layout, demand cancellation and cleanup');
const postcss = require('postcss');
const css = postcss.parse(fs.readFileSync('components/player-mobile.css', 'utf8'));
const glassTint = css.nodes.find(rule => rule.selector === '[data-browser-glass]::after');
assert.equal(glassTint.nodes.find(node => node.prop === 'background-color').value,
  'var(--player-glass-interaction-color, var(--player-glass-color, var(--browser-glass-color)))',
  'Live hover tint must reach the displayed canvas overlay instead of being trapped behind its captured initial color');
const nativeTint = css.nodes.find(rule => rule.selector === '[data-native-glass]::after');
assert.equal(nativeTint.nodes.find(node => node.prop === 'background-color').value,
  'var(--player-glass-interaction-color, var(--player-glass-color))', 'Native glass uses the same live interaction tint');
let alignment;
css.walkRules(rule => { if (rule.selector === '[data-slot="media-player-seek-tooltip"][data-browser-glass] > [data-browser-glass-frame]') alignment = rule; });
assert.ok(alignment);
assert.equal(alignment.nodes.find(node => node.prop === 'left').value, 'calc(50% - var(--seek-tooltip-x))');
assert.equal(alignment.nodes.find(node => node.prop === 'top').value, 'calc(100% - var(--seek-tooltip-y) + var(--seek-tooltip-side-offset, 0px))');
for (let x = 140; x < 1800; x += 7) {
  const width = 232, height = 150, y = 860, offset = 12;
  assert.equal(x - width / 2 + width / 2 - x, 0);
  assert.equal(y - height - offset + height - y + offset, 0);
}
console.log('PASS: moving and paused seek glass stays aligned through CSS coordinates, independent of frame capture');

blocked = false;
const gpuPicture = makeCanvas(), gpuVideo = new Video();
gpuVideo.webgpu = { picture: () => gpuPicture };
cleanup = context.exports.attachBrowserPlayerGlass(gpuVideo);
const gpuMaster = contexts.find(context => context.lastDraw?.[0] === gpuPicture);
assert.ok(gpuMaster, 'GPU glass samples the presented canvas instead of the source-less video');
assert.deepEqual(gpuMaster.lastDraw.slice(1), [0, 0, 640, 320], 'Do not apply letterboxing twice to a framed GPU canvas');
callbacks.clear(); delete gpuVideo.webgpu;
gpuVideo.dispatchEvent(new Event('loadeddata'));
assert.equal(callbacks.size, 1, 'Same-file fallback starts a new frame subscription');
cleanup();
console.log('PASS: GPU canvas glass, preserved framing, and native frame subscription after fallback');

const windows = { ...context, exports: {},
  requestAnimationFrame: callback => { callbacks.set(++id, callback); return id; },
  cancelAnimationFrame: key => callbacks.delete(key),
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/desktop/windows-player-glass.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, windows);
let receive;
attrs.set('data-player-selection-drawer', '');
attrs.set('data-swiping', '');
surface.clientLeft = 1;
cleanup = windows.exports.attachWindowsPlayerGlass({
  send() {},
  subscribe(callback) { receive = callback; return () => {}; },
}, 'episode');
assert.equal(children.length, 0, 'The desktop button also waits for a painted canvas');
assert.equal(attrs.has('data-browser-glass'), false);
receive({ type: 'glass-pixels', session: 'episode', frame: { width: 2, height: 2 } });
assert.equal(children.length, 1);
assert.ok(attrs.has('data-browser-glass'));
surfaceLeft = 23;
tick(1);
assert.equal(props.get('--browser-glass-x'), '-24px', 'A moving drawer follows the viewport without a new native video frame');
attrs.delete('data-swiping');
tick(2);
assert.equal(callbacks.size, 0, 'Stop measuring when the drawer stops moving');
cleanup();
assert.equal(children.length, 0);
assert.equal(attrs.has('data-browser-glass'), false);
console.log('PASS: browser and Windows glass render their first sampled canvas without adding an unpainted layout child');
