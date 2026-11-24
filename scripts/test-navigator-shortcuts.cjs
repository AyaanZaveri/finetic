const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, globals, dependencies = {}) {
  const context = { exports: {}, ...globals, require: name => dependencies[name] || require(name) };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context, { filename: file });
  return context.exports;
}
// Execute the player's real React handler before bubbling to the global listener.
const source = fs.readFileSync('components/ui/media-player.tsx', 'utf8');
const parsed = ts.createSourceFile('player.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function walk(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'onKeyDown' && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0].getText(parsed);
  ts.forEachChild(node, walk);
}
walk(parsed); assert.ok(callback);
class Element { closest() { return null; } }
const media = { paused: false, closest: () => ({}) };
const dispatched = [];
const context = { exports: {}, Element, disabled: false, rootImplProps: {}, mediaRef: { current: media },
  document: { activeElement: media }, autoHide: false, dispatch: action => dispatched.push(action),
  MediaActionTypes: { MEDIA_PAUSE_REQUEST: 'pause', MEDIA_PLAY_REQUEST: 'play' } };
vm.runInNewContext(ts.transpileModule(`exports.handle = ${callback}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, context);
function key(modifiers = {}) {
  return { key: 'k', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false,
    defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...modifiers };
}
for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
  const event = key(modifiers); context.exports.handle(event);
  assert.equal(dispatched.length, 0, 'Modified K must never pause playback');
  assert.equal(event.defaultPrevented, false, 'Leave application shortcuts available');
}
context.exports.handle(key()); assert.equal(dispatched.pop().type, 'pause', 'Bare K still pauses');
const atoms = { isAIAskOpenAtom: 'open', isFullscreenAtom: 'fullscreen', isNavigatorEnabledAtom: 'enabled', isPlayerVisibleAtom: 'playing' };
let state, listeners, fullscreenExits, native = true;
function mount(overrides = {}) {
  state = { open: false, fullscreen: true, enabled: true, playing: true, ...overrides };
  listeners = []; fullscreenExits = 0;
  const document = { activeElement: null, exitFullscreen: async () => { fullscreenExits++; },
    addEventListener: (name, handler, capture) => listeners.push({ handler, capture }), removeEventListener() {} };
  load('components/keyboard-shortcuts.tsx', { document, Element, setTimeout: fn => fn() }, {
    jotai: { useAtom: atom => [state[atom], value => { state[atom] = typeof value === 'function' ? value(state[atom]) : value; }] },
    '@/lib/atoms': atoms, react: { useEffect: fn => fn() },
    '@/lib/desktop/bridge': { desktopBridge: () => native ? { platform: 'windows' } : undefined },
  }).KeyboardShortcuts();
}
async function fire(event) {
  for (const listener of listeners.filter(item => item.capture)) listener.handler(event);
  if (!event.stopped) context.exports.handle(event);
  for (const listener of listeners.filter(item => !item.capture)) listener.handler(event);
  await new Promise(setImmediate);
}
(async () => {
  for (const [nativePlatform, browserPlatform, expected] of [
    ['windows', 'MacIntel', 'Ctrl'], ['macos', 'Win32', '⌘'],
    [undefined, 'Win32', 'Ctrl'], [undefined, 'MacIntel', '⌘'],
    [undefined, 'Linux x86_64', 'Ctrl'], ['ios', '', '⌘'],
  ]) {
    let modifier = '⌘';
    const { useNavigatorShortcut } = load('hooks/use-navigator-shortcut.ts', { navigator: { platform: browserPlatform } }, {
      react: { useState: () => [modifier, value => { modifier = value; }], useEffect: fn => fn() },
      '@/lib/desktop/bridge': { desktopBridge: () => nativePlatform ? { platform: nativePlatform } : undefined },
    });
    useNavigatorShortcut();
    assert.deepEqual(Array.from(useNavigatorShortcut()), [expected, 'K'], 'Native and browser platform hints agree');
  }
  for (const modifier of ['ctrlKey', 'metaKey']) {
    mount(); await fire(key({ [modifier]: true }));
    assert.equal(state.open, true, 'Navigator opens over the focused fullscreen player');
    assert.equal(fullscreenExits, 0, 'Opening Navigator preserves player fullscreen');
    assert.equal(dispatched.length, 0);
    mount({ open: true }); await fire(key({ [modifier]: true })); assert.equal(state.open, false);
    mount(); await fire(key({ [modifier]: true, repeat: true })); assert.equal(state.open, false, 'Held shortcut must not flicker');
    mount({ playing: false }); await fire(key({ [modifier]: true }));
    assert.equal(state.open, true, 'Navigator opens in fullscreen browsing before playback');
    assert.equal(fullscreenExits, 0, 'Native browsing fullscreen must stay active too');
  }
  mount({ enabled: false }); await fire(key({ ctrlKey: true })); assert.equal(state.open, false);
  mount();
  const drawerControl = new Element();
  drawerControl.closest = selector => selector.includes('[data-player-selection-drawer]') ? drawerControl : null;
  await fire(key({ ctrlKey: true, target: drawerControl }));
  assert.equal(state.open, false, 'A focused modal player drawer keeps keyboard priority');
  native = false; mount(); await fire(key({ ctrlKey: true }));
  assert.equal(fullscreenExits, 1, 'Browser element fullscreen must exit to reveal the global overlay');
  assert.equal(state.open, true); native = true;
  // The click entry point must also preserve fullscreen during playback.
  const layoutSource = fs.readFileSync('components/layout-content.tsx', 'utf8');
  const layout = ts.createSourceFile('layout.tsx', layoutSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let toggle;
  function findToggle(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(layout) === 'handleToggleAIAsk') toggle = node.initializer.getText(layout);
    ts.forEachChild(node, findToggle);
  }
  findToggle(layout); assert.ok(toggle);
  let opened = false;
  const clickContext = { exports: {}, isFullscreen: true, isAIAskOpen: false, isPlayerVisible: true,
    setIsAIAskOpen: value => { opened = typeof value === 'function' ? value(opened) : value; },
    desktopBridge: () => ({ send: () => { throw new Error('Must not exit native fullscreen'); } }),
  };
  vm.runInNewContext(ts.transpileModule(`exports.toggle = ${toggle}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, clickContext);
  await clickContext.exports.toggle(); assert.equal(opened, true);
  // The parent must retain the focus state machine through its exit animation.
  assert.doesNotMatch(fs.readFileSync('components/navigator/ai-ask.tsx', 'utf8'), /if \(isPlayerVisible && !isAskOpen\) return null/);
  console.log('PASS: Ctrl/Meta K open and close over fullscreen playback without pausing; bare K, disabled Navigator, repeat and retained exit lifecycle');
})().catch(error => { console.error(error); process.exitCode = 1; });
