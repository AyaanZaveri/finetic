const assert = require('node:assert/strict');
const fs = require('node:fs');

// Keep tests runnable without installing a runner/transpiler: exercise the same
// source by compiling this small exported helper with the project's TypeScript.
const ts = require('typescript');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../lib/media/stream-playability.ts'), 'utf8');
const js = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 });
function localRequire(name) {
  if (name === './webgpu-module') return { canUseWebGpu: () => false };
  if (name === './web-video-preload' || name === './playback-probe-lock') return {};
  if (!name.startsWith('@/')) return require(name);
  const context = { exports: {}, require: localRequire, URL };
  vm.runInNewContext(ts.transpile(fs.readFileSync(name.slice(2) + '.ts', 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }), context);
  return context.exports;
}
const sandbox = { exports: {}, require: localRequire, setTimeout, clearTimeout, Promise, Number };
vm.runInNewContext(js, sandbox);
const probe = sandbox.exports.verifyMediaElementPlayback;

function fake() {
  const listeners = {};
  const counts = { pause: 0, remove: 0, play: 0 };
  return { counts,
    webkitVideoDecodedByteCount: 0, webkitAudioDecodedByteCount: 0,
    addEventListener: (k, f) => (listeners[k] ||= new Set()).add(f),
    removeEventListener: (k, f) => listeners[k]?.delete(f),
    fire: k => [...(listeners[k] || [])].forEach(f => f()),
    style: {}, setAttribute() {}, removeAttribute() {}, load() {}, remove() { counts.remove++; }, pause() { counts.pause++; },
    play() { counts.play++; return Promise.resolve(); },
    getVideoPlaybackQuality() { return { totalVideoFrames: 0 }; },
  };
}
const tick = () => new Promise(r => setTimeout(r, 0));
(async () => {
  // Brave/Chromium can leave decoded-byte counters at zero for a muted probe.
  // Active captured tracks are independent evidence of available media content.
  const audioTrack = Object.assign(new EventTarget(), { kind: 'audio', readyState: 'live', muted: false, enabled: true,
    stopped: false, stop() { this.stopped = true; } });
  const captured = Object.assign(new EventTarget(), { getAudioTracks: () => [audioTrack], getVideoTracks: () => [], getTracks: () => [audioTrack] });
  let brave = fake(); brave.webkitVideoDecodedByteCount = 12; brave.captureStream = () => captured;
  assert.equal(await probe(brave, new AbortController().signal, 10), 'supported',
    'Valid Brave playback must not require a nonzero proprietary audio byte counter');
  assert.equal(audioTrack.stopped, true, 'Release captured tracks after a successful check');

  const track = kind => Object.assign(new EventTarget(), { kind, readyState: 'live', muted: false, enabled: true,
    stopped: false, stop() { this.stopped = true; this.readyState = 'ended'; } });
  const capture = tracks => Object.assign(new EventTarget(), { getAudioTracks: () => tracks.filter(t => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter(t => t.kind === 'video'), getTracks: () => tracks });
  const audio = track('audio'), picture = track('video');
  brave = fake(); brave.captureStream = () => capture([audio, picture]);
  assert.equal(await probe(brave, new AbortController().signal, 100), 'supported', 'Live captured A/V works with both proprietary counters at zero');
  assert.equal(audio.stopped, true); assert.equal(picture.stopped, true);

  let gpuVideo = fake();
  gpuVideo.webgpu = { stats: () => ({ audio: {}, audioAheadMs: 250 }) };
  gpuVideo.getVideoPlaybackQuality = () => ({ totalVideoFrames: 1 });
  gpuVideo.captureStream = () => { throw Error('GPU probes must not capture a source-less video'); };
  assert.equal(await probe(gpuVideo, new AbortController().signal, 100), 'supported',
    'A presented GPU frame and submitted audio establish playback');
  gpuVideo = fake();
  gpuVideo.webgpu = { stats: () => ({ audio: null, audioAheadMs: null }) };
  gpuVideo.getVideoPlaybackQuality = () => ({ totalVideoFrames: 1 });
  gpuVideo.canPlayType = () => 'probably';
  assert.equal(await probe(gpuVideo, new AbortController().signal, 5, Promise.resolve({
    video: { codec: 'avc' }, audio: [{ primary: true, codec: 'aac' }],
  })), 'unknown', 'Native MIME support cannot establish audio for a GPU session');

  gpuVideo = fake();
  gpuVideo.webgpu = { silent: true, stats: () => ({ audio: null, audioAheadMs: null }) };
  gpuVideo.getVideoPlaybackQuality = () => ({ totalVideoFrames: 1 });
  assert.equal(await probe(gpuVideo, new AbortController().signal, 100), 'supported',
    'A presented video-only GPU route is usable when the user accepts missing audio');

  const available = track('audio'); available.muted = true;
  brave = fake(); brave.webkitVideoDecodedByteCount = 1; brave.captureStream = () => capture([available]);
  const startsLater = probe(brave, new AbortController().signal, 100);
  await tick(); available.muted = false; available.dispatchEvent(new Event('unmute'));
  assert.equal(await startsLater, 'supported', 'Wait for actual track availability, not audio amplitude');

  const metadata = { video: { codec: 'avc' }, audio: [{ primary: true, codec: 'aac', codecString: 'mp4a.40.2' }] };
  brave = fake(); delete brave.webkitAudioDecodedByteCount;
  brave.webkitVideoDecodedByteCount = 1; brave.canPlayType = () => 'probably';
  assert.equal(await probe(brave, new AbortController().signal, 100, Promise.resolve(metadata)), 'supported',
    'Supported real audio metadata plus video startup works when capture and audio counters are unavailable');

  brave = fake(); brave.canPlayType = () => 'probably'; brave.currentTime = 0;
  brave.play = function () { this.currentTime = 0.2; this.readyState = 4; this.videoWidth = 1920; this.videoHeight = 1080; return Promise.resolve(); };
  assert.equal(await probe(brave, new AbortController().signal, 100, Promise.resolve(metadata)), 'supported',
    'Advancing, ready video is not rejected just because a hidden player has no frame counter');

  brave = fake(); brave.webkitVideoDecodedByteCount = 1;
  assert.equal(await probe(brave, new AbortController().signal, 100, Promise.resolve({ ...metadata, audio: [] })), 'unsupported',
    'Real missing audio remains a rejection');

  const lateTracks = [], lateCapture = capture(lateTracks);
  brave = fake(); brave.captureStream = () => lateCapture;
  const realPlaybackWins = probe(brave, new AbortController().signal, 100, Promise.resolve({ ...metadata, audio: [] }));
  await tick();
  lateTracks.push(track('audio'), track('video')); lateCapture.dispatchEvent(new Event('addtrack'));
  assert.equal(await realPlaybackWins, 'supported', 'Cached negative metadata cannot destroy an actual working playback path before tracks become available');

  const unavailable = track('audio'); unavailable.muted = true;
  brave = fake(); brave.webkitVideoDecodedByteCount = 1; brave.captureStream = () => capture([unavailable]);
  assert.equal(await probe(brave, new AbortController().signal, 5), 'unknown', 'A muted captured source track is not positive audio evidence');

  let v = fake(), c = new AbortController();
  const originalTimeout = sandbox.setTimeout; let defaultTimeout;
  sandbox.setTimeout = (fn, ms) => { defaultTimeout = ms; return setTimeout(fn, ms); };
  const defaultProbe = probe(v, c.signal); c.abort();
  assert.equal(await defaultProbe, 'unknown'); assert.equal(defaultTimeout, 45000, 'The per-stream default must use the same 45-second deadline');
  sandbox.setTimeout = originalTimeout;

  v = fake(); c = new AbortController();
  v.webkitVideoDecodedByteCount = 1; v.webkitAudioDecodedByteCount = 1;
  v.audioTracks = { 0: { enabled: false, language: 'ru' }, 1: { enabled: true, language: 'fr' }, length: 2 };
  let selectedLanguage;
  assert.equal(await probe(v, c.signal, 100, undefined, { preferredAudioLanguage: 'fr', onAudioLanguage: language => { selectedLanguage = language; } }), 'supported');
  assert.equal(selectedLanguage, 'fr', 'Report the actual enabled audio language, not a default or filename guess');

  v = fake(); c = new AbortController();
  const supported = probe(v, c.signal, 100);
  v.webkitVideoDecodedByteCount = 12; v.webkitAudioDecodedByteCount = 8; v.fire('timeupdate');
  assert.equal(await supported, 'supported');

  v = fake(); c = new AbortController();
  const metadataOnly = probe(v, c.signal, 5); v.fire('loadeddata');
  assert.equal(await metadataOnly, 'unknown');

  v = fake(); c = new AbortController(); v.webkitVideoDecodedByteCount = 10;
  assert.equal(await probe(v, c.signal, 5), 'unknown', 'Playing video without decoded audio must never pass');
  v = fake(); c = new AbortController(); v.webkitAudioDecodedByteCount = 10;
  assert.equal(await probe(v, c.signal, 5), 'unknown', 'Decoded audio without video must never pass');
  v = fake(); c = new AbortController(); delete v.webkitAudioDecodedByteCount;
  v.webkitVideoDecodedByteCount = 10;
  assert.equal(await probe(v, c.signal, 5), 'unknown', 'Missing browser evidence cannot be treated as success');

  v = fake(); c = new AbortController();
  v.nativeEl = { webkitAudioDecodedByteCount: 3, webkitVideoDecodedByteCount: 4 };
  assert.equal(await probe(v, c.signal, 100), 'supported', 'Mux probes inspect native decoder counters');
  assert.equal(v.counts.remove, 1, 'Clean the Mux host, not just its internal video');

  v = fake(); c = new AbortController(); v.play = () => Promise.reject(new Error('autoplay'));
  assert.equal(await probe(v, c.signal, 100), 'unknown');

  v = fake(); c = new AbortController();
  const aborted = probe(v, c.signal, 100); c.abort();
  v.webkitVideoDecodedByteCount = 1; v.webkitAudioDecodedByteCount = 1; v.fire('timeupdate');
  assert.equal(await aborted, 'unknown');
  await tick(); assert.equal(v.counts.play, 0, 'Aborting before the play microtask cannot restart a cleaned-up probe');

  v = fake(); c = new AbortController();
  const errored = probe(v, c.signal, 100); v.error = { code: 3 }; v.fire('error');
  assert.equal(await errored, 'unsupported');
  v = fake(); c = new AbortController();
  const network = probe(v, c.signal, 100); v.error = { code: 2 }; v.fire('error');
  assert.equal(await network, 'unknown', 'A transport failure does not establish codec incompatibility');

  v = fake(); c = new AbortController();
  v.play = function () {
    assert.equal(this.muted, true, 'Preview audio must not be audible');
    assert.equal(this.crossOrigin, 'anonymous', 'Probe and actual player must use the same CORS mode');
    assert.ok(this.style.cssText.includes('clip-path'), 'Probe players must not appear in the UI');
    this.webkitAudioDecodedByteCount = 10; this.webkitVideoDecodedByteCount = 10;
    this.fire('timeupdate'); return Promise.resolve();
  };
  sandbox.document = { createElement() { return v; }, body: { append() {} } };
  assert.equal(await sandbox.exports.probeStreamPlayability({ url: 'https://example.test/movie.mkv' }, { signal: c.signal }), 'supported');
  assert.equal(v.counts.pause, 1); assert.equal(v.counts.remove, 1);
  await tick();
  console.log('stream-playability tests passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
