const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { load, hooks } = require('./test-support/react-hooks.cjs');

function mount({ pathname = '/', fullscreen = false, exitFails = false, nativePending = false } = {}) {
  const host = hooks(), listeners = new Map(), actions = [];
  const document = {
    documentElement: {
      hasAttribute: name => name === 'data-desktop-settings-pending' && nativePending,
      removeAttribute: name => { assert.equal(name, 'data-desktop-settings-pending'); nativePending = false; },
    },
    fullscreenElement: fullscreen ? {} : null,
    exitFullscreen: () => { actions.push('exit fullscreen'); return exitFails ? Promise.reject(new Error('denied')) : Promise.resolve(); },
    dispatchEvent: event => { actions.push(event.type); },
    addEventListener(type, handler, options) { listeners.set(type, { handler, options }); },
    removeEventListener(type, handler, capture) {
      assert.equal(listeners.get(type).handler, handler);
      assert.equal(capture, type === 'keydown' ? true : undefined);
      listeners.delete(type);
    },
  };
  const { SettingsShortcut } = load('components/settings-shortcut.tsx', {
    react: host.react,
    'next/navigation': { usePathname: () => pathname, useRouter: () => ({ push: href => actions.push(href) }) },
    jotai: { useSetAtom: () => value => actions.push(['ask', value]) },
    '@/lib/atoms': { isAIAskOpenAtom: 'ask' },
  }, { document, Event: class Event { constructor(type) { this.type = type; } } });
  host.render(SettingsShortcut); host.flush();
  assert.equal(listeners.get('keydown').options.capture, true);
  assert.equal(listeners.get('keydown').options.passive, false, 'Browser default action must be cancelable');
  return { actions, unmount: () => { host.unmount(); assert.equal(listeners.size, 0); },
    native() { nativePending = true; listeners.get('navigatoropensettings').handler(); },
    fire(overrides = {}) {
      const event = { key: ',', ctrlKey: false, metaKey: true, shiftKey: false, altKey: false,
        defaultPrevented: false, cancelable: true,
        target: { tagName: 'INPUT' }, // The app shortcut works even in text fields.
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...overrides };
      listeners.get('keydown').handler(event);
      return event;
    },
  };
}
(async () => {
  for (const nativePending of [false, true]) {
    const app = mount({ nativePending });
    if (!nativePending) app.native();
    assert.deepEqual(app.actions, [['ask', false], 'navigatorcloseplayer', '/settings'], 'Native menu and system shortcuts use the same settings path, including before hydration');
    app.unmount();
  }
  for (const modifier of [{ metaKey: true }, { metaKey: false, ctrlKey: true }]) {
    const app = mount();
    const event = app.fire(modifier);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.stopped, true, 'Focused menu/player handlers cannot also act on this shortcut');
    assert.deepEqual(app.actions, [['ask', false], 'navigatorcloseplayer', '/settings']);
    app.unmount();
  }
  for (const override of [{ key: '.' }, { metaKey: false }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) {
    const app = mount(); app.fire(override); assert.deepEqual(app.actions, []); app.unmount();
  }
  const held = mount();
  assert.equal(held.fire({ repeat: true }).defaultPrevented, true, 'Repeated keydowns still suppress browser settings');
  assert.deepEqual(held.actions, []); held.unmount();
  const settings = mount({ pathname: '/settings/subtitles' }); settings.fire();
  assert.equal(settings.actions.includes('/settings'), false, 'Do not replace the selected category or add duplicate history');
  settings.unmount();
  for (const exitFails of [false, true]) {
    const web = mount({ fullscreen: true, exitFails });
    assert.equal(web.fire().defaultPrevented, true, 'Cancel browser action synchronously before exitFullscreen resolves');
    assert.equal(web.actions.includes('/settings'), false);
    await new Promise(setImmediate);
    assert.deepEqual(web.actions, [['ask', false], 'navigatorcloseplayer', 'exit fullscreen', '/settings']);
    web.unmount();
  }
  // Run the player's real close subscription, rather than hiding its atom directly.
  const source = fs.readFileSync('components/global-media-player.tsx', 'utf8');
  const parsed = ts.createSourceFile('player.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'useEffect' && node.arguments[0]?.getText(parsed).includes('"navigatorcloseplayer"')) effect = node.arguments[0].getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed); assert.ok(effect);
  let handler, closed = 0;
  const doc = { addEventListener: (type, fn) => { assert.equal(type, 'navigatorcloseplayer'); handler = fn; }, removeEventListener: (_, fn) => assert.equal(fn, handler) };
  const vm = require('node:vm');
  const globals = { document: doc, isPlayerVisible: true, handleClose: () => closed++ };
  const cleanup = vm.runInNewContext(`(${effect})()`, globals);
  handler(); assert.equal(closed, 1, 'Use normal close cleanup/progress handling on both browser and native players'); cleanup();
  assert.match(fs.readFileSync('app/(main)/layout.tsx', 'utf8'), /<SettingsShortcut\s*\/>/);
  assert.match(fs.readFileSync('components/app-header.tsx', 'utf8'), /label: "Settings", keys: \[shortcutModifier, ","\]/);
  assert.match(fs.readFileSync('components/arc/user-menu/user-menu.tsx', 'utf8'), /<KbdGroup[^>]*>[\s\S]*?<Kbd /);
  console.log('PASS: Settings shortcut capture/default cancellation, Command/Ctrl, inputs, repeat/modifier guards, fullscreen, player close path, Kbd hint and cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
