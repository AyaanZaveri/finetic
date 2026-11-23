const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const context = { exports: {}, setTimeout, clearTimeout, document: { createElement() {
  return { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,fixture' };
} } };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/media/preview-frames.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, context);
class Video extends EventTarget {
  readyState = 2; currentTime = 0; videoWidth = 1920; videoHeight = 1080; seeking = false;
  src = 'https://stream.test/movie.mp4'; crossOrigin = 'anonymous'; loads = 0; error = null;
  fastSeek(time) { this.currentTime = time; this.seeking = true; }
  finish() { this.seeking = false; this.dispatchEvent(new Event('seeked')); }
  removed = [];
  pause() {} removeAttribute(name) { this.removed.push(name); }
  load() { this.loads++; this.error = null; this.readyState = 0; this.seeking = false; }
}
let failures = 0;
function test(name, check) { try { check(); console.log('PASS:', name); } catch (error) { failures++; console.error('FAIL:', name, error.message); } }
test('Mux owns its MediaSource across preview-provider effect cleanup', () => {
  const video = new Video();
  video.src = 'blob:https://navigator.test/preview-decoder';
  const provider = new context.exports.BrowserPreviewFrames(video, () => {}, false, false, false);
  provider.dispose();
  assert.equal(video.loads, 0, 'Provider cleanup must not detach a Mux-managed MediaSource');
  assert.deepEqual(video.removed, []);
});
test('A late error cannot overwrite a cached preview', () => {
  const video = new Video(), results = [];
  const provider = new context.exports.BrowserPreviewFrames(video, (...args) => results.push(args));
  try {
    provider.want(20); video.finish();
    provider.want(60); provider.want(20);
    video.error = { code: 2 }; video.dispatchEvent(new Event('error'));
    assert.equal(results.at(-1)[0], 20);
    assert.ok(results.at(-1)[1]?.startsWith('data:image/jpeg'), 'Cached frame must survive the older failed seek');
  } finally { provider.dispose(); }
});
test('A frame becoming ready after seeked completes on canplay', () => {
  const video = new Video(), results = [];
  const provider = new context.exports.BrowserPreviewFrames(video, (...args) => results.push(args));
  try {
    provider.want(20); video.readyState = 1; video.finish();
    assert.equal(results.length, 0);
    video.readyState = 2; video.dispatchEvent(new Event('canplay'));
    assert.equal(results.at(-1)?.[0], 20);
    assert.ok(results.at(-1)?.[1]);
  } finally { provider.dispose(); }
});
test('Paused HDR decoders are primed while waiting for the sought frame', () => {
  const video = new Video(), results = [];
  let plays = 0, pauses = 0;
  video.readyState = 1;
  video.play = () => { plays++; return Promise.resolve(); };
  video.pause = () => { pauses++; };
  const provider = new context.exports.BrowserPreviewFrames(video, (...args) => results.push(args));
  try {
    provider.want(20);
    assert.equal(plays, 1, 'A metadata-only paused decoder must be asked to decode video');
    video.readyState = 2; video.finish();
    assert.equal(results.at(-1)?.[0], 20);
    assert.ok(pauses > 0, 'The preview stops as soon as its frame is decoded');
  } finally { provider.dispose(); }
});
test('Slow HDR frames can complete after the timeout without restarting their seek', () => {
  const originalSet = context.setTimeout, originalClear = context.clearTimeout;
  let timer, time = 0, seeks = 0;
  context.setTimeout = (fn, delay) => { timer = { fn, delay }; return 1; };
  context.clearTimeout = () => {};
  const video = new Video(), results = [];
  video.readyState = 1;
  Object.defineProperty(video, 'currentTime', { get: () => time, set: value => { time = value; seeks++; } });
  const provider = new context.exports.BrowserPreviewFrames(video, (...args) => results.push(args));
  try {
    provider.want(20); assert.ok(timer.delay >= 30000);
    timer.fn(); assert.equal(results.at(-1)[3], true, 'A genuinely stalled source leaves the loading state');
    video.dispatchEvent(new Event('progress')); assert.equal(seeks, 1, 'Progress cannot restart the same slow seek');
    video.readyState = 2; video.finish();
    assert.equal(results.at(-1)[0], 20); assert.ok(results.at(-1)[1], 'A late decoded frame recovers the preview');
  } finally { provider.dispose(); context.setTimeout = originalSet; context.clearTimeout = originalClear; }
});
test('Progressive playback can retry without CORS and display a video frame', () => {
  const video = new Video(), results = [];
  const createElement = context.document.createElement;
  context.document.createElement = () => ({ ...createElement(), toBlob() { throw new Error('SecurityError'); } });
  const provider = new context.exports.BrowserPreviewFrames(video, (...args) => results.push(args), false, true);
  try {
    provider.want(20); video.error = { code: 4 }; video.dispatchEvent(new Event('error'));
    assert.equal(video.crossOrigin, null, 'Cross-origin capture failure should retry playable video without anonymous CORS');
    assert.equal(video.loads, 1);
    assert.equal(results.length, 0, 'A recoverable failure is still loading');
    video.readyState = 1; video.dispatchEvent(new Event('loadedmetadata'));
    video.readyState = 2; video.finish();
    assert.equal(results.at(-1)?.[0], 20);
    assert.equal(results.at(-1)?.[2], true, 'Canvas restrictions still allow a displayed video preview');
    provider.want(30); video.finish();
    assert.equal(results.at(-1)?.[0], 30, 'A synchronous toBlob failure cannot leave later seeks stuck encoding');
    video.error = { code: 4 }; video.dispatchEvent(new Event('error'));
    assert.equal(video.loads, 1, 'Retry remains bounded');
  } finally { context.document.createElement = createElement; provider.dispose(); }
});
test('Chapter decoding can advance past a stalled seek', () => {
  const originalSet = context.setTimeout, originalClear = context.clearTimeout;
  let timer;
  context.setTimeout = (fn, delay) => { timer = { fn, delay }; return 1; };
  context.clearTimeout = () => {};
  const video = new Video(), results = [];
  const provider = new context.exports.BrowserPreviewFrames(video, (...args) => {
    results.push(args);
    if (args[3]) provider.cancel(true);
  }, false, false, true, 8_000);
  try {
    provider.want(20);
    assert.equal(timer.delay, 8_000);
    timer.fn();
    provider.want(40);
    assert.equal(video.currentTime, 40);
    video.finish();
    assert.equal(results.at(-1)[0], 40);
    assert.ok(results.at(-1)[1]);
  } finally { provider.dispose(); context.setTimeout = originalSet; context.clearTimeout = originalClear; }
});
process.exitCode = failures ? 1 : 0;
