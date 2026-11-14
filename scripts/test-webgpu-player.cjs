const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./test-support/react-hooks.cjs');
const tick = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

class Video extends EventTarget {
  constructor() {
    super(); Object.assign(this, { volume: .7, muted: false, playbackRate: 1, currentTime: 0,
      duration: 100, paused: true, dataset: {}, parentElement: { tagName: 'DIV', querySelector: () => this.picture }, picture: {} });
  }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}
function fixture({ result, deferred = false, moduleDeferred = false } = {}) {
  let events, resolveOpen, resolveModule, destroys = 0, fallbacks = 0, frameId = 0;
  const calls = [], timers = new Map(), raf = new Map();
  const stats = { framesPresented: 1, framesDropped: 0, audio: {}, audioAheadMs: 100, clockMs: 0 };
  const opened = result || { eligible: true, audio: [
    { ordinal: 0, language: 'ru', title: 'Russian', isDefault: true },
    { ordinal: 1, language: 'en', title: 'English', isDefault: false },
  ], audioOrdinal: 1, width: 1920, height: 1080, durationMs: 100000 };
  let presented = 0;
  const player = { open(request) { calls.push(['open', request]); return deferred ? new Promise(resolve => { resolveOpen = resolve; }) : Promise.resolve(opened); },
    destroy() { destroys++; }, stats: () => stats, presentedMs: () => presented,
    play() { calls.push(['play']); }, pause() { calls.push(['pause']); },
    seek(ms) { calls.push(['seek', ms]); }, setVolume(n) { calls.push(['volume', n]); },
    setMuted(n) { calls.push(['muted', n]); }, setRate(n) { calls.push(['rate', n]); },
    setAudio(n) { calls.push(['audio', n]); return Promise.resolve(opened); } };
  const module = { createEmbeddedPlayer(surface, handlers) { events = handlers; return player; } };
  const api = load('lib/media/webgpu-video.ts', {
    './webgpu-module': { loadWebGpuModule: () => moduleDeferred ? new Promise(resolve => { resolveModule = resolve; }) : Promise.resolve(module) },
    './playback-preferences': { readPlaybackPreferences: () => ({ audioLanguage: 'en' }) },
  }, { Event, EventTarget, DOMException, navigator: { userActivation: { hasBeenActive: true } }, performance,
    setTimeout(fn) { const id = ++frameId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { const id = ++frameId; raf.set(id, fn); return id; }, cancelAnimationFrame(id) { raf.delete(id); } });
  const video = new Video(), notifications = [];
  for (const name of ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'timeupdate', 'seeking', 'seeked', 'ended', 'trackschange']) {
    video.addEventListener(name, () => notifications.push(name));
  }
  const detach = api.attachWebGpuVideo(video, 'https://example.test/film.mkv', () => { fallbacks++; });
  return { video, calls, notifications, timers, raf, stats, detach, get events() { return events; },
    get destroys() { return destroys; }, get fallbacks() { return fallbacks; },
    resolveOpen: () => resolveOpen(opened), resolveModule: () => resolveModule(module),
    frame(ms) { presented = ms; const list = [...raf.values()]; raf.clear(); list.forEach(fn => fn(ms)); } };
}
(async () => {
  const f = fixture();
  await f.video.play(); await tick();
  assert.equal(f.video.duration, 100); assert.equal(f.video.videoWidth, 1920);
  assert.equal(f.video.src, 'https://example.test/film.mkv');
  assert.equal(f.calls[0][0], 'open'); assert.equal(f.calls[0][1].paused, true, 'Open paused before wiring metadata consumers');
  assert.ok(f.calls.some(([name, value]) => name === 'audio' && value === 1), 'Pick the saved audio language by ordinal');
  assert.ok(f.calls.some(([name]) => name === 'play'), 'A play request made during import survives open');
  assert.equal(f.video.audioTracks[1].enabled, true);
  assert.ok(f.notifications.includes('loadedmetadata')); assert.equal(f.timers.size, 0);
  f.video.currentTime = 42; assert.ok(f.calls.some(([name, value]) => name === 'seek' && value === 42000));
  f.events.onTime(1000); assert.equal(f.video.currentTime, 42, "Stale clock ticks cannot undo a pending seek");
  f.events.onTime(42000); assert.equal(f.video.currentTime, 42); assert.equal(f.video.seeking, false);
  assert.ok(f.notifications.includes('seeked'));
  f.video.volume = .2; f.video.muted = true; f.video.playbackRate = 1.5;
  assert.ok(f.calls.some(([name, value]) => name === 'rate' && value === 1.5));
  f.video.audioTracks[0].enabled = true; await tick(); assert.equal(f.video.audioTracks[0].enabled, true);
  let frame;
  f.video.requestVideoFrameCallback((_, metadata) => { frame = metadata; }); f.frame(42500);
  assert.equal(frame.mediaTime, 42.5);
  assert.equal(f.video.webgpu.picture(), f.video.picture);
  f.video.pause(); assert.ok(f.video.paused);
  f.video.requestVideoFrameCallback(() => {}); f.frame(42500);
  assert.equal(f.raf.size, 0, 'An unchanged paused picture does not poll animation frames');
  f.events.onTime(43000); assert.ok(f.raf.size > 0, 'A clock event wakes pending frame callbacks');
  f.events.onState('ended'); assert.ok(f.video.ended);
  f.detach(); f.detach(); assert.equal(f.destroys, 1); assert.equal(f.raf.size, 0);
  assert.equal(f.video.webgpu, undefined); assert.equal(f.video.dataset.webgpu, undefined);
  assert.equal(Object.hasOwn(f.video, 'requestVideoFrameCallback'), false);

  const fallback = fixture(); await tick(); await fallback.video.play();
  fallback.video.volume = .3; fallback.video.muted = true; fallback.video.playbackRate = 1.25;
  fallback.events.onFallback('device-lost', 57000);
  assert.equal(fallback.fallbacks, 1); assert.equal(fallback.video.webgpu, undefined);
  fallback.video.dispatchEvent(new Event('loadedmetadata')); await tick();
  assert.equal(fallback.video.currentTime, 57, 'Same-file fallback resumes the engine position');
  assert.equal(fallback.video.volume, .3); assert.equal(fallback.video.muted, true); assert.equal(fallback.video.playbackRate, 1.25);
  fallback.events.onError('late failure'); assert.equal(fallback.fallbacks, 1, 'Late callbacks cannot restart fallback');
  fallback.detach();

  const refused = fixture({ result: { eligible: false, reason: 'container-unsupported' } }); await tick();
  assert.equal(refused.fallbacks, 1); assert.equal(refused.destroys, 1); refused.detach();
  const cancelled = fixture({ moduleDeferred: true }); await tick(); cancelled.detach(); cancelled.resolveModule(); await tick();
  assert.equal(cancelled.calls.length, 0, 'Close during import cannot create a player'); assert.equal(cancelled.fallbacks, 0);
  const stale = fixture({ deferred: true }); await tick(); stale.detach(); stale.resolveOpen(); await tick();
  assert.equal(stale.fallbacks, 0); assert.ok(!stale.notifications.includes('loadedmetadata'), 'A stale open cannot publish readiness');
  const hung = fixture({ moduleDeferred: true }); await tick(); [...hung.timers.values()][0]();
  assert.equal(hung.fallbacks, 1); hung.resolveModule(); await tick(); assert.equal(hung.calls.length, 0);

  const { acquirePlaybackProbe } = load('lib/media/playback-probe-lock.ts');
  const first = await acquirePlaybackProbe(new AbortController().signal);
  const abort = new AbortController(); let secondReady = false;
  const second = acquirePlaybackProbe(abort.signal).then(release => { secondReady = true; return release; });
  await tick(); assert.equal(secondReady, false, 'GPU checks run one at a time');
  abort.abort(); assert.equal(await second, undefined); first();
  const third = await acquirePlaybackProbe(new AbortController().signal); assert.equal(typeof third, 'function'); third();

  const globals = { window: { isSecureContext: true }, navigator: { gpu: {} }, VideoDecoder: class {}, AudioWorkletNode: class {}, location: { href: 'https://navigator.test/' }, URL };
  const capability = load('lib/media/webgpu-module.ts', {}, globals);
  assert.ok(capability.canUseWebGpu('https://cdn.test/film.mkv'));
  assert.equal(capability.canUseWebGpu('https://cdn.test/live.m3u8?token=one'), false);
  assert.equal(capability.canUseWebGpu('https://cdn.test/film.mpd'), false);
  assert.equal(capability.canUseWebGpu('file:///film.mkv'), false);
  globals.window.isSecureContext = false;
  assert.equal(capability.canUseWebGpu('https://cdn.test/film.mkv'), false);

  const manifest = require('@aiostreams/webgpu-player/package.json');
  const root = path.join('public/webgpu-player', manifest.version, 'libraries');
  for (const file of ['webgpu-player/EmbeddedPlayer.js', 'webgpu-player/CustomDecode.worker.js', 'webgpu-player/CustomAudioDecode.worker.js',
    'wgpud/hevc.wasm', 'wgpud/dts.wasm', 'wgpud/eac3.wasm', 'wgpud/truehd.wasm', 'wgpud/SOURCE.txt', 'wgpud/FFmpeg-COPYING.LGPLv2.1']) {
    assert.ok(fs.statSync(path.join(root, file)).size > 0, `Runtime includes ${file}`);
  }
  const installed = path.dirname(require.resolve('@aiostreams/webgpu-player/package.json'));
  for (const file of fs.readdirSync(path.join(installed, 'libraries'), { recursive: true })) {
    const source = path.join(installed, 'libraries', file);
    if (fs.statSync(source).isFile()) assert.deepEqual(fs.readFileSync(path.join(root, file)), fs.readFileSync(source), `Preserve runtime bytes: ${file}`);
  }
  console.log('PASS: webgpu media API, language selection, seeking, frame callbacks, fallback, stale loads, timeout, probe locking, capability gates and runtime integrity');
})().catch(error => { console.error(error); process.exitCode = 1; });
