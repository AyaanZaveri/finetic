const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const flags = load('lib/media/track-flags.ts');
const labels = load('lib/media/track-label.ts', { './track-flags': flags }, { URL });
assert.equal(labels.trackLanguage('eng').label, 'English');
assert.equal(labels.trackLanguage('eng').badge, 'EN');
assert.equal(labels.trackLanguage('eng').flag, '/flags/3x2/language/en.svg', 'Generic English uses its decorative language marker');
assert.equal(labels.trackLanguage('en-US').flag, '/flags/3x2/US.svg');
assert.equal(labels.trackLanguage('pob').flag, '/flags/3x2/BR.svg');
assert.equal(flags.trackFlagPath('bad/code'), undefined);
assert.equal(flags.trackFlagPath('zz'), undefined);
assert.equal(labels.trackLanguage('pob').label, 'Brazilian Portuguese');
assert.equal(labels.trackLanguage('pob').badge, 'PT-BR');
assert.equal(labels.trackLanguage('tur').label, 'Turkish');
assert.equal(labels.trackLanguage('bad/code').label, 'Unknown language');
assert.equal(labels.trackLanguage('bos').label, 'Bosnian');
assert.equal(labels.trackLanguage('bos').flag, '/flags/3x2/language/bs.svg');
assert.match(fs.readFileSync('public' + labels.trackLanguage('bos').flag, 'utf8'), /<svg/);
const sortedLanguages = labels.trackOptions([{ language: 'und' }, { language: 'eng' }, { language: 'bos' }, { language: 'zu' }, { language: 'xxx' }]);
assert.deepEqual(Array.from(sortedLanguages, option => option.label), ['English', 'Bosnian', 'Zulu', 'Unknown language', 'Unknown language']);
assert.deepEqual(Array.from(sortedLanguages.slice(-2), option => option.value), ['0', '4'], 'Sorting unknown tracks last must preserve original selection indices');
const described = labels.describeTrack({ language: 'eng', label: 'eng', src: 'https://example.test/Movie.1080p.srt?token=secret', provider: 'OpenSubtitles' }, 1);
assert.equal(described.description, 'Movie.1080p.srt · OpenSubtitles');
assert.ok(!described.description.includes('secret'));
assert.equal(labels.describeTrack({ language: 'eng', label: 'eng', src: 'https://example.test/download?token=secret' }, 2).description, 'Track 3');
assert.equal(labels.describeTrack({ language: 'eng', label: 'English SDH' }, 0).description, 'English SDH');
assert.equal(labels.describeTrack({ language: 'eng', filename: 'C:\\Subs\\Actual.release.srt' }, 0).description, 'Actual.release.srt');

const source = fs.readFileSync('components/ui/media-player.tsx', 'utf8');
const parsed = ts.createSourceFile('player.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function component(name, context, state, sent, props = {}) {
  const node = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const globals = {
    exports: {}, require,
    React: { ...React, useCallback: fn => fn },
    useMediaPlayerContext: () => context,
    useStoreContext: () => ({ setState: (...args) => sent.push(args) }),
    useMediaDispatch: () => action => sent.push(action),
    useMediaSelector: select => select(state),
    MediaActionTypes: new Proxy({}, { get: (_, key) => key }),
    SETTINGS_NAME: 'Settings', PLAYBACK_SPEED_NAME: 'Speed', FLOATING_MENU_SIDE_OFFSET: 10,
    SPEEDS: [0.5, 1, 1.5, 2], trackOptions: labels.trackOptions,
    cn: (...values) => values.filter(Boolean).join(' '),
    playerSettingsStyles: { settingsMenu: 'settingsMenu' },
    PlayerSettingsMenu: 'PlayerSettingsMenu', DropdownMenu: 'DropdownMenu',
    DropdownMenuContent: 'DropdownMenuContent', DropdownMenuTrigger: 'DropdownMenuTrigger',
    DropdownMenuOptions: 'DropdownMenuOptions', DropdownMenuGroup: 'Group', DropdownMenuLabel: 'Label',
    DropdownMenuItem: 'DropdownMenuItem',
    MediaPlayerTooltip: 'Tooltip', SettingsIcon: 'svg', CaptionsOffIcon: 'CaptionsOff', Button: 'Button',
  };
  vm.runInNewContext(ts.transpileModule(`export ${node.getText(parsed)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, globals);
  return globals.exports[name](props);
}
function find(node, type) {
  if (Array.isArray(node)) return node.flatMap(child => find(child, type));
  if (!node || typeof node !== 'object') return [];
  return [...(node.type === type ? [node] : []), ...[].concat(node.props?.children ?? []).flatMap(child => find(child, type))];
}
const tracks = [
  { src: '/tur.srt', label: 'tur', language: 'tur', kind: 'subtitles', active: false },
  { src: '/english-first.srt', label: 'eng', language: 'eng', kind: 'subtitles', active: false },
  { src: '/english-second.srt', label: 'eng', language: 'eng', kind: 'subtitles', active: true },
];
const selected = [], sent = [], root = {};
const context = { rootRef: { current: root }, customSubtitlesEnabled: true, customSubtitleTracks: tracks, onCustomSubtitleChange: track => selected.push(track), isVideo: true };
const state = { mediaPlaybackRate: 1, mediaRenditionList: [{ id: '720', height: 720 }, { id: '1080', height: 1080 }] };
const tree = component('MediaPlayerSettings', context, state, sent);
assert.equal(tree.type, 'DropdownMenu', 'Settings retain the compact dropdown instead of a form panel');
tree.props.onOpenChange(true);
assert.equal(sent[0][0], 'menuOpen');
assert.equal(sent[0][1], true);
const content = find(tree, 'DropdownMenuContent')[0];
assert.equal(content.props.container, root, 'Settings inherit player theme and remain visible in fullscreen');
assert.equal(content.props.className, 'settingsMenu');
assert.equal(find(tree, 'DropdownMenuItem').length, 0, 'Only the web player supplies the stats action');
const statsVisibility = [];
for (const open of [false, true]) {
  const statsMenu = component('MediaPlayerSettings', context, state, [], {
    stats: { open, onOpenChange: visible => statsVisibility.push(visible) },
  });
  const statsAction = find(statsMenu, 'DropdownMenuItem')[0];
  assert.equal(statsAction.props.children, open ? 'Hide stats for nerds' : 'Stats for nerds');
  statsAction.props.onSelect();
}
assert.deepEqual(statsVisibility, [true, false], 'The menu requests explicit show and hide states');
{
  const host = hooks();
  let resize, closed = 0, focused = false, sampling = false;
  const captures = new Set();
  const handle = {
    setPointerCapture: id => captures.add(id),
    hasPointerCapture: id => captures.has(id),
    releasePointerCapture: id => captures.delete(id),
  };
  const player = { clientWidth: 800, clientHeight: 600, focus() { focused = true; } };
  const panel = { offsetLeft: 436, offsetTop: 12, offsetWidth: 352, offsetHeight: 200, offsetParent: player, parentElement: player };
  const { PlayerPlaybackStats } = load('components/player-playback-stats.tsx', {
    react: { ...host.react, useId: () => 'stats-drag-instructions' }, 'react/jsx-runtime': host.jsx,
    'lucide-react': { GripHorizontal: 'grip', Pause: 'pause-icon', Play: 'play-icon', X: 'close-icon' },
    '@/components/ui/button': { Button: 'Button' },
    '@/lib/media/playback-stats': {},
  }, {
    ResizeObserver: class { constructor(callback) { resize = callback; } observe() {} disconnect() { resize = undefined; } },
    window: { setInterval() { sampling = true; return 1; }, clearInterval() { sampling = false; } },
    document: { addEventListener() {}, removeEventListener() {} },
  });
  const props = { open: true, videoRef: { current: null }, onClose: () => closed++ };
  const render = () => host.render(PlayerPlaybackStats, props);
  const initial = render();
  initial.props.ref.current = panel;
  host.flush();
  assert.equal(initial.props.style, undefined, 'A new panel starts at its logical top corner');
  const header = find(initial, 'h2')[0];
  header.props.onPointerDown({ isPrimary: true, button: 0, pointerId: 8, clientX: 450, clientY: 20,
    currentTarget: handle, preventDefault() {} });
  assert.ok(captures.has(8));
  header.props.onPointerMove({ pointerId: 8, clientX: 300, clientY: 250 });
  let { left, top } = render().props.style;
  assert.deepEqual([left, top], [286, 242], 'Drag follows the header grab point');
  header.props.onPointerUp({ pointerId: 8 });
  assert.equal(captures.size, 0, 'Ending the drag releases its pointer');
  header.props.onPointerMove({ pointerId: 8, clientX: 0, clientY: 0 });
  player.clientWidth = 400;
  player.clientHeight = 300;
  resize();
  ({ left, top } = render().props.style);
  assert.deepEqual([left, top], [36, 88], 'Resizing keeps the whole panel inside the player');
  panel.offsetLeft = left;
  panel.offsetTop = top;
  let consumed = false;
  header.props.onKeyDown({ key: 'ArrowLeft', preventDefault() { consumed = true; }, stopPropagation() {} });
  assert.equal(render().props.style.left, 20);
  assert.ok(consumed, 'Focused drag handle owns the arrow key instead of seeking');
  const action = label => find(render(), 'Button').find(node => node.props['aria-label'] === label);
  assert.equal(action('Freeze stats').props.children.type, 'pause-icon');
  assert.equal(action('Freeze stats').props.children.props.fill, 'currentColor');
  action('Freeze stats').props.onClick();
  assert.equal(action('Resume stats updates').props.children.type, 'play-icon');
  assert.equal(action('Resume stats updates').props.children.props.fill, 'currentColor');
  host.flush();
  assert.equal(sampling, false, 'Freezing stops the sampling timer');
  action('Resume stats updates').props.onClick();
  assert.ok(action('Freeze stats'));
  host.flush();
  assert.equal(sampling, true, 'Resuming restarts the sampling timer');
  header.props.onPointerDown({ isPrimary: true, button: 0, pointerId: 9, clientX: 40, clientY: 100,
    currentTarget: handle, preventDefault() {} });
  assert.ok(captures.has(9));
  action('Hide stats for nerds').props.onClick();
  assert.equal(closed, 1);
  assert.ok(focused, 'Closing stats restores player focus');
  assert.equal(captures.size, 0, 'Closing from the panel releases an active drag');
  header.props.onPointerDown({ isPrimary: true, button: 0, pointerId: 10, clientX: 40, clientY: 100,
    currentTarget: handle, preventDefault() {} });
  props.open = false;
  assert.equal(render().props.hidden, true, 'Hiding removes the panel from hit testing');
  host.flush();
  assert.equal(captures.size, 0, 'Hiding from Settings also releases an active drag');
  assert.equal(sampling, false, 'A hidden panel stops sampling');
  assert.equal(resize, undefined);
  props.open = true;
  const reopened = render();
  host.flush();
  assert.equal(reopened.props.hidden, false);
  assert.equal(reopened.props.style.left, 20, 'Reopening preserves the last panel position');
  assert.equal(sampling, true);
  host.unmount();
}
let timingClosed = 0;
const timingTree = component('MediaPlayerSettings', { ...context, subtitleTiming: { open: true, seconds: 0, onOpen() {}, onClose() { timingClosed++; } } }, state, []);
const timingContent = find(timingTree, 'DropdownMenuContent')[0];
for (const inside of [true, false]) {
  let prevented = false;
  timingContent.props.onInteractOutside({ target: { closest: () => inside ? {} : null }, preventDefault() { prevented = true; } });
  assert.equal(prevented, inside, 'Only the timing dialog is treated as part of the open settings interaction');
}
timingTree.props.onOpenChange(false);
assert.equal(timingClosed, 1, 'Closing Settings also closes the sibling timing panel');

const panel = find(tree, 'PlayerSettingsMenu')[0];
assert.equal(panel.props.subtitles, undefined, 'Subtitle tracks have a dedicated button, not a Settings submenu');
assert.equal(panel.props.subtitleTiming, undefined, 'Timing belongs with the subtitle tracks');
const subtitleChoices = { value: '2', options: [{ value: 'off', label: 'Off', icon: { type: 'CaptionsOff' } }, ...labels.trackOptions(tracks)], onChange() {} };
panel.props.onSpeedChange(1.5);
assert.equal(sent.at(-1).detail, 1.5);
assert.equal(panel.props.quality.options[1].value, '1080');
panel.props.quality.onChange('auto');
assert.equal(sent.at(-1).detail, undefined);
assert.ok(!JSON.stringify(panel.props).includes('Bitrate'));

const native = { kind: 'captions', language: 'en', label: 'English SDH' };
const nativeTree = component('MediaPlayerSettings', { ...context, customSubtitlesEnabled: false }, {
  mediaSubtitlesList: [native], mediaSubtitlesShowing: [native],
}, sent);
const nativePanel = find(nativeTree, 'PlayerSettingsMenu')[0];
assert.equal(nativePanel.props.subtitles, undefined);
assert.equal(nativePanel.props.quality, undefined, 'A direct stream has no fabricated quality options');
assert.equal(component('MediaPlayerPlaybackSpeed', context, {}, sent).type, 'DropdownMenu');
let keyboardHandler;
function findKeyboard(node) {
  if (!keyboardHandler && ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'onKeyDown') keyboardHandler = node.initializer.arguments[0].getText(parsed);
  ts.forEachChild(node, findKeyboard);
}
findKeyboard(parsed);
class MenuElement { closest(selector) { assert.ok(selector.includes('[role="menu"]')); return this; } }
const keyboard = { exports: {}, disabled: false, rootImplProps: {}, Element: MenuElement,
  mediaRef: { get current() { throw Error('Menu typeahead must not reach playback shortcuts'); } } };
vm.runInNewContext(ts.transpileModule(`exports.handle = ${keyboardHandler};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, keyboard);
keyboard.exports.handle({ target: new MenuElement(), key: 'f', defaultPrevented: false });
const activity = load('lib/media/control-activity.ts', {}, {
  Element: MenuElement, document: { activeElement: null, querySelector: selector => selector.includes('[role="menu"]') ? {} : null },
});
assert.equal(activity.playerControlsActive({ querySelector: () => null }), true, 'An open native track list holds player controls visible');

const menuMocks = {
  DropdownMenu: 'Menu', DropdownMenuTrigger: 'Trigger', DropdownMenuContent: 'Content',
  DropdownMenuSub: 'Sub', DropdownMenuSubTrigger: 'SubTrigger', DropdownMenuSubContent: 'SubContent',
  DropdownMenuOptions: 'Options', DropdownMenuItem: 'Item',
};
const menuHooks = hooks();
const { PlayerSettingsMenu: RawPlayerSettingsMenu } = load('components/player-settings-menu.tsx', {
  react: menuHooks.react,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@/components/arc/dropdown-menu/dropdown-menu': menuMocks,
  './player-settings-menu.module.css': { subtitleMenu: 'subtitleMenu' },
});
const PlayerSettingsMenu = props => menuHooks.render(RawPlayerSettingsMenu, props);
const settingsMenu = PlayerSettingsMenu(panel.props);
assert.deepEqual(find(settingsMenu, 'SubTrigger').map(node => node.props.children[0].props.children), ['Speed', 'Quality']);
assert.equal(find(settingsMenu, 'SubContent').length, 2, 'Every setting opens a side submenu');
assert.ok(find(settingsMenu, 'SubContent').every(node => node.props.container === root), 'Nested windows remain in the fullscreen player');
const timingMenu = PlayerSettingsMenu({ ...panel.props, subtitleTiming: { seconds: 1.2, onOpen() {}, onClose() {} } });
assert.equal(find(timingMenu, 'Item').length, 0, 'Subtitle timing belongs only in the dedicated captions menu');
assert.equal(find(timingMenu, 'SubTrigger').length, 2, 'Keep the existing speed and quality submenus');
const primitive = new Proxy({}, { get: (_, key) => key === '__esModule' ? true : `Primitive${key}` });
const dropdown = load('components/arc/dropdown-menu/dropdown-menu.tsx', {
  react: { ...React, useId: () => 'track-description' }, 'react/jsx-runtime': require('react/jsx-runtime'),
  '@radix-ui/react-dropdown-menu': primitive,
  '@/components/ui/badge': { Badge: 'Badge' }, '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
  './dropdown-menu.module.css': {},
  '../floating-surface.module.css': {},
});
const choices = dropdown.DropdownMenuOptions({ value: '2', options: subtitleChoices.options, onValueChange() {} });
assert.equal(choices.props.value, '2');
const english = find(choices, dropdown.DropdownMenuRadioItem)[1];
assert.equal(english.props.textValue, 'English');
const option = dropdown.DropdownMenuRadioItem(english.props);
assert.equal(option.props['aria-describedby'], 'track-description');
assert.ok(find(option, 'Badge').some(node => node.props.children === 'EN'));
const unknown = dropdown.DropdownMenuRadioItem({ ...labels.describeTrack({ language: 'und' }, 0), children: 'Unknown language', value: '0' });
assert.equal(find(unknown, require('lucide-react').CircleHelp).length, 1, 'Unknown tracks use a circular Lucide fallback');
const divided = dropdown.DropdownMenuOptions({ value: 'off', options: subtitleChoices.options, separateFirst: true, onValueChange() {} });
assert.equal(find(divided, 'PrimitiveSeparator').length, 1, 'Off is separated from the language tracks once');
assert.equal(find(choices, 'PrimitiveSeparator').length, 0, 'Speed and other choice menus do not gain a divider');
const flag = find(option, 'img')[0];
assert.equal(flag.props.src, '/flags/3x2/language/en.svg');
assert.equal(flag.props.width, 18);
assert.equal(flag.props.height, 12);
assert.equal(flag.props.alt, '');
assert.ok(find(option, 'span').some(node => node.props['aria-hidden'] === 'true' && find(node, 'img').length), 'The icon slot is decorative');
assert.equal(fs.existsSync('public' + flag.props.src), true);
for (const language of ['en', 'es', 'fr', 'de', 'pt', 'tr', 'ru', 'ja', 'ko', 'zh', 'ar', 'hi', 'en-US', 'en-GB', 'pob', 'pt-BR']) {
  const path = labels.trackLanguage(language).flag;
  assert.ok(path, `${language}: common tracks have a local icon`);
  assert.match(fs.readFileSync('public' + path, 'utf8'), /<svg/);
}
assert.match(fs.readFileSync('public/flags/3x2/LICENSE', 'utf8'), /MIT License/);
const submenu = dropdown.DropdownMenuSubContent({ container: root });
assert.equal(submenu.props.container, root);
assert.equal(submenu.props.children.props.sideOffset, 14, 'The 6px trigger inset plus an 8px visual gap must separate submenu surfaces');
assert.equal(submenu.props.children.props.collisionPadding, 12);
assert.equal(submenu.props.children.props.loop, true);

// Native audio/subtitle controls preserve decoder IDs after language sorting.
const nativeHooks = hooks(), nativeCalls = [], events = new Map();
const controller = { tracks: [
  { id: 40, type: 'audio', lang: 'rus' }, { id: 75, type: 'audio', lang: 'eng', selected: true },
  { id: 91, type: 'sub', lang: 'eng', title: 'English SDH' },
], selectTrack: (...args) => nativeCalls.push(args) };
const mediaRef = { current: { controller, closest: () => root,
  addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) } };
const { DesktopTracks } = load('components/desktop/tracks.tsx', {
  react: { ...React, ...nativeHooks.react }, 'react/jsx-runtime': nativeHooks.jsx,
  '@/components/arc/dropdown-menu/dropdown-menu': menuMocks, '@/lib/media/track-label': labels,
  '@/components/ui/button': { Button: 'Button' }, '@/components/player-settings-menu.module.css': {},
});
let cleared = 0;
const nativeProps = { mediaRef, sourceKey: 'fixture', onNativeSubtitle() { cleared++; } };
nativeHooks.render(DesktopTracks, nativeProps); nativeHooks.flush();
const nativeControls = find(nativeHooks.render(DesktopTracks, nativeProps), 'Options');
assert.equal(nativeControls.length, 1, 'The old caption button is removed; only native audio remains');
assert.equal(nativeControls[0].props.options[0].value, '75');
nativeControls[0].props.onValueChange('75');
assert.deepEqual(nativeCalls, [['audio', '75']]);
nativeHooks.unmount(); assert.equal(events.size, 0);

// Execute the real external-track handler: duplicate raw labels used to load
// the first English file regardless of which menu option was chosen.
(async () => {
  const global = ts.createSourceFile('global.tsx', fs.readFileSync('components/global-media-player.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler, selection;
  function walk(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(global) === 'handleCustomSubtitleChange') handler = node.initializer.arguments[0].getText(global);
    if (ts.isVariableDeclaration(node) && node.name.getText(global) === 'selectSubtitle') selection = node.initializer.arguments[0].getText(global);
    ts.forEachChild(node, walk);
  }
  walk(global);
  let nextTracks, fetched;
  const env = { exports: {}, subtitleTracks: tracks, nativePlayback: false, videoRef: { current: null },
    subtitleManualOverride: { current: false }, subtitleDefaultApplied: { current: false },
    subtitleShortcutEnabled: { current: null }, subtitleDefaultSource: { current: null },
    subtitleSelectionRequest: { current: 0 }, loadGenerationRef: { current: 1 },
    setFetchingSubtitles() {}, setRequestedSubtitleSrc() {}, setSubtitleData() {}, setCurrentSubtitle() {}, toast: { error() {} },
    subtitleLoaderRef: { current: { file: async src => { fetched = src; return { success: true, content: 'subtitle' }; } } },
    parseSubtitleTextContent: () => [{ timestamp: 0, text: 'subtitle' }], setSubtitleTracks: update => { nextTracks = update(tracks); },
  };
  vm.runInNewContext(ts.transpileModule(`exports.selection = ${selection}; exports.handler = ${handler};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, env);
  env.selectSubtitle = env.exports.selection;
  env.exports.handler(tracks[2]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetched, '/english-second.srt');
  assert.equal(nextTracks[2].active, true);
  assert.equal(nextTracks[1].active, false);
  const utils = load('app/actions/utils.ts', {
    '@/lib/server/auth': { getAuthData: async () => ({ authKey: 'fixture-only' }) },
    '@/lib/server/outbound-fetch': { outboundFetch: 'fixture-fetch' },
    '@/lib/subtitle-provider': load('lib/subtitle-provider.ts'),
    '@/lib/media/subtitle-episode-identity': load('lib/media/subtitle-episode-identity.ts'),
    './auth': { getInstalledAddons: async () => [{ transportUrl: 'https://addon.test/manifest.json', manifest: { id: 'fixture', name: 'Subtitle provider', resources: ['subtitles'] } }] },
  }, { AbortSignal, fetch: async () => ({ ok: true, json: async () => ({ subtitles: [{ id: 'track', lang: 'eng', filename: 'Actual.release.srt', url: 'https://files.test/123' }] }) }) });
  const discovered = await utils.getSubtitleTracks('tt123', 'movie');
  assert.equal(discovered[0].filename, 'Actual.release.srt');
  assert.equal(discovered[0].provider, 'Subtitle provider');
  const episodeRequests = [];
  const identityUtils = load('app/actions/utils.ts', {
    '@/lib/server/auth': { getAuthData: async () => ({ authKey: 'fixture-only' }) },
    '@/lib/server/outbound-fetch': { outboundFetch: 'fixture-fetch' },
    '@/lib/subtitle-provider': load('lib/subtitle-provider.ts'),
    '@/lib/media/subtitle-episode-identity': load('lib/media/subtitle-episode-identity.ts'),
    './auth': { getInstalledAddons: async () => [{ transportUrl: 'https://addon.test/manifest.json', manifest: { id: 'fixture', name: 'Subtitle provider', resources: ['subtitles'] } }] },
  }, { AbortSignal, fetch: async url => {
    episodeRequests.push(url);
    const rightEpisode = url.includes('tt2297757:4:8.json');
    return { ok: true, json: async () => ({ subtitles: [{ id: rightEpisode ? 'frances' : 'computer-repair', lang: 'eng',
      subtitleFileName: rightEpisode ? 'Nathan.For.You.S04E08.Finding.Frances.srt' : 'Nathan.For.You.S04E07.Computer.Repair.Psychic.srt',
      url: rightEpisode ? 'https://files.test/frances.srt' : 'https://files.test/computer-repair.srt' }] }) };
  } });
  const matchingEpisode = await identityUtils.getSubtitleTracks('tt2297757:4:7', 'series', { episodeTitle: 'Finding Frances' });
  assert.equal(matchingEpisode.length, 1);
  assert.equal(matchingEpisode[0].src, 'https://files.test/frances.srt', 'Normal playback resolves subtitle identity by the verified episode title rather than the release number');
  assert.equal(episodeRequests.length, 3, 'Provider mismatch recovery is bounded to adjacent subtitle entries');
  episodeRequests.length = 0;
  await identityUtils.getSubtitleTracks('tt2297757:4:8', 'series', { episodeTitle: 'Finding Frances' });
  assert.equal(episodeRequests.length, 1, 'Matching episode titles need no neighboring lookups');
  console.log('PASS: language names/codes, safe filenames, original track indices, distinct English files, Off, speed/quality actions, fullscreen submenu portals and UIArc dropdown choices.');
})().catch(error => { console.error(error); process.exitCode = 1; });

// The real component coordinates timing and all side submenus at its props seam.
let timingPinned = true;
const exclusiveProps = { ...panel.props, subtitles: subtitleChoices, subtitleTiming: {
 seconds: 0, open: true, onOpen() { timingPinned = true; }, onClose() { timingPinned = false; },
} };
let exclusiveMenu = PlayerSettingsMenu(exclusiveProps);
find(exclusiveMenu, 'Sub')[2].props.onOpenChange(true);
exclusiveMenu = PlayerSettingsMenu(exclusiveProps);
assert.ok(find(exclusiveMenu, 'Sub').every(node => !node.props.open), 'Hover cannot open a submenu over pinned timing');
find(exclusiveMenu, 'SubTrigger')[2].props.onClick();
assert.equal(timingPinned, false, 'Explicit subtitle activation closes timing');
exclusiveProps.subtitleTiming.open = timingPinned;
exclusiveMenu = PlayerSettingsMenu(exclusiveProps);
assert.deepEqual(find(exclusiveMenu, 'Sub').map(node => node.props.open), [false, false, true]);
// The separate captions menu can pin Timing while Settings is open.
timingPinned = true;
exclusiveProps.subtitleTiming.open = timingPinned;
exclusiveMenu = PlayerSettingsMenu(exclusiveProps);
assert.ok(timingPinned);
assert.ok(find(exclusiveMenu, 'Sub').every(node => !node.props.open), 'Timing replaces the previous submenu');
let keyboardPrevented = false;
find(exclusiveMenu, 'SubTrigger')[0].props.onKeyDown({ key: 'ArrowRight', currentTarget: { closest: () => null }, preventDefault() { keyboardPrevented = true; } });
assert.ok(keyboardPrevented);
exclusiveProps.subtitleTiming.open = timingPinned;
exclusiveMenu = PlayerSettingsMenu(exclusiveProps);
assert.deepEqual(find(exclusiveMenu, 'Sub').map(node => node.props.open), [true, false, false], 'Keyboard activation also replaces timing');
find(exclusiveMenu, 'Sub')[2].props.onOpenChange(true);
exclusiveMenu = PlayerSettingsMenu(exclusiveProps);
find(exclusiveMenu, 'Sub')[0].props.onOpenChange(false);
exclusiveMenu = PlayerSettingsMenu(exclusiveProps);
assert.deepEqual(find(exclusiveMenu, 'Sub').map(node => node.props.open), [false, false, true], 'A stale close event cannot dismiss the new submenu');
console.log('PASS: exclusive settings panels, pinned timing hover, explicit click/keyboard switching and stale submenu close handling');
