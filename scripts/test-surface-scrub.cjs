// Exercise the real SeekPreview entry point with a deterministic moving finger.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
let now = 1000, id = 0, cursor = 0, dirty = false;
const hooks = [], timers = new Map(), effects = [];
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const react = {
  useRef(initial) { const index = cursor++; hooks[index] ??= { current: initial }; return hooks[index]; },
  useCallback(fn) { cursor++; return fn; },
  useState(initial) {
    const index = cursor++;
    hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial };
    return [hooks[index].value, value => {
      const next = typeof value === 'function' ? value(hooks[index].value) : value;
      if (!Object.is(next, hooks[index].value)) { hooks[index].value = next; dirty = true; }
    }];
  },
  useLayoutEffect(effect, deps) {
    const index = cursor++, previous = hooks[index];
    if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); hooks[index] = { deps, cleanup: effect() }; });
  },
};
const previewModule = { exports: {}, setTimeout, clearTimeout };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/media/preview-frames.ts','utf8'), {
  compilerOptions: {target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText, previewModule);
const context = { window: { navigatorDesktop: { platform: 'android' } }, exports: {}, setTimeout(fn, delay) { timers.set(++id, { fn, at: now + delay }); return id; }, clearTimeout(id) { timers.delete(id); }, require(name) {
  if (name.includes('preview-frames')) return { ...previewModule.exports, PreviewScheduler: class { want() {} cancel() {} } };
  if (name === 'react') return react;
  if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  return {};
} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/seek-preview.tsx', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText, context);
let sourceComponent;
let time = 10, active = true, deferWhileMoving = true, source = 'https://video.test/a.mkv';
const media = { getAttribute: () => source };
function render() {
  let node, rounds = 0;
  do {
    assert.ok(++rounds < 20, 'Layout effects must settle without a render loop');
    dirty = false; cursor = 0;
    node = context.exports.SeekPreview({ media, time, duration: 1200, active, deferWhileMoving });
    sourceComponent = node.type;
    while (effects.length) effects.shift()();
  } while (dirty);
  return node.props;
}
function advance(ms) {
  now += ms;
  for (const [key, task] of [...timers]) if (task.at <= now) { timers.delete(key); task.fn(); }
}
const anchor = time;
assert.equal(render().active, false, 'Initial extraction briefly waits for a stable neighborhood');
for (let step = 0; step < 6; step++) {
  time += .05; advance(16);
  assert.equal(render().active, false);
}
advance(4);
assert.equal(render().active, true, 'Finger tremor cannot starve extraction: start after 100ms despite fine movement');
for (let step = 0; step < 20; step++) {
  time += .05; advance(16);
  const preview = render();
  assert.equal(preview.active, true, 'Small movements must not cancel a pending decoder request');
  assert.equal(preview.time, anchor, 'Fine scrubbing reuses the same preview target');
}
time = anchor + 1;
assert.equal(render().time, anchor, 'Moving one second ahead does not request a different thumbnail');
time = anchor + 1.99;
assert.equal(render().active, true, 'Crossing a fixed two-second bucket boundary must not cancel the request');
assert.equal(render().time, anchor);
advance(120);
assert.equal(render().time, time, 'A stationary finger refines the tolerance anchor to the exact displayed time');
advance(100); render();
for (let step = 0; step < 16; step++) {
  time += 4;
  assert.equal(render().active, false, 'Fast travel must not flood the decoder');
  advance(16);
}
advance(83);
assert.equal(render().active, false);
advance(1);
assert.equal(render().active, true, 'A larger move settles onto its latest target after 100ms');
assert.equal(render().time, time);
time += 4; render();
active = false; render(); advance(500);
assert.equal(render().active, false, 'Release cannot start delayed extraction');
active = true; deferWhileMoving = false;
assert.equal(render().active, true, 'Direct timeline dragging retains immediate previews');
assert.equal(render().time, time, 'Direct bar preview follows exact finger position');
deferWhileMoving = true; render(); advance(50);
source = 'https://video.test/b.mkv';
assert.equal(render().active, false, 'A source change invalidates the old target');
advance(50);
assert.equal(render().active, false, 'An old source timer cannot activate a different video');
advance(50);
assert.equal(render().active, true);
const css = fs.readFileSync('components/player-mobile.css', 'utf8');
const range = css.match(/\[data-scrub-mode="surface"\] \[data-slot="media-player-seek-range"\]\s*\{([^}]+)\}/)[1];
assert.ok(!/transition:\s*(right|all)/.test(range), 'Surface playhead must track the finger without a trailing position transition');
const player = fs.readFileSync('components/ui/media-player.tsx', 'utf8');
assert.ok(!player.includes('% speed'), 'Scrubbing must not display speed percentages');
assert.match(player, /<SeekPreview[^>]*deferWhileMoving=/, 'The actual timeline must enable the idle policy for surface gestures');
console.log('PASS: fine-scrub tolerance prevents timer starvation and decoder cancellation, fast travel coalesces, release cancels work, and bar previews remain immediate');

// Native gestures bypass artificial settle delays; coalescing lives in the
// scheduler/decoder, and warmed thumbnails must be available on first render.
const warmedMedia = { getAttribute: () => source, controller: { previewSession:'native-session' } };
for (const platform of ['android', 'macos', 'windows']) {
  hooks.length = 0; timers.clear(); effects.length = 0; cursor = 0;
  context.window.navigatorDesktop = { platform, capabilities: { nativePreviews: true } };
  for (const movingTime of [30.3, 60.1, 90.7]) {
    cursor = 0;
    const nativeNode = context.exports.SeekPreview({media:warmedMedia,time:movingTime,duration:1200,active:true,deferWhileMoving:true});
    assert.equal(nativeNode.props.active,true,`${platform} previews have no 100/120ms artificial settle delay`);
    assert.equal(nativeNode.props.time,movingTime,'Native requests follow the moving target');
    while (effects.length) effects.shift()();
  }
}

// Exercise the actual preview component, including late native events and cache
// lookup while the gesture's request policy is inactive.
hooks.length = 0; timers.clear(); effects.length = 0;
const listeners = new Map();
const nativeCache = new Map();
const controller = { cachedPreview(at) { return nativeCache.get(at); }, addEventListener: (type, fn) => listeners.set(type,fn), removeEventListener() {}, cancelPreview() {} };
const nativeMedia = { controller };
let at = 10, requesting = true;
function renderSource() {
  let node, rounds = 0;
  do {
    assert.ok(++rounds < 20);
    dirty = false; cursor = 0;
    node = sourceComponent({ media: nativeMedia, source:'https://video.test/a.mkv', time:at, displayTime:at, duration:1200, active:requesting });
    while (effects.length) effects.shift()();
  } while (dirty);
  return node;
}
const image = node => node.props.children.find(child => child?.props?.src?.startsWith('data:image/jpeg'));
const deliver = (position, src) => { nativeCache.set(position,src); listeners.get('previewframe')({detail:{position, src}}); };
renderSource(); deliver(10, 'data:image/jpeg;base64,TEN');
assert.equal(image(renderSource()).props.src, 'data:image/jpeg;base64,TEN');
deliver(2, 'data:image/jpeg;base64,OLD');
assert.equal(image(renderSource()).props.src, 'data:image/jpeg;base64,TEN', 'A late frame cannot replace the current correct thumbnail');
at = 20;
const updating = renderSource();
assert.equal(image(updating).props.src, 'data:image/jpeg;base64,TEN', 'Keep the previous image while fetching the new scene');
assert.equal(image(updating).props.pending, true, 'An old scene must be explicitly marked as updating');
assert.equal(updating.props['aria-busy'], true);
deliver(14, 'data:image/jpeg;base64,FOURTEEN');
assert.equal(image(renderSource()).props.src, 'data:image/jpeg;base64,FOURTEEN', 'A completed frame must display even after the moving pointer has passed its interval');
assert.equal(image(renderSource()).props.pending, true, 'A moving preview must not claim to match the current cursor time');
at = 30; renderSource();
deliver(22, 'data:image/jpeg;base64,TWENTYTWO');
assert.equal(image(renderSource()).props.src, 'data:image/jpeg;base64,TWENTYTWO', 'Continuous travel must keep advancing completed previews without a stationary cursor');
requesting = false; renderSource();
deliver(26, 'data:image/jpeg;base64,TWENTYSIX');
requesting = true;
assert.equal(image(renderSource()).props.src, 'data:image/jpeg;base64,TWENTYTWO', 'Hover exit must suppress late frame presentation');
at = 20; renderSource();
deliver(20, 'data:image/jpeg;base64,TWENTY'); renderSource();
at = 10; requesting = false;
assert.equal(image(renderSource()).props.src, 'data:image/jpeg;base64,TEN', 'Returning to a decoded point displays immediately without waiting for settle or a bridge request');
console.log('PASS: continuous native preview delivery, hover exit, current-target priority, and synchronous cached preview reuse');
