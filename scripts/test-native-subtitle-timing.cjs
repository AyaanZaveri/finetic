const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const h = hooks(), listeners = new Map(), delays = [];
const controller = { supportsSubtitleTiming: true, tracks: [{ type: 'sub', selected: true, codec: 'subrip' }], setSubtitleDelay: value => delays.push(value) };
const element = { controller, addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) };
const ref = { current: element };
const { useNativeSubtitleTiming } = load('lib/media/use-native-subtitle-timing.ts', { react: h.react });
function render(seconds, external = false, source = 'video-one', native = true) {
    h.render(() => useNativeSubtitleTiming(ref, seconds, external, source, native)); h.flush();
    return h.render(() => useNativeSubtitleTiming(ref, seconds, external, source, native));
}
assert.equal(render(1.2), true); assert.equal(delays.at(-1), 1.2);
render(-.5); assert.equal(delays.at(-1), -.5, 'Earlier offsets reach the native engine even with paused playback');
assert.equal(render(-.5, true), false); assert.equal(delays.at(-1), 0, 'External cues must not also receive the native offset');
render(1.2);
controller.tracks = [{ type: 'sub', selected: true, codec: 'hdmv_pgs_subtitle' }]; listeners.get('trackschange')();
assert.equal(render(1.2), false); assert.equal(delays.at(-1), 0, 'Bitmap tracks keep their original timing');
controller.tracks = [{ type: 'sub', selected: true, codec: 'ass' }]; listeners.get('trackschange')();
assert.equal(render(1.2), true); assert.equal(delays.at(-1), 1.2, 'ASS exposed as app-rendered text can use native timing');
render(0, false, 'video-two'); assert.equal(delays.at(-1), 0, 'A new video applies its own reset value');
controller.supportsSubtitleTiming = false; listeners.get('loadedmetadata')();
assert.equal(render(0, false, 'video-two'), false, 'Older native builds never offer an ineffective control');
element.webgpu = {};
element.textTracks = Object.assign([{ mode: 'showing' }], { addEventListener() {}, removeEventListener() {} });
assert.equal(render(.5, false, 'webgpu-video', false), true, 'WebGPU app-rendered embedded text enables the existing timestamp offset');
assert.equal(render(.5, true, 'webgpu-video', false), false, 'External selection stays separate on WebGPU too');
h.unmount(); assert.equal(listeners.size, 0);
console.log('PASS: native text timing signs, paused adjustment, external/bitmap isolation, track changes, per-video reset, old-build gating, and listener cleanup');

const audioHost = hooks(), audioDelays = [];
const { useAudioDelay } = load('lib/media/use-audio-delay.ts', { react: audioHost.react });
controller.supportsAudioTiming = true;
controller.tracks = [{ type: 'audio', selected: true }];
controller.setAudioDelay = value => audioDelays.push(value);
function renderAudio(seconds, source = 'video-one') {
    audioHost.render(() => useAudioDelay(ref, seconds, source)); audioHost.flush();
    return audioHost.render(() => useAudioDelay(ref, seconds, source));
}
assert.equal(renderAudio(.3), true); assert.equal(audioDelays.at(-1), .3);
assert.equal(renderAudio(-.8), true); assert.equal(audioDelays.at(-1), -.8);
controller.tracks = [];
listeners.get('emptied')();
assert.equal(renderAudio(-.8), false);
controller.tracks = [{ type: 'audio', selected: true }];
listeners.get('loadedmetadata')();
assert.equal(renderAudio(-.8), true); assert.equal(audioDelays.at(-1), -.8);
assert.equal(renderAudio(0, 'video-two'), true); assert.equal(audioDelays.at(-1), 0);
controller.supportsAudioTiming = false;
listeners.get('trackschange')();
assert.equal(renderAudio(0, 'video-two'), false);
const count = audioDelays.length;
ref.current = { ...element, controller: undefined, webgpu: {} };
assert.equal(renderAudio(1, 'webgpu-video'), false);
assert.equal(audioDelays.length, count, 'WebGPU and old native releases must not receive an unsupported command');
audioHost.unmount(); assert.equal(listeners.size, 0);
console.log('PASS: native audio offset, source replacement, reset, capability gating and listener cleanup');
