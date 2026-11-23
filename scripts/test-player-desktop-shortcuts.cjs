const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { hooks, load } = require('./test-support/react-hooks.cjs');
const { createKeyboardScrubber, KEYBOARD_SEEK_STEP } = load('lib/media/keyboard-scrubbing.ts', {}, { performance });
const source = process.argv.includes('--baseline')
  ? require('node:child_process').execFileSync('git', ['show', 'HEAD:components/ui/media-player.tsx'], { encoding: 'utf8' })
  : fs.readFileSync('components/ui/media-player.tsx', 'utf8');
const parsed = ts.createSourceFile('player.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const implementation = parsed.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'MediaPlayerRootImpl');

function mount({ native = true, autoFocus = true, platform = 'windows', scrubClock, onToggleCaptions, onAdjustSubtitleSize } = {}) {
  const host = hooks(), listeners = new Map(), sent = [], timers = new Map();
  let timerId = 0;
  class Element {
    constructor(kind = '') { this.kind = kind; }
    closest(selector) { return this.kind && selector.includes(this.kind) ? this : null; }
    hasAttribute() { return false; }
  }
  const document = {
    activeElement: null, body: new Element(), documentElement: new EventTarget(), focused: true, overlay: false,
    hasFocus() { return this.focused; },
    querySelector() { return this.overlay ? new Element() : null; },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
  };
  const root = new Element('[data-slot="media-player"]');
  root.focus = () => { document.activeElement = root; };
  root.contains = target => target === root;
  root.querySelector = () => root.framing ?? null;
  class Video extends Element {
    constructor() { super(); Object.assign(this, { currentTime: 30, duration: 100, volume: .5, paused: false, muted: false, playbackRate: 1.25 }); }
    events = new EventTarget();
    addEventListener(...args) { this.events.addEventListener(...args); }
    removeEventListener(...args) { this.events.removeEventListener(...args); }
    play() { this.paused = false; sent.push({ type: 'media.play', rate: this.playbackRate }); return Promise.resolve(); }
    pause() { this.paused = true; sent.push({ type: 'media.pause', rate: this.playbackRate }); this.events.dispatchEvent(new Event('pause')); }
    closest(selector) { return selector === '[data-slot="media-player-video"]' ? this : null; }
    setPointerCapture(id) { this.captured = id; }
  }
  const media = new Video();
  const timer = {
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  const { createPlaybackSpeedHold } = load('lib/media/playback-speed-hold.ts', {}, timer);
  const state = { controlsVisible: true, dragging: false, seekMode: null, menuOpen: false, seekPreviewTime: null };
  const store = { setState(key, value) { state[key] = value; }, getState: () => state };
  const actions = Object.fromEntries(['SEEK', 'VOLUME', 'MUTE', 'UNMUTE', 'PLAY', 'PAUSE'].map(key => [`MEDIA_${key}_REQUEST`, key]));
  const context = { exports: {}, document, window: new EventTarget(), Element, Node: Element, HTMLVideoElement: Video,
    createKeyboardScrubber: options => createKeyboardScrubber(options, scrubClock), KEYBOARD_SEEK_STEP, createPlaybackSpeedHold, React: { ...host.react, useLayoutEffect: host.react.useEffect, useId: () => 'id' },
    jsx: host.jsx.jsx, jsxs: host.jsx.jsxs, useMediaFullscreenRef: () => null,
    useComposedRefs: (...refs) => node => refs.forEach(ref => { if (ref && typeof ref === 'object') ref.current = node; }),
    useDirection: () => 'ltr', useMediaDispatch: () => action => {
      sent.push(action);
      // Media Chrome applies seek requests to the media element synchronously.
      if (action.type === actions.MEDIA_SEEK_REQUEST) media.currentTime = action.detail;
    },
    useStoreContext: () => store, useStoreSelector: selector => selector(state),
    useMediaSelector: selector => selector({ mediaPaused: false }), desktopBridge: () => native ? { platform } : null,
    setMacOSWindowControlsVisible() {}, playerControlsActive: () => false,
    MediaPlayerContext: { Provider: 'Provider' }, MediaPlayerVolumeIndicator: 'Volume', FastForwardIcon: 'FastForward',
    playerControlSelector: '[data-player-control]',
    ROOT_NAME: 'MediaPlayer', FLOATING_MENU_SIDE_OFFSET: 10, cn: () => '', SEEK_STEP_SHORT: 5, MediaActionTypes: actions,
    ...timer,
  };
  vm.runInNewContext(ts.transpileModule(`${implementation.getText(parsed)}\nexports.Root = MediaPlayerRootImpl;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'test' },
  }).outputText.replace(/require\("test\/jsx-runtime"\)/g, '({ jsx, jsxs })'), context);
  const props = { autoFocus, autoHide: true, onToggleCaptions, onAdjustSubtitleSize };
  let tree = host.render(context.exports.Root, props);
  tree.props.children.props.ref(root);
  tree.props.value.mediaRef.current = media;
  host.flush();
  document.activeElement = document.body;
  state.controlsVisible = false;
  function key(key, target = document.body, extra = {}) {
    const event = { key, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    if (target === root || target.inPlayer) tree.props.children.props.onKeyDown(event);
    for (const listener of listeners.get('keydown') ?? []) listener(event);
    if (!extra.hold) release(key);
    return event;
  }
  function release(key) { for (const listener of listeners.get('keyup') ?? []) listener({ key }); }
  return { key, release, sent, state, root, media, Element, document, listeners, unmount: host.unmount,
    fireHoldTimer(delay = 350) {
      const entry = [...timers].find(([, pending]) => pending.delay === delay);
      if (entry) { timers.delete(entry[0]); entry[1].fn(); }
      return Boolean(entry);
    },
    pointer(type, target = media, extra = {}) {
      const event = { type, target, pointerId: 1, clientX: 10, clientY: 10, pointerType: 'mouse',
        button: 0, isPrimary: true, isTrusted: true, defaultPrevented: false, ...extra };
      for (const listener of listeners.get(type) ?? []) listener(event);
      if (type === 'pointerdown') tree.props.children.props.onPointerDownCapture(event);
    },
    click() {
      const event = { target: media, detail: 1, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
      tree.props.children.props.onClickCapture(event);
      return event.defaultPrevented;
    },
    mouseDown(target, extra = {}) {
      const event = { target, button: 0, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, ...extra };
      tree.props.children.props.onMouseDownCapture?.(event);
      // The browser focuses the clicked button unless mousedown was canceled.
      if (!event.defaultPrevented) document.activeElement = target;
      return event;
    },
    rerender() { tree = host.render(context.exports.Root, props); host.flush(); return tree.props.value.keyboardScrubber; },
    get scrubber() { return tree.props.value.keyboardScrubber; } };
}
if (!process.argv.includes('--baseline')) {
  const player = mount({ native: false });
  player.rerender();
  player.root.focus();
  const space = extra => player.key(' ', player.root, { hold: true, ...extra });
  space();
  assert.equal(player.media.playbackRate, 1.25);
  space({ repeat: true });
  assert.equal(player.fireHoldTimer(), true);
  assert.equal(player.fireHoldTimer(), false, 'Keyboard repeat never arms another boost');
  assert.equal(player.media.playbackRate, 2);
  player.release(' ');
  assert.equal(player.media.playbackRate, 1.25);
  assert.deepEqual(player.sent, [], 'Releasing a boost never pauses the video');

  player.pointer('pointerdown');
  player.pointer('pointerup');
  assert.equal(player.click(), false, 'A short click still reaches the video');
  player.pointer('pointerdown');
  assert.equal(player.media.captured, 1);
  player.pointer('pointermove', player.media, { clientX: 14 });
  assert.equal(player.fireHoldTimer(), true, 'Small pointer movements keep the hold armed');
  assert.equal(player.media.playbackRate, 2);
  player.pointer('pointerup', player.root, { pointerId: 2 });
  assert.equal(player.media.playbackRate, 2, 'A different pointer does not release the hold');
  player.pointer('pointerup', player.root);
  assert.equal(player.media.playbackRate, 1.25);
  assert.equal(player.click(), true, 'The click after a hold never reaches play/pause');

  player.pointer('pointerdown');
  player.pointer('pointermove', player.root, { clientX: 35 });
  assert.equal(player.fireHoldTimer(), false, 'A drag cancels a pending hold');
  assert.equal(player.click(), true);
  player.pointer('pointerdown', new player.Element('button'));
  assert.equal(player.fireHoldTimer(), false, 'A control never starts the video gesture');
  player.pointer('pointerdown', player.media, { pointerType: 'touch' });
  player.pointer('pointermove', player.media, { pointerType: 'touch', clientX: 35 });
  assert.equal(player.fireHoldTimer(), false, 'Touch movement before the hold threshold leaves swipes available');
  player.pointer('pointerup', player.media, { pointerType: 'touch' });

  player.pointer('pointerdown');
  player.fireHoldTimer();
  player.pointer('pointercancel');
  assert.equal(player.media.playbackRate, 1.25);
  player.click();
  space();
  player.fireHoldTimer();
  player.document.hidden = true;
  for (const listener of player.listeners.get('visibilitychange')) listener();
  assert.equal(player.media.playbackRate, 1.25);
  player.document.hidden = false;
  player.media.paused = true;
  space(); player.release(' ');
  assert.equal(player.sent.pop().type, 'PLAY', 'A short Space tap still toggles paused playback');
  space();
  assert.equal(player.media.paused, true, 'A press waits for the hold threshold');
  player.fireHoldTimer();
  assert.equal(player.media.paused, false, 'Holding Space plays temporarily from pause');
  assert.equal(player.media.playbackRate, 2);
  player.release(' ');
  assert.equal(player.media.paused, true);
  assert.equal(player.media.playbackRate, 1.25);
  assert.deepEqual(player.sent.splice(0), [{ type: 'media.play', rate: 2 }, { type: 'media.pause', rate: 2 }], 'Start at 2× and pause before restoring the prior rate');
  for (const pointerType of ['mouse', 'touch', 'pen']) {
    player.pointer('pointerdown', player.media, { pointerType });
    player.fireHoldTimer();
    assert.equal(player.media.paused, false, `${pointerType} starts temporary playback`);
    player.pointer('pointerup', player.media, { pointerType });
    assert.equal(player.media.paused, true, `${pointerType} release restores pause`);
    assert.equal(player.media.playbackRate, 1.25);
    assert.equal(player.click(), true, 'Suppress the click generated by a completed hold');
  }
  player.pointer('pointerdown', player.media, { pointerType: 'touch' });
  player.fireHoldTimer();
  player.pointer('pointercancel', player.media, { pointerType: 'touch' });
  assert.equal(player.media.paused, true, 'Native gesture takeover cancels temporary playback');
  assert.equal(player.media.playbackRate, 1.25);
  player.media.paused = false;
  space();
  player.fireHoldTimer();
  player.media.events.dispatchEvent(new Event('seeking'));
  assert.equal(player.media.playbackRate, 1.25);
  space();
  player.fireHoldTimer();
  player.unmount();
  assert.equal(player.media.playbackRate, 1.25, 'Unmount restores the original speed');
  console.log('PASS: temporary Space and mouse playback speed, original speed restoration, tap/click parity, and cancellation');
}
for (const native of [true, false]) {
  let toggles = 0, framing = 0;
  const sizeSteps = [];
  const player = mount({ native, onToggleCaptions: () => { toggles++; }, onAdjustSubtitleSize: direction => sizeSteps.push(direction) });
  player.rerender();
  player.root.focus();
  player.root.framing = { click: () => { framing++; } };
  assert.equal(player.key('c', player.root).defaultPrevented, true);
  assert.equal(player.key('A', player.root).defaultPrevented, true);
  for (const key of ['c', 'a']) {
    player.key(key, player.root, { repeat: true });
    player.key(key, player.root, { metaKey: true });
    player.key(key, new player.Element('input'));
  }
  assert.equal(toggles, 1, 'C uses the player caption action even without browser text tracks');
  assert.equal(framing, 1, 'A uses the same action as the framing button');
  assert.equal(player.key('+', player.root, { shiftKey: true }).defaultPrevented, true);
  assert.equal(player.key('-', player.root).defaultPrevented, true);
  const captionsButton = new player.Element('button');
  captionsButton.inPlayer = true;
  const closest = captionsButton.closest.bind(captionsButton);
  captionsButton.closest = selector => player.root.closest(selector) || closest(selector);
  player.document.activeElement = captionsButton;
  assert.equal(player.key('=', captionsButton).defaultPrevented, true, 'Size shortcuts work after the captions menu returns focus');
  assert.equal(player.key('+', player.root, { ctrlKey: true }).defaultPrevented, false, 'Preserve browser zoom shortcuts');
  for (const role of ['input', '[role="menu"]', '[role="slider"]']) {
    const target = new player.Element(role);
    target.inPlayer = true;
    assert.equal(player.key('-', target).defaultPrevented, false, 'Leave editing and menu keys to the focused control');
  }
  assert.deepEqual(sizeSteps, [1, -1, 1]);
  player.root.focus();
  player.root.framing = null;
  assert.equal(player.key('a', player.root).defaultPrevented, false, 'Unsupported framing leaves A available');
  player.unmount();
}
// Reproduce mouse fullscreen click -> Space using the real root handlers.
// The same React controls are used by Windows, macOS and the web player.
for (const options of [{ platform: 'windows' }, { platform: 'macos' }, { native: false }]) {
  const player = mount(options);
  player.rerender(); // Media ref is ready, including the browser video path.
  for (const slot of ['fullscreen', 'play-button', 'seek-backward', 'seek-forward', 'volume-trigger', 'loop', 'pip', 'captions', 'download']) {
    const button = new player.Element('button');
    button.inPlayer = true;
    button.getAttribute = name => name === 'data-slot' ? `media-player-${slot}` : null;
    const down = player.mouseDown(button);
    assert.equal(down.defaultPrevented, true, `${slot}: mouse must not leave button focused`);
    assert.equal(player.document.activeElement, player.root, `${slot}: shortcuts stay on player`);
    const before = player.sent.length;
    const space = player.key(' ', player.document.activeElement);
    assert.equal(space.defaultPrevented, true, `${slot}: suppress native Space activation`);
    assert.equal(player.sent.length, before + 1, `${slot}: Space toggles playback exactly once`);
    assert.equal(player.sent.at(-1).type, 'PAUSE');
    const position = player.media.currentTime;
    assert.equal(player.key('ArrowRight', player.document.activeElement).defaultPrevented, true);
    assert.equal(player.sent.at(-1).detail, position + 10, `${slot}: Right seeks forward ten seconds after a mouse click`);
    assert.equal(player.key('ArrowLeft', player.document.activeElement).defaultPrevented, true);
    assert.equal(player.sent.at(-1).detail, position, `${slot}: Left seeks back ten seconds after a mouse click`);
    // Tab focus must retain native Space/Enter activation of the button.
    player.document.activeElement = button;
    const keyboardBefore = player.sent.length;
    assert.equal(player.key(' ', button).defaultPrevented, false);
    assert.equal(player.sent.length, keyboardBefore, `${slot}: preserve keyboard button activation`);
  }
  for (const kind of ['input', '[role="slider"]', 'button']) {
    const target = new player.Element(kind);
    target.getAttribute = () => null; // Includes menu/settings and custom buttons.
    assert.equal(player.mouseDown(target).defaultPrevented, false, `${kind}: keep normal focus`);
  }
  const fullscreen = new player.Element('button');
  fullscreen.getAttribute = () => 'media-player-fullscreen';
  assert.equal(player.mouseDown(fullscreen, { button: 2 }).defaultPrevented, false, 'Right click keeps normal behavior');
  player.unmount();
}
console.log('PASS: mouse transport focus and keyboard button activation on Windows, macOS and web.');
const p = mount();
p.key('ArrowRight');
assert.equal(p.sent.at(-1)?.detail, 40, 'Desktop seeks without a prior click on the player');
for (const target of [50, 60, 70]) {
  p.key('ArrowRight');
  assert.equal(p.sent.at(-1)?.detail, target, 'Repeated arrows must accumulate immediately without a trailing throttle');
}
p.media.currentTime = 80;
p.key('ArrowRight'); assert.equal(p.sent.at(-1).detail, 90, 'Read the live media time after a pointer scrub');
p.key('ArrowLeft'); assert.equal(p.sent.at(-1).detail, 80, 'Direction reversal must not leave a delayed forward seek');
assert.equal(p.state.controlsVisible, true, 'Seeking may reveal transport controls');
p.state.controlsVisible = false;
p.key('ArrowUp');
assert.equal(p.state.controlsVisible, false, 'Volume does not reveal hidden transport controls');
assert.equal(p.state.volumeIndicatorVisible, true, 'Volume still gives compact visual feedback');
p.key('m');
assert.equal(p.state.controlsVisible, false, 'Mute does not reveal transport controls');
for (const kind of ['textarea', 'input', 'select', '[contenteditable]', '[role="textbox"]', '[role="menu"]', '[role="dialog"]', '[role="slider"]', 'button', 'a[href]']) {
  const before = p.sent.length;
  p.key('ArrowRight', new p.Element(kind));
  assert.equal(p.sent.length, before, `Preserve keyboard interaction for ${kind}`);
}
for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }]) {
  const before = p.sent.length; p.key('k', undefined, extra); assert.equal(p.sent.length, before);
}
p.document.overlay = true;
let before = p.sent.length; p.key('k'); assert.equal(p.sent.length, before, 'Open Navigator/dialog keeps keyboard ownership even if focus is on body');
p.document.overlay = false;
p.document.focused = false;
p.key('k'); assert.equal(p.sent.length, before, 'Do not handle background-app shortcuts');
p.document.focused = true;
p.key('k', p.root);
assert.equal(p.sent.length, before + 1, 'Player-bubbled keys execute once, not twice');
p.state.controlsVisible = false;
p.key('AudioVolumeUp');
assert.equal(p.state.controlsVisible, false, 'OS volume keys do not reveal transport controls');
assert.equal(p.sent.length, before + 1, 'Do not also change playback volume for OS hardware volume keys');
p.unmount();
assert.equal(p.listeners.get('keydown')?.size, 0, 'Remove global shortcut listener when player closes');
for (const options of [{ native: false }, { autoFocus: false }]) {
  const embedded = mount(options); embedded.key('ArrowRight');
  assert.equal(embedded.sent.length, 0, 'Web/embedded players do not take app-wide desktop shortcuts');
  embedded.unmount();
}
console.log('PASS: desktop app-focused shortcuts, interactive UI exclusions, quiet volume feedback, exactly-once handling and cleanup.');
let now = 0, id = 0;
const scrubTimers = new Map(), frames = new Map();
const hold = mount({ scrubClock: {
  now: () => now, set(fn, ms) { scrubTimers.set(++id, { fn, at: now + ms }); return id; }, clear(id) { scrubTimers.delete(id); },
  frame(fn) { frames.set(++id, fn); return id; }, cancelFrame(id) { frames.delete(id); },
} });
function advance(ms) {
  now += ms;
  for (const [key, timer] of [...scrubTimers]) if (timer.at <= now) { scrubTimers.delete(key); timer.fn(); }
  const work = [...frames]; frames.clear(); work.forEach(([, fn]) => fn());
}
hold.key('ArrowRight', undefined, { hold: true }); advance(300);
assert.equal(hold.state.seekMode, 'keyboard');
const controller = hold.scrubber;
assert.equal(hold.rerender(), controller, 'Store updates and Media Chrome dispatch callback changes must not replace the active scrubber');
advance(100);
assert.ok(Math.abs(hold.state.seekPreviewTime - 46.15) < 1e-9);
assert.equal(hold.sent.filter(action => action.type === 'SEEK').length, 1, 'A hold previews without seeking every frame');
hold.release('ArrowRight');
assert.ok(Math.abs(hold.sent.filter(action => action.type === 'SEEK').at(-1).detail - 46.15) < 1e-9);
assert.equal(hold.sent.at(-1).type, 'PLAY');
assert.equal(hold.state.seekMode, null);
hold.key('ArrowRight', undefined, { hold: true }); advance(300);
const seeksBeforeHide = hold.sent.filter(action => action.type === 'SEEK').length;
hold.document.hidden = true;
for (const listener of hold.listeners.get('visibilitychange') ?? []) listener();
advance(10000); hold.release('ArrowRight');
assert.equal(hold.sent.filter(action => action.type === 'SEEK').length, seeksBeforeHide, 'Backgrounding cancels the hold without a late elapsed-time seek');
assert.equal(hold.state.seekMode, null);
hold.unmount(); assert.equal(frames.size + scrubTimers.size, 0);
console.log('PASS: mounted player hold lifecycle survives React updates and commits once on global key release.');
require('./test-keyboard-seeking.cjs');
require('./test-keyboard-scrubbing.cjs');
