const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const context = { exports: {}, setTimeout, clearTimeout, document: { createElement() {
    return { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,fixture' };
}} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/media/preview-frames.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, context);
const { PreviewCache, previewBucket, BrowserPreviewFrames } = context.exports;
const cache = new PreviewCache(2);
cache.set(0, 'zero'); cache.set(2, 'two'); assert.equal(cache.get(0), 'zero'); cache.set(4, 'four');
assert.equal(cache.get(2), undefined, 'Cache must evict the least recently used frame');
assert.equal(previewBucket(3.9, 120), 4);
assert.equal(previewBucket(120, 120), 119);
for (let ms=0; ms<120000; ms+=37) assert.ok(Math.abs(previewBucket(ms/1000,120)-ms/1000)<=1, 'Thumbnail sampling is bounded to the one-second grid, including the media end');
const nativeSource = fs.readFileSync('android/app/src/main/java/app/navigator/android/SeekPreviews.kt', 'utf8');
assert.match(nativeSource, /setSeekParameters\(SeekParameters.EXACT\)/, 'Android must decode the requested frame, not a nearby keyframe');
assert.equal(previewBucket(30.01,120),previewBucket(30.4,120), 'Fine finger movement reuses the same one-second thumbnail');
assert.equal(previewBucket(NaN, 120), null);
assert.equal(previewBucket(10, Infinity), null);
class Video extends EventTarget {
    readyState = 2; videoWidth = 1920; videoHeight = 1080; seeking = false;
    seeks = []; _time = 0;
    get currentTime() { return this._time; }
    set currentTime(time) { this._time = time; this.seeking = true; this.seeks?.push(time); }
    fastSeek(time) { throw new Error('Keyframe seek can return a different scene'); }
    finish() { this.seeking = false; this.dispatchEvent(new Event('seeked')); }
    pause() {} load() {} removeAttribute() {}
}
const video = new Video();
const answers = [];
const frames = new BrowserPreviewFrames(video, (...args) => answers.push(args));
frames.want(20); frames.want(40); frames.want(60);
assert.deepEqual(video.seeks, [20], 'Only one seek may be in flight');
video.finish();
assert.deepEqual(video.seeks, [20, 60], 'Rapid pointer movement must skip obsolete requests');
assert.equal(answers.length, 0, 'The obsolete decoded frame must not replace the current preview');
video.finish();
assert.equal(answers.at(-1)[0], 60);
frames.want(20);
assert.equal(answers.at(-1)[0], 20);
assert.equal(video.seeks.length, 2, 'Returning to a cached frame must not seek or fetch again');
frames.want(80); frames.cancel(); video.finish();
assert.notEqual(answers.at(-1)[0], 80, 'Leaving the scrubber must suppress late results');
frames.dispose();
const hdrVideo = new Video();
const hdrFrames = new BrowserPreviewFrames(hdrVideo, (...args) => answers.push(args), true);
hdrFrames.want(10); hdrVideo.finish();
assert.equal(answers.at(-1)[1], null);
assert.equal(answers.at(-1)[2], true, 'HDR-capable browsers retain the original video pipeline rather than flattening into JPEG');
hdrFrames.dispose();
const blocked = new Video();
const captured = context.document.createElement;
context.document.createElement = () => { throw new Error('Tainted canvas'); };
const blockedFrames = new BrowserPreviewFrames(blocked, (...args) => answers.push(args));
blockedFrames.want(4); blocked.finish();
assert.equal(answers.at(-1)[2], true, 'CORS capture restrictions must fall back to displaying the decoded video');
blockedFrames.dispose();
context.document.createElement = captured;
const wrapped = new Video();
wrapped.nativeEl = { fastSeek: undefined };
wrapped.fastSeek = () => { throw new Error('Native fastSeek is not supported'); };
const wrappedFrames = new BrowserPreviewFrames(wrapped, (...args) => answers.push(args));
wrappedFrames.want(12);
assert.equal(wrapped.currentTime, 12, 'Mux wrappers must use currentTime when the browser has no native fastSeek');
wrapped.finish(); wrappedFrames.dispose();
const broken = new Video();
broken.readyState = 0; broken.error = { message: 'Unsupported codec' };
const brokenFrames = new BrowserPreviewFrames(broken, (...args) => answers.push(args));
brokenFrames.want(2);
assert.equal(answers.at(-1)[1], null, 'Known codec errors must not leave a six-second loading skeleton');
brokenFrames.dispose();
console.log('PASS: preview buckets/LRU, latest-request coalescing, cache hits, cancellation, HDR video, and CORS fallback');
// A hover gesture must keep requesting while moving, rather than debounce until it stops.
(async () => {
    const requests = [];
    const scheduler = new context.exports.PreviewScheduler();
    scheduler.want(0, time => requests.push(time));
    assert.deepEqual(requests, [0], 'The first thumbnail request should start immediately');
    scheduler.want(2, time => requests.push(time));
    scheduler.want(4, time => requests.push(time));
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.deepEqual(requests, [0, 4], 'Only the latest queued point should run at the next throttle interval');
    scheduler.want(6, time => requests.push(time));
    scheduler.cancel();
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.deepEqual(requests, [0, 4], 'Leaving hover must cancel the queued request');
    console.log('PASS: leading/trailing preview throttle and queued-request cancellation');
})().catch(error => { console.error(error); process.exitCode = 1; });

// Async JPEG encoding coalesces new positions and releases late object URLs.
{
    const pending = [], revoked = [];
    let serial = 0;
    context.URL = { createObjectURL: () => `blob:jpeg-${++serial}`, revokeObjectURL: src => revoked.push(src) };
    context.document.createElement = () => ({ getContext: () => ({ drawImage() {} }), toBlob: callback => pending.push(callback) });
    const media = new Video(), results = [];
    const frames = new BrowserPreviewFrames(media, (...args) => results.push(args));
    frames.want(10); media.finish();
    assert.equal(pending.length, 1); assert.equal(results.length, 0, 'Publish only after async JPEG encoding finishes');
    frames.want(20); media.dispatchEvent(new Event('canplay'));
    assert.equal(pending.length, 1, 'Readiness events cannot encode the same frame twice');
    pending[0]({ size: 10 });
    assert.equal(media.currentTime, 20, 'Finish current encoding before seeking to the newest request');
    media.finish(); frames.dispose(); pending[1]({ size: 10 });
    assert.equal(results.length, 0, 'An obsolete or disposed binary frame is never presented');
    assert.deepEqual(revoked, ['blob:jpeg-1', 'blob:jpeg-2']);
    const released = [];
    const bounded = new PreviewCache(5, src => released.push(src), 10);
    bounded.set(1, 'one', 6); bounded.set(2, 'two', 6);
    assert.equal(bounded.get(1), undefined); assert.deepEqual(released, ['one']);
    bounded.clear(); assert.deepEqual(released, ['one', 'two']);
    console.log('PASS: async binary capture, coalescing, stale callback cleanup and byte-bounded preview eviction');
}
