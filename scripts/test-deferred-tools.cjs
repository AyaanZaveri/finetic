const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const h = hooks();
const atoms = { isPlayerVisibleAtom: 'player', isAIAskOpenAtom: 'ask' };
let playing = false, open = false, preloads = 0;
const dynamicComponents = [];
const { DeferredTools } = load('components/deferred-tools.tsx', {
  react: h.react, 'react/jsx-runtime': h.jsx,
  'next/dynamic': { __esModule: true, default: (_loader, options) => {
    function LazyTool() {}
    LazyTool.options = options; dynamicComponents.push(LazyTool); return LazyTool;
  } },
  jotai: { useAtomValue: atom => atom === 'player' ? playing : open,
    useAtom: atom => atom === 'player' ? [playing, value => { playing = value; }] : [open, value => { open = value; }] },
  '@/lib/atoms': atoms,
  '@/components/navigator/launcher': { NavigatorLauncher: 'Launcher' },
  '@/lib/preload-tools': { preloadNavigator: () => preloads++ },
  '@/lib/desktop/bridge': { desktopBridge: () => undefined },
});
const render = enabled => h.render(DeferredTools, { userId: 'user-1', navigatorEnabled: enabled, onToggleAIAsk() {} });
const children = tree => tree.props.children.filter(Boolean);
let tree = render(true);
h.flush();
assert.equal(children(tree).length, 1, 'Only the lightweight launcher is mounted before first use');
assert.equal(children(tree).some(child => dynamicComponents.includes(child.type)), false);
children(tree)[0].props.children.props.children.props.onIntent();
assert.equal(preloads, 1);
playing = true; tree = render(true);
assert.equal(children(tree).find(child => child.type === dynamicComponents[0]).props.onToggleAIAsk instanceof Function, true);
playing = false; tree = render(true);
assert.ok(children(tree).some(child => child.type === dynamicComponents[0]), 'Player remains mounted after closing so lifecycle and stop reporting survive');
open = true; tree = render(true);
assert.equal(children(tree).some(child => child.type === dynamicComponents[1]), true);
assert.equal(children(tree).some(child => child.type === 'div'), false, 'The initial launcher cannot duplicate the loaded panel launcher');
open = false; tree = render(true);
assert.equal(children(tree).some(child => child.type === dynamicComponents[1]), true, 'Chat remains mounted across close/reopen');
assert.equal(children(render(false)).some(child => child.type === dynamicComponents[1]), false, 'Disabled Navigator releases its UI');
assert.equal(dynamicComponents[0].options.ssr, false);
assert.equal(dynamicComponents[0].options.loading(), null, 'Cold player chunks must not add a separate Opening player screen');
playing = true;
const coldPlayer = dynamicComponents[0].options.loading();
assert.ok(coldPlayer && coldPlayer.props['data-player-shell'] !== undefined, 'A cold player needs an immediate opaque surface over the changing page');
assert.ok(coldPlayer.props.className.includes('bg-black'));
coldPlayer.props.children.props.onClick();
assert.equal(playing, false, 'A delayed player chunk must still allow the user to cancel playback');
playing = false;
assert.equal(dynamicComponents[1].options.ssr, false);
assert.equal(typeof dynamicComponents[1].options.loading, 'function', 'A cold AI chunk has browsing-specific loading feedback');
const navigatorPending = dynamicComponents[1].options.loading;
open = true;
playing = true;
assert.equal(navigatorPending(), null, 'Opening cold Navigator during playback must never flash the browsing launcher');
playing = false;
const coldNavigator = navigatorPending();
const pendingLauncher = coldNavigator.props.children.props.children;
assert.equal(pendingLauncher.props.busy, true, 'Browsing retains loading feedback while the panel loads');
assert.equal(pendingLauncher.props.expanded, true);
pendingLauncher.props.onClick();
assert.equal(open, false, 'The browsing launcher still cancels a pending open');
assert.equal(navigatorPending(), null, 'Closing before the chunk loads removes its fallback');

const entrance = require('postcss').parse(require('node:fs').readFileSync('components/player-entrance.css', 'utf8'));
entrance.walkRules(rule => {
  if (rule.selector.includes('[data-player-enter]')) {
    assert.ok(rule.selector.includes('> [data-slot="media-player"]'), 'Entrance opacity must never expose the page through the outer player shell');
  }
});

function warmup(platform, idleSupported = true) {
  const native = hooks(), pending = new Map();
  let preloaded = 0, navigatorPreloaded = 0, sequence = 0;
  let playing = false, open = false, enabled = false;
  const schedule = fn => { pending.set(++sequence, fn); return sequence; };
  const cancel = id => pending.delete(id);
  const { DeferredTools: NativeTools } = load('components/deferred-tools.tsx', {
    react: native.react, 'react/jsx-runtime': native.jsx,
    'next/dynamic': { __esModule: true, default: () => function LazyTool() {} },
    jotai: { useAtomValue: atom => atom === 'player' ? playing : open, useAtom: () => [false, () => {}] },
    '@/lib/atoms': atoms,
    '@/components/navigator/launcher': { NavigatorLauncher: 'Launcher' },
    '@/lib/preload-tools': { preloadNavigator: () => navigatorPreloaded++, preloadPlayer: () => preloaded++ },
    '@/lib/desktop/bridge': { desktopBridge: () => platform ? { platform } : undefined },
  }, { window: {
    ...(idleSupported ? { requestIdleCallback: schedule, cancelIdleCallback: cancel } : {}),
    setTimeout: schedule, clearTimeout: cancel,
  } });
  function update(state = {}) {
    playing = state.playing ?? playing;
    open = state.open ?? open;
    enabled = state.enabled ?? enabled;
    native.render(NativeTools, { userId: 'native-user', navigatorEnabled: enabled, onToggleAIAsk() {} });
    native.flush();
  }
  update();
  return { pending, native, update, get preloaded() { return preloaded; }, get navigatorPreloaded() { return navigatorPreloaded; },
    run() { const work = [...pending.values()]; pending.clear(); work.forEach(fn => fn()); } };
}
for (const platform of [undefined, 'ios']) {
  const client = warmup(platform);
  assert.equal(client.pending.size, 0, 'Browser and iOS warmup policy remains unchanged');
  assert.equal(client.preloaded, 0);
  client.native.unmount();
}
for (const platform of ['android', 'windows', 'macos']) for (const idleSupported of [true, false]) {
  const client = warmup(platform, idleSupported);
  assert.equal(client.preloaded, 0, `${platform} warmup leaves the initial shell render free`);
  assert.equal(client.pending.size, 1);
  client.run();
  assert.equal(client.preloaded, 1, `${platform} warms the player before first playback`);
  client.native.replay();
  assert.equal(client.pending.size, 1);
  client.native.unmount();
  assert.equal(client.pending.size, 0, 'Unmounting cancels scheduled work, including Strict Mode replays');
}
for (const platform of [undefined, 'windows', 'macos']) for (const idleSupported of [true, false]) {
  const client = warmup(platform, idleSupported);
  client.run(); // Finish the independent player warmup first.
  client.update({ enabled: true });
  assert.equal(client.pending.size, 0, 'Browsing must not eagerly load Navigator');
  client.update({ enabled: false, playing: true });
  assert.equal(client.pending.size, 0, 'Disabled Navigator must not preload');
  client.update({ enabled: true });
  assert.equal(client.pending.size, 1, 'Playback schedules Navigator warmup');
  assert.equal(client.navigatorPreloaded, 0, 'No synchronous import during playback open');
  client.update({ playing: false });
  assert.equal(client.pending.size, 0, 'Exiting playback cancels pending Navigator warmup');
  client.update({ playing: true });
  client.update({ enabled: false });
  assert.equal(client.pending.size, 0, 'Disabling Navigator cancels pending warmup');
  client.update({ enabled: true });
  client.run();
  assert.equal(client.navigatorPreloaded, 1);
  client.update({ playing: false });
  client.update({ playing: true });
  client.update({ open: true });
  assert.equal(client.pending.size, 0, 'Opening the panel cancels an unnecessary warmup');
  client.update({ open: false });
  client.update({ playing: false });
  client.update({ playing: true });
  assert.equal(client.pending.size, 0, 'An already requested Navigator does not need warmup on later playback');
  client.native.unmount();
  const unrequested = warmup(platform, idleSupported);
  unrequested.run();
  unrequested.update({ enabled: true, playing: true });
  unrequested.native.unmount();
  assert.equal(unrequested.pending.size, 0, 'Unmount cancels pending Navigator warmup');
}
console.log('PASS: deferred tool lifecycle, no cold Navigator launcher in playback, browsing loading feedback, intent and cancellable idle preloads.');
