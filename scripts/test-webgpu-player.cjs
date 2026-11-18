const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const tick = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

const { readWebPlaybackStats, playbackFrameRate } = load('lib/media/playback-stats.ts', {
  './native-webgpu-renderer': { nativeWebGpuDrawCount: video => video.draws },
});
const statsVideo = {
  videoWidth: 3840, videoHeight: 2160, paused: false, ended: false, seeking: false,
  dataset: { webgpuFallback: 'playback-stalled' },
  getVideoPlaybackQuality: () => ({ totalVideoFrames: 25, droppedVideoFrames: 4 }),
};
const nativeStats = readWebPlaybackStats(statsVideo);
assert.equal(nativeStats.presented, 21, 'Browser frame totals include dropped frames');
assert.equal(nativeStats.fallback, 'playback-stalled');
assert.equal(nativeStats.hdr, 'Browser-managed');
assert.equal(playbackFrameRate(nativeStats, { ...nativeStats, presented: 45 }, 1000), 24);
assert.equal(playbackFrameRate(nativeStats, { ...nativeStats, presented: 1 }, 1000), undefined, 'Counter resets cannot produce negative FPS');
assert.equal(playbackFrameRate(nativeStats, { ...nativeStats, playing: false }, 1000), undefined);
const hybridStats = readWebPlaybackStats({ ...statsVideo, draws: 18 });
assert.equal(hybridStats.path, 'Browser decoder + WebGPU');
assert.equal(hybridStats.draws, 18, 'Draw submissions remain distinct from presented frames');
assert.equal(playbackFrameRate(nativeStats, hybridStats, 1000), undefined, 'Do not compare counters across playback paths');
const customStats = readWebPlaybackStats({ ...statsVideo, webgpu: { stats: () => ({
  hdrOutput: true, framesPresented: 6, framesDropped: 7, framesLate: 4, videoAheadMs: 1500,
}) } });
assert.equal(customStats.hdr, 'HDR');
assert.equal(customStats.presented, 6);
assert.equal(customStats.dropped, 7);
assert.equal(customStats.late, 4);
assert.equal(customStats.videoAheadMs, 1500);

class Video extends EventTarget {
  constructor() {
    super(); Object.assign(this, { volume: .7, muted: false, playbackRate: 1, currentTime: 0,
      duration: 100, paused: true, dataset: {}, parentElement: { tagName: 'DIV', querySelector: () => this.picture }, picture: {} });
  }
  closest() { return null; }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}
function fixture({ result, resolvedSource, audioFailure = false, deferred = false, moduleDeferred = false, hdrOutput = false, hdrDisplay = false, hdrFailure = false, hdrPeakNits = 600 } = {}) {
  let events, resolveOpen, resolveModule, fallbackSource, destroys = 0, fallbacks = 0, frameId = 0;
  const calls = [], timers = new Map(), raf = new Map();
  const stats = { hdrOutput: hdrDisplay && !hdrFailure, framesPresented: 1, framesDropped: 0, audio: {}, audioAheadMs: 100, clockMs: 0 };
  const warnings = [];
  let routeStopped = false;
  const opened = result || { eligible: true, audio: [
    { ordinal: 0, language: 'ru', title: 'Russian', isDefault: true },
    { ordinal: 1, language: 'en', title: 'English', isDefault: false },
  ], audioOrdinal: 1, width: 1920, height: 1080, durationMs: 100000 };
  let presented = 0;
  const player = { open(request) { calls.push(['open', request]); if (audioFailure && request.audioOrdinal !== -1) return Promise.resolve({ eligible: false, reason: 'audio-codec-unsupported' }); if (audioFailure) { stats.audio = null; stats.audioAheadMs = null; } return deferred ? new Promise(resolve => { resolveOpen = resolve; }) : Promise.resolve(opened); },
    destroy() { destroys++; }, stats: () => routeStopped ? null : stats, presentedMs: () => presented,
    play() { calls.push(['play']); }, pause() { calls.push(['pause']); },
    seek(ms) { calls.push(['seek', ms]); }, setVolume(n) { calls.push(['volume', n]); },
    setMuted(n) { calls.push(['muted', n]); }, setRate(n) { calls.push(['rate', n]); },
    async setHDROutput(value, peak) { calls.push(peak === undefined ? ['hdr', value] : ['hdr', value, peak]); if (value && hdrFailure) throw Error('HDR unavailable'); },
    setAudio(n) { calls.push(['audio', n]); return Promise.resolve(opened); } };
  const module = { createEmbeddedPlayer(surface, handlers) { events = handlers; return player; } };
  const api = load('lib/media/webgpu-video.ts', {
    './webgpu-module': { loadWebGpuModule: () => moduleDeferred ? new Promise(resolve => { resolveModule = resolve; }) : Promise.resolve(module) },
    './webgpu-source': { resolveWebGpuSource: async url => resolvedSource || url },
    './playback-preferences': { readPlaybackPreferences: () => ({ audioLanguage: 'en', hdrOutput, hdrPeakNits }) },
  }, { window: { matchMedia: () => ({ matches: hdrDisplay }) }, Event, EventTarget, DOMException, navigator: { userActivation: { hasBeenActive: true } }, performance,
    console: { warn: (...args) => warnings.push(args) },
    setTimeout(fn) { const id = ++frameId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { const id = ++frameId; raf.set(id, fn); return id; }, cancelAnimationFrame(id) { raf.delete(id); } });
  const video = new Video(), notifications = [];
  for (const name of ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'timeupdate', 'seeking', 'seeked', 'ended', 'trackschange', 'webgpu-hdr-unavailable']) {
    video.addEventListener(name, () => notifications.push(name));
  }
  const detach = api.attachWebGpuVideo(video, 'https://example.test/film.mkv', source => { fallbackSource = source; fallbacks++; });
  return { video, calls, notifications, timers, raf, stats, warnings, detach, get events() { return events; },
    stopRoute: () => { routeStopped = true; },
    get destroys() { return destroys; }, get fallbacks() { return fallbacks; }, get fallbackSource() { return fallbackSource; },
    resolveOpen: () => resolveOpen(opened), resolveModule: () => resolveModule(module),
    frame(ms) { presented = ms; const list = [...raf.values()]; raf.clear(); list.forEach(fn => fn(ms)); } };
}
(async () => {
  const hdr = fixture({ hdrOutput: true, hdrDisplay: true }); await tick();
  assert.deepEqual(hdr.calls[0], ['hdr', true, 600], 'Configure HDR before opening the file');
  hdr.events.onState('playing');
  assert.equal(hdr.video.dataset.webgpuHdr, 'hdr');
  hdr.events.onFallback('canvas-configure-failed', 12000); await tick();
  assert.equal(hdr.calls.filter(([name]) => name === 'hdr').length, 1, 'Retry only once with SDR');
  assert.equal(hdr.calls.filter(([name]) => name === 'open').length, 2);
  assert.equal(hdr.calls.filter(([name]) => name === 'open')[1][1].startMs, 12000);
  assert.equal(hdr.video.webgpu.silent, false, 'SDR recovery retains audio');
  assert.equal(hdr.video.dataset.webgpuHdr, 'output-failed');
  assert.equal(hdr.fallbacks, 0);
  const notices = hdr.notifications.filter(name => name === 'webgpu-hdr-unavailable').length;
  hdr.events.onFallback('source-unreadable', 12000);
  assert.equal(hdr.notifications.filter(name => name === 'webgpu-hdr-unavailable').length, notices + 1,
    'Report browser fallback before destroying the GPU session');
  assert.equal(hdr.fallbacks, 1); hdr.detach();
  const rejectedHdr = fixture({ hdrOutput: true, hdrDisplay: true, hdrFailure: true }); await tick();
  assert.deepEqual(rejectedHdr.calls.slice(0, 2), [['hdr', true, 600], ['hdr', false]]);
  assert.equal(rejectedHdr.fallbacks, 0); rejectedHdr.detach();
  const sdr = fixture({ hdrOutput: true }); await tick();
  assert.equal(sdr.video.dataset.webgpuHdr, 'display-unavailable');
  assert.ok(!sdr.calls.some(([name]) => name === 'hdr'), 'Keep SDR output on an SDR display'); sdr.detach();
  const disabledHdr = fixture({ hdrDisplay: true }); await tick();
  assert.ok(!disabledHdr.calls.some(([name]) => name === 'hdr'), 'Honor the disabled HDR preference'); disabledHdr.detach();
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
  Object.assign(fallback.stats, { route: 'native video-frame, audio decoded-pcm', framesDropped: 14,
    framesLate: 12, videoAheadMs: 0, audioUnderflows: 2, clockMs: 56950 });
  fallback.events.onTime(56950);
  fallback.stopRoute();
  fallback.events.onFallback('device-lost: https://example.test/private', 57000);
  assert.equal(fallback.warnings.length, 1);
  const [, diagnostic] = fallback.warnings[0];
  assert.equal(diagnostic.reason, 'device-lost');
  assert.equal(diagnostic.framesDropped, 14, 'Keep the last diagnostics after the engine tears down its route');
  assert.equal(diagnostic.videoAheadMs, 0);
  assert.equal(diagnostic.positionMs, 57000);
  assert.ok(!JSON.stringify(diagnostic).includes('example.test'), 'Diagnostics exclude source URLs');
  assert.equal(fallback.fallbacks, 1); assert.equal(fallback.video.webgpu, undefined);
  fallback.video.dispatchEvent(new Event('loadedmetadata')); await tick();
  assert.equal(fallback.video.currentTime, 57, 'Same-file fallback resumes the engine position');
  assert.equal(fallback.video.volume, .3); assert.equal(fallback.video.muted, true); assert.equal(fallback.video.playbackRate, 1.25);
  fallback.events.onError('late failure'); assert.equal(fallback.fallbacks, 1, 'Late callbacks cannot restart fallback');
  fallback.detach();

  const silent = fixture({ audioFailure: true }); await silent.video.play(); await tick();
  assert.equal(silent.fallbacks, 0, 'An audio refusal must retry video without loading the browser MKV element');
  assert.ok(silent.calls.some(([name, request]) => name === 'open' && request.audioOrdinal === -1));
  assert.equal(silent.video.webgpu.silent, true);
  assert.equal(silent.video.dataset.webgpuAudio, 'unavailable');
  silent.detach();

  const stillRefused = fixture({ audioFailure: true, result: { eligible: false, reason: 'audio-codec-unsupported' } }); await tick();
  assert.equal(stillRefused.fallbacks, 1, 'A failed video-only retry falls back once without looping');
  assert.equal(stillRefused.calls.filter(([name]) => name === 'open').length, 2); stillRefused.detach();
  const midPlayback = fixture(); await tick(); await midPlayback.video.play();
  const previousEvents = midPlayback.events;
  previousEvents.onFallback('audio-output-failed', 57000); await tick();
  assert.equal(midPlayback.fallbacks, 0);
  assert.equal(midPlayback.calls.filter(([name]) => name === 'open').at(-1)[1].startMs, 57000);
  assert.equal(midPlayback.notifications.filter(name => name === 'loadedmetadata').length, 1, 'A video-only retry must not reset the saved resume position');
  previousEvents.onError('late audio-output-failed'); assert.equal(midPlayback.fallbacks, 0, 'An old route cannot fail the replacement'); midPlayback.detach();

  const resolved = fixture({ resolvedSource: 'https://cdn.example.test/direct.mkv' }); await tick();
  assert.equal(resolved.calls.find(([name]) => name === 'open')[1].url, 'https://cdn.example.test/direct.mkv', 'The GPU engine opens the resolved CDN source');
  assert.equal(resolved.video.currentSrc, 'https://cdn.example.test/direct.mkv');
  assert.equal(resolved.video.src, 'https://example.test/film.mkv', 'Keep the original source identity for progress');
  resolved.events.onFallback('video-codec-unsupported', 0);
  assert.equal(resolved.fallbackSource, 'https://cdn.example.test/direct.mkv', 'Browser fallback must not reopen the blocked addon redirect'); resolved.detach();

  const refused = fixture({ result: { eligible: false, reason: 'container-unsupported' } }); await tick();
  assert.equal(refused.fallbacks, 1); assert.equal(refused.destroys, 1); refused.detach();
  const cancelled = fixture({ moduleDeferred: true }); await tick(); cancelled.detach(); cancelled.resolveModule(); await tick();
  assert.equal(cancelled.calls.length, 0, 'Close during import cannot create a player'); assert.equal(cancelled.fallbacks, 0);
  const stale = fixture({ deferred: true }); await tick(); stale.detach(); stale.resolveOpen(); await tick();
  assert.equal(stale.fallbacks, 0); assert.ok(!stale.notifications.includes('loadedmetadata'), 'A stale open cannot publish readiness');
  const hung = fixture({ moduleDeferred: true }); await tick(); [...hung.timers.values()][0]();
  assert.equal(hung.fallbacks, 1); hung.resolveModule(); await tick(); assert.equal(hung.calls.length, 0);

  const menuFixture = fixture(); await tick();
  const host = hooks();
  const { DesktopTracks } = load('components/desktop/tracks.tsx', {
    react: host.react, 'react/jsx-runtime': host.jsx, 'lucide-react': { AudioLines: 'icon' },
    '@/components/ui/button': { Button: 'button' }, '@/components/player-settings-menu.module.css': {},
    '@/components/arc/dropdown-menu/dropdown-menu': Object.fromEntries(
      ['DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuOptions'].map(name => [name, name])),
    '@/lib/media/track-label': { trackOptions: tracks => tracks.map((track, index) => ({ value: String(index), label: track.label })) },
  });
  const find = (tree, type) => Array.isArray(tree) ? tree.flatMap(node => find(node, type))
    : !tree || typeof tree !== 'object' ? [] : [...(tree.type === type ? [tree] : []), ...find(tree.props?.children, type)];
  const props = { mediaRef: { current: menuFixture.video }, sourceKey: 'film' };
  const renderMenu = () => host.render(DesktopTracks, props);
  renderMenu(); host.flush();
  let choices = find(renderMenu(), 'DropdownMenuOptions')[0];
  assert.equal(choices.props.value, '1', 'The browser audio menu shows the selected GPU track');
  choices.props.onValueChange('0'); await tick();
  choices = find(renderMenu(), 'DropdownMenuOptions')[0]; assert.equal(choices.props.value, '0');
  menuFixture.events.onFallback('device-lost', 10000);
  const nativeTracks = Object.assign(new EventTarget(), { length: 1, 0: { id: 'native', language: 'en', label: 'Native', enabled: true } });
  menuFixture.video.audioTracks = nativeTracks;
  menuFixture.video.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(find(renderMenu(), 'DropdownMenuOptions')[0].props.options.length, 1, 'Fallback replaces the old audio list');
  const beforeUpdates = host.updates;
  nativeTracks.dispatchEvent(new Event('change')); assert.ok(host.updates > beforeUpdates, 'Listen to the replacement native track list');
  host.unmount(); const afterUnmount = host.updates;
  nativeTracks.dispatchEvent(new Event('change')); assert.equal(host.updates, afterUnmount, 'Unmount removes audio subscriptions');
  menuFixture.detach();

  const { acquirePlaybackProbe } = load('lib/media/playback-probe-lock.ts');
  const first = await acquirePlaybackProbe(new AbortController().signal);
  const abort = new AbortController(); let secondReady = false;
  const second = acquirePlaybackProbe(abort.signal).then(release => { secondReady = true; return release; });
  await tick(); assert.equal(secondReady, false, 'GPU checks run one at a time');
  abort.abort(); assert.equal(await second, undefined); first();
  const third = await acquirePlaybackProbe(new AbortController().signal); assert.equal(typeof third, 'function'); third();

  const globals = { window: { isSecureContext: true }, navigator: { gpu: {} }, VideoDecoder: class {}, AudioWorkletNode: class {}, location: { href: 'https://navigator.test/' }, URL };
  let webGpuPlayback = true;
  const capability = load('lib/media/webgpu-module.ts', { './playback-preferences': { readPlaybackPreferences: () => ({ webGpuPlayback }) } }, globals);
  assert.ok(capability.canUseWebGpu('https://cdn.test/film.mkv'));
  assert.equal(capability.canUseWebGpu('https://cdn.test/live.m3u8?token=one'), false);
  assert.equal(capability.canUseWebGpu('https://cdn.test/film.mpd'), false);
  assert.equal(capability.canUseWebGpu('file:///film.mkv'), false);
  webGpuPlayback = false;
  assert.equal(capability.canUseWebGpu('https://cdn.test/film.mkv'), false, 'WebGPU preference overrides browser support');
  webGpuPlayback = true;
  globals.window.isSecureContext = false;
  assert.equal(capability.canUseWebGpu('https://cdn.test/film.mkv'), false);

  const manifest = require('@aiostreams/webgpu-player/package.json');
  const root = path.join('public/webgpu-player', manifest.version, 'libraries');
  for (const file of ['webgpu-player/EmbeddedPlayer.js', 'webgpu-player/CustomDecode.worker.js', 'webgpu-player/CustomAudioDecode.worker.js',
    'wgpud/hevc.wasm', 'wgpud/dts.wasm', 'wgpud/eac3.wasm', 'wgpud/truehd.wasm', 'wgpud/SOURCE.txt', 'wgpud/FFmpeg-COPYING.LGPLv2.1']) {
    assert.ok(fs.statSync(path.join(root, file)).size > 0, `Runtime includes ${file}`);
  }
  const installed = path.dirname(require.resolve('@aiostreams/webgpu-player/package.json'));
  const { patchWebGpuRuntime } = await import('./webgpu-runtime-patch.mjs');
  for (const file of fs.readdirSync(path.join(installed, 'libraries'), { recursive: true })) {
    const source = path.join(installed, 'libraries', file);
    if (fs.statSync(source).isFile()) {
      const expected = file === 'webgpu-player/EmbeddedPlayer.js' ? Buffer.from(patchWebGpuRuntime(fs.readFileSync(source, 'utf8'), manifest.version)) : fs.readFileSync(source);
      assert.deepEqual(fs.readFileSync(path.join(root, file)), expected, `Preserve runtime bytes except the reviewed video-only adaptation: ${file}`);
    }
  }
  console.log('PASS: webgpu media API, language selection, seeking, frame callbacks, fallback, stale loads, timeout, probe locking, capability gates and runtime integrity');
})().catch(error => { console.error(error); process.exitCode = 1; });
