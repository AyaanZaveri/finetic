const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { hooks, load } = require('./test-support/react-hooks.cjs');
const { createKeyboardScrubber } = load('lib/media/keyboard-scrubbing.ts', {}, { performance });
const { createPlaybackSpeedHold } = load('lib/media/playback-speed-hold.ts');

// Run the actual root, committing refs before effects, as React does.
const source = fs.readFileSync('components/ui/media-player.tsx', 'utf8');
const parsed = ts.createSourceFile('player.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const implementation = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'MediaPlayerRootImpl');
assert.ok(implementation);
function mount(props) {
  const host = hooks();
  const document = { activeElement: {}, body: {}, documentElement: new EventTarget(), addEventListener() {}, removeEventListener() {} };
  let focusCount = 0;
  const root = { focus(options) { assert.equal(options.preventScroll, true); document.activeElement = root; focusCount++; },
    closest: () => root };
  class Video { constructor() { this.currentTime = 30; this.duration = 100; } }
  const media = new Video();
  const dispatched = [];
  const state = { controlsVisible: true, dragging: false, seekMode: null, menuOpen: false };
  const store = { setState(key, value) { state[key] = value; } };
  const context = { exports: {}, document, window: new EventTarget(), HTMLVideoElement: Video, Element: class {},
    createKeyboardScrubber, createPlaybackSpeedHold, React: { ...host.react, useLayoutEffect: host.react.useEffect, useId: () => 'id' },
    jsx: host.jsx.jsx, jsxs: host.jsx.jsxs,
    useMediaFullscreenRef: () => null,
    useComposedRefs: (...refs) => node => refs.forEach(ref => { if (ref && typeof ref === 'object') ref.current = node; }),
    useDirection: () => 'ltr', useMediaDispatch: () => action => dispatched.push(action),
    useStoreContext: () => store, useStoreSelector: selector => selector(state),
    useMediaSelector: selector => selector({ mediaPaused: true }), desktopBridge: () => null, setMacOSWindowControlsVisible() {},
    MediaPlayerContext: { Provider: 'Provider' }, MediaPlayerVolumeIndicator: 'VolumeIndicator', FastForwardIcon: 'FastForward',
    ROOT_NAME: 'MediaPlayer', FLOATING_MENU_SIDE_OFFSET: 10, cn: () => '',
    SEEK_STEP_SHORT: 5, MediaActionTypes: { MEDIA_SEEK_REQUEST: 'seek' },
    setTimeout, clearTimeout,
  };
  vm.runInNewContext(ts.transpileModule(`${implementation.getText(parsed)}\nexports.Root = MediaPlayerRootImpl;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: 'test' },
  }).outputText.replace(/require\("test\/jsx-runtime"\)/g, '({ jsx, jsxs })'), context);
  let tree;
  function render(nextProps = props, ready = false) {
    if (tree) tree.props.value.mediaRef.current = ready ? media : null;
    tree = host.render(context.exports.Root, nextProps);
    tree.props.children.props.ref(root);
    tree.props.value.mediaRef.current = ready ? media : null;
    host.flush();
  }
  render();
  return { document, root, dispatched, render, get focusCount() { return focusCount; },
    key(key) { tree.props.children.props.onKeyDown({ key, target: root, preventDefault() {} }); },
    unmount: host.unmount };
}
const player = mount({ autoFocus: true });
assert.equal(player.document.activeElement, player.root, 'Opening the player focuses it before the video loads');
player.render({ autoFocus: true }, true);
player.key('ArrowRight');
assert.equal(player.dispatched.at(-1)?.detail, 40, 'ArrowRight seeks immediately without a click');
const input = {};
player.document.activeElement = input;
player.render({ autoFocus: true }, true);
assert.equal(player.document.activeElement, input, 'Playback updates do not steal focus from other controls');
assert.equal(player.focusCount, 1);
player.unmount();
const disabled = mount({ autoFocus: true, disabled: true });
assert.equal(disabled.focusCount, 0); disabled.unmount();
const embedded = mount({});
assert.equal(embedded.focusCount, 0, 'Embedded players opt into initial focus'); embedded.unmount();
assert.match(fs.readFileSync('components/global-media-player.tsx', 'utf8'), /<MediaPlayer\s+autoFocus\b/,
  'The visible playback surface opts into initial focus');
console.log('PASS: initial player focus, immediate arrow seeking, disabled/embedded players and no focus stealing on updates');
