const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { hooks, load } = require('./test-support/react-hooks.cjs');
const parsed = ts.createSourceFile('player.tsx', fs.readFileSync('components/ui/media-player.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'MediaPlayerSeek');
const clock = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'MediaPlayerTime');
const h = hooks(), sent = [];
const media = { currentTime: 8 };
const state = { seekMode: null, menuOpen: false, dragging: false, seekPreviewTime: null };
const mediaState = { mediaCurrentTime: 8, mediaSeekable: [0, 120] };
const context = { exports: {}, React: h.react, jsx: h.jsx.jsx, jsxs: h.jsx.jsxs,
    SEEK_NAME: 'Seek', KEYBOARD_SEEK_STEP: 10, SEEK_STEP_LONG: 10,
    SEEK_COLLISION_PADDING: 10, SEEK_TOOLTIP_WIDTH_FALLBACK: 240, SEEK_HOVER_PERCENT: '--hover', SEEK_TOOLTIP_X: '--x', SEEK_TOOLTIP_Y: '--y',
    useMediaPlayerContext: () => ({ mediaRef: { current: media }, rootRef: { current: null }, chapters: [], keyboardScrubber: context.keyboardInstance }),
    useStoreContext: () => ({ getState: () => state, setState(key, value) { state[key] = value; } }),
    useMediaDispatch: () => action => { sent.push(action); if (action.type === 'seek') media.currentTime = action.detail; },
    useMediaSelector: select => select(mediaState), useStoreSelector: select => select(state),
    MediaActionTypes: { MEDIA_SEEK_REQUEST: 'seek', MEDIA_PREVIEW_REQUEST: 'preview' },
    SliderPrimitive: { Root: 'slider', Track: 'track', Range: 'range', Thumb: 'thumb' },
    PlayerSkipTimeline: 'skips', boundSkipChapterLabels: () => [], chapterTrackMask: () => undefined,
    timeUtils: require('media-chrome/utils/time'), cn: () => '', Date, clearTimeout, cancelAnimationFrame() {},
};
vm.runInNewContext(ts.transpileModule(`${component.getText(parsed)}\n${clock.getText(parsed)}\nexports.Seek = MediaPlayerSeek; exports.Time = MediaPlayerTime;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'test' },
}).outputText.replace(/require\("test\/jsx-runtime"\)/g, '({ jsx, jsxs })'), context);
function slider(props = {}) { return h.render(context.exports.Seek, props).props.children[0]; }
let bar = slider();
assert.equal(typeof bar.props.onKeyDown, 'function', 'The focused timeline must override the 0.01-second pointer step for keyboard seeks');
function key(name, extra = {}) {
    const event = { key: name, defaultPrevented: false, nativeEvent: {}, preventDefault() { this.defaultPrevented = true; }, ...extra };
    bar.props.onKeyDown(event);
    return event;
}
for (const time of [18, 28, 38]) {
    assert.equal(key('ArrowRight').defaultPrevented, true, 'Prevent the slider and parent from also seeking');
    assert.equal(media.currentTime, time, 'Held arrows advance by ten seconds even before React rerenders');
}
bar.props.onValueCommit([80]);
assert.equal(key('ArrowRight').defaultPrevented, true);
assert.equal(media.currentTime, 90, 'After clicking the scrubber, seek from the new position rather than its stale render');
key('ArrowLeft'); assert.equal(media.currentTime, 80);
media.currentTime = 119; key('ArrowRight'); assert.equal(media.currentTime, 120);
media.currentTime = 2; key('ArrowLeft'); assert.equal(media.currentTime, 0);
const before = sent.length;
key('ArrowRight', { ctrlKey: true }); key('ArrowRight', { metaKey: true }); key('ArrowRight', { nativeEvent: { isComposing: true } });
assert.equal(sent.length, before, 'Preserve system shortcuts and composition');
bar = slider({ onKeyDown: event => event.preventDefault() }); key('ArrowRight');
assert.equal(sent.length, before, 'Respect caller keyboard ownership');
bar = slider({ disabled: true }); key('ArrowRight'); assert.equal(sent.length, before);

// Exercise the real timeline subscription without React renders between frames.
const { createKeyboardScrubber } = load('lib/media/keyboard-scrubbing.ts');
const visualHost = hooks();
let now = 0, begin, frame, measurements = 0;
const attributes = new Set();
const style = () => ({ setProperty(key, value) { this[key] = value; } });
const timeline = { style: style(), getBoundingClientRect() { measurements++; return { left: 0, top: 100, width: 1000 }; },
    hasAttribute: name => attributes.has(name), setAttribute: name => attributes.add(name), removeAttribute: name => attributes.delete(name) };
Object.assign(context, { React: visualHost.react, jsx: visualHost.jsx.jsx, jsxs: visualHost.jsx.jsxs, window: { innerWidth: 1280 } });
Object.assign(media, { currentTime: 8, duration: 120, paused: false });
context.keyboardInstance = createKeyboardScrubber({
    media: () => media, seek: time => media.currentTime = time, pause() {}, play() {}, preview() {}, reducedMotion: () => false,
}, { now: () => now, set(fn) { begin = fn; return 1; }, clear() {}, frame(fn) { frame = fn; return 1; }, cancelFrame() {} });
const visual = visualHost.render(context.exports.Seek, {}).props.children[0];
visual.props.ref.current = timeline;
const track = visual.props.children.find(node => node?.props?.['data-slot'] === 'media-player-seek-track');
const fill = track.props.children.find(node => node?.props?.['data-slot'] === 'media-player-keyboard-range');
assert.equal(visual.props.children.some(node => node?.props?.['data-slot'] === 'media-player-keyboard-thumb'), false, 'Continuous scrubbing uses the bar without an extra dot');
fill.props.ref.current = { style: style() };
visual.props.onKeyDown({ key: 'ArrowRight', nativeEvent: {}, repeat: true, preventDefault() {} });
assert.equal(attributes.has('data-arrow-seeking'), true, 'Horizontal arrow seeking suppresses the timeline ring immediately');
visual.props.onBlur({});
assert.equal(attributes.has('data-arrow-seeking'), false, 'Returning focus with Tab can show the ring again');
visualHost.flush();
context.keyboardInstance.press('arrowright'); now = 300; begin();
const measuredAtStart = measurements, rendersAtStart = visualHost.updates;
now = 350; frame();
assert.ok(Math.abs(parseFloat(fill.props.ref.current.style['--keyboard-seek-inset']) - (1 - 21.0375 / 120) * 100) < 1e-12, 'Clip the keyboard fill at its position without scaling its rounded cap');
assert.equal(fill.props.ref.current.style.transform, undefined, 'Keep the end cap circular instead of compressing it horizontally');
now = 400; frame();
assert.ok(Math.abs(parseFloat(fill.props.ref.current.style['--keyboard-seek-inset']) - (1 - 24.15 / 120) * 100) < 1e-12);
assert.equal(measurements, measuredAtStart, 'Display frames must not measure layout');
assert.equal(visualHost.updates, rendersAtStart, 'Display frames must not schedule React state updates');
context.keyboardInstance.release('arrowright');
assert.equal(attributes.has('data-keyboard-scrubbing'), false, 'Release restores the normal slider presentation');
visualHost.unmount(); context.keyboardInstance.dispose();

state.seekPreviewTime = null;
Object.assign(mediaState, { mediaCurrentTime: 1670, mediaSeekable: undefined, mediaDuration: NaN });
bar = slider();
assert.equal(bar.props.disabled, true, 'A source without a seekable range cannot be scrubbed');
assert.ok(bar.props.max > bar.props.min, 'The slider must have a nonzero span even when disabled');
assert.equal(bar.props.value[0], bar.props.min, 'A resume position without a range must leave the track empty');
const clockHost = hooks();
Object.assign(context, { React: clockHost.react, jsx: clockHost.jsx.jsx, jsxs: clockHost.jsx.jsxs });
const readClock = () => clockHost.render(context.exports.Time, {}).props.children.map(child => child.props.children).join(' ');
assert.equal(readClock(), '27:50 / --:--');
mediaState.mediaDuration = 2640;
assert.equal(readClock(), '27:50 / 44:00', 'The clock uses duration even before the stream is seekable');
mediaState.mediaSeekable = [0, 2640];
Object.assign(context, { React: h.react, jsx: h.jsx.jsx, jsxs: h.jsx.jsxs });
bar = slider();
assert.equal(bar.props.disabled, false);
assert.equal(bar.props.value[0], 1670, 'The bar resumes from the media position when the range arrives');

const crypto = require('node:crypto');
const { MpvController } = load('lib/desktop/mpv-controller.ts', {}, { Event, EventTarget, CustomEvent, DOMException, URL, crypto });
for (const platform of ['macos', 'windows', 'android', 'ios']) {
    let receive;
    const messages = [];
    const controller = new MpvController({ platform, send: m => messages.push(m), subscribe(fn) { receive = fn; return () => {}; } });
    controller.load('https://example.test/video.mkv');
    const session = messages.find(m => m.type === 'load').session;
    const snapshot = { position: 8, duration: 120, paused: false, buffering: false, seeking: false };
    receive({ type: 'state', session, state: snapshot });
    controller.currentTime = 80;
    controller.currentTime += 5;
    assert.equal(messages.at(-1).position, 85, `${platform}: a key after scrubbing must build on the requested position before native acknowledgement`);
    receive({ type: 'state', session, state: snapshot });
    assert.equal(controller.currentTime, 85, `${platform}: stale native telemetry must not undo the seek target`);
    receive({ type: 'state', session, state: { ...snapshot, position: 85 } });
    receive({ type: 'state', session, state: { ...snapshot, position: 86 } });
    assert.equal(controller.currentTime, 86, `${platform}: live playback resumes after acknowledgement`);
    controller.dispose();
}
console.log('PASS: focused timeline ten-second keys, repeat accumulation, scrub then seek, bounds, keyboard ownership and native pending seek acknowledgement.');
