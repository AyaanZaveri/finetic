const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const storage = new Map();
const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
const preferences = load('lib/media/playback-preferences.ts', {}, { localStorage });
const audio = load('lib/media/audio-language.ts');
const subtitles = load('lib/media/subtitle-preference.ts', { './audio-language': audio });
const appearance = load('lib/subtitle-appearance.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const defaults = { keyboardSeekBackwardSeconds: 10, keyboardSeekForwardSeconds: 10, continueWatchingPrefetch: true, metadataPrefetch: true, episodeAutoplay: true, episodePrefetch: true, autoSelectWebStream: false, webGpuPlayback: true, nativeWebGpuDecoding: false, hdrOutput: false, hdrPeakNits: 1000, nativeHdrPeakNits: null, audioLanguage: 'en', subtitleLanguage: 'en', subtitleMode: 'normal', subtitlesEnabledByDefault: false };
assert.deepEqual(plain(preferences.readPlaybackPreferences()), defaults);
assert.equal(preferences.normalizePlaybackPreferences({ keyboardSeekBackwardSeconds: NaN }).keyboardSeekBackwardSeconds, 10);
assert.equal(preferences.normalizePlaybackPreferences({ keyboardSeekForwardSeconds: '5' }).keyboardSeekForwardSeconds, 10);
assert.equal(preferences.normalizePlaybackPreferences({ keyboardSeekBackwardSeconds: 0 }).keyboardSeekBackwardSeconds, 1);
assert.equal(preferences.normalizePlaybackPreferences({ keyboardSeekForwardSeconds: 120 }).keyboardSeekForwardSeconds, 60);
assert.equal(preferences.normalizePlaybackPreferences({ keyboardSeekForwardSeconds: 12.6 }).keyboardSeekForwardSeconds, 13);
assert.equal(preferences.normalizePlaybackPreferences({ keyboardSeekSeconds: 15, keyboardSeekForwardSeconds: 20 }).keyboardSeekForwardSeconds, 20);
function mount() {
  const host = hooks();
  const context = load('contexts/settings-context.tsx', { react: host.react, 'react/jsx-runtime': host.jsx,
    '@/lib/subtitle-appearance': appearance, '@/lib/media/playback-preferences': preferences }, { localStorage });
  const render = () => host.render(context.SettingsProvider, { children: null });
  render(); host.flush(); render();
  return { get value() { return context.useSettings(); }, render };
}
storage.set(preferences.PLAYBACK_PREFERENCES_KEY, '{"keyboardSeekSeconds":15}');
let settings = mount();
assert.equal(settings.value.playbackPreferences.keyboardSeekBackwardSeconds, 15);
assert.equal(settings.value.playbackPreferences.keyboardSeekForwardSeconds, 15);
settings.value.updatePlaybackPreferences({ keyboardSeekBackwardSeconds: 5 }); settings.render(); settings = mount();
assert.equal(settings.value.playbackPreferences.keyboardSeekBackwardSeconds, 5);
assert.equal(settings.value.playbackPreferences.keyboardSeekForwardSeconds, 15);
settings.value.updatePlaybackPreferences({ keyboardSeekBackwardSeconds: 10, keyboardSeekForwardSeconds: 10 }); settings.render();
settings.value.updatePlaybackPreferences({ audioLanguage: 'fra', subtitleLanguage: 'bs', subtitleMode: 'forced', subtitlesEnabledByDefault: true });
settings.render(); settings = mount();
assert.deepEqual(plain(settings.value.playbackPreferences), { ...defaults, audioLanguage: 'fr', subtitleLanguage: 'bs', subtitleMode: 'forced', subtitlesEnabledByDefault: true });
settings.value.updatePlaybackPreferences({ continueWatchingPrefetch: false, metadataPrefetch: false, episodeAutoplay: false, episodePrefetch: false, autoSelectWebStream: true }); settings.render(); settings = mount();
assert.equal(settings.value.playbackPreferences.continueWatchingPrefetch, false, 'Continue Watching preloading stays disabled across remounts');
assert.equal(settings.value.playbackPreferences.metadataPrefetch, false, 'Metadata preference is independent and persists');
assert.equal(settings.value.playbackPreferences.episodeAutoplay, false); assert.equal(settings.value.playbackPreferences.episodePrefetch, false);
assert.equal(settings.value.playbackPreferences.autoSelectWebStream, true, 'Automatic web stream selection persists across remounts');
settings.value.updatePlaybackPreferences({ webGpuPlayback: false, hdrOutput: true }); settings.render(); settings = mount();
assert.equal(settings.value.playbackPreferences.webGpuPlayback, false);
assert.equal(settings.value.playbackPreferences.hdrOutput, true, 'Keep the saved HDR choice while WebGPU is off');
settings.value.updatePlaybackPreferences({ nativeHdrPeakNits: 1600 }); settings.render(); settings = mount();
assert.equal(settings.value.playbackPreferences.nativeHdrPeakNits, 1600, 'The native target persists independently');
assert.equal(settings.value.playbackPreferences.hdrPeakNits, 1000, 'Native brightness does not affect WebGPU');
assert.equal(preferences.normalizePlaybackPreferences({ nativeHdrPeakNits: '1600' }).nativeHdrPeakNits, null);
assert.equal(preferences.normalizePlaybackPreferences({ macHdrPeakNits: 1600 }).nativeHdrPeakNits, 1600, 'Migrate the earlier Mac preference');
assert.equal(preferences.normalizePlaybackPreferences({ macHdrPeakNits: 1600, nativeHdrPeakNits: null }).nativeHdrPeakNits, null);
settings.value.updatePlaybackPreferences({ subtitleMode: 'normal' }); settings.render();
assert.equal(settings.value.playbackPreferences.audioLanguage, 'fr', 'Updating one preference preserves the others');
for (const corrupt of ['{broken', 'null', '5', '{"audioLanguage":"garbage","subtitleMode":"bad","subtitlesEnabledByDefault":"true"}']) {
  storage.set(preferences.PLAYBACK_PREFERENCES_KEY, corrupt);
  assert.deepEqual(plain(mount().value.playbackPreferences), defaults);
}
const noStorage = load('lib/media/playback-preferences.ts', {}, { localStorage: { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } } });
noStorage.savePlaybackPreferences({ ...defaults, audioLanguage: 'es' });
assert.equal(noStorage.readPlaybackPreferences().audioLanguage, 'es', 'Unavailable storage retains the current session setting');

const tracks = [
  { language: 'en', label: 'English forced', forced: true, src: 'en-forced' },
  { language: 'fr', label: 'French', src: 'fr-normal' },
  { language: 'eng', label: 'English', src: 'en-normal' },
  { language: 'bs', filename: 'Modern.Family.S06E06.bs.forced.srt', src: 'bs-forced' },
];
assert.equal(subtitles.preferredSubtitleTrack(tracks, 'en', 'normal'), tracks[2]);
assert.equal(subtitles.preferredSubtitleTrack(tracks, 'en-US', 'forced'), tracks[0]);
assert.equal(subtitles.preferredSubtitleTrack(tracks, 'bs', 'forced'), tracks[3]);
assert.equal(subtitles.preferredSubtitleTrack(tracks, 'bs', 'normal'), undefined);
assert.equal(subtitles.preferredSubtitleTrack([{ title: 'English', id: 12 }], 'en', 'normal').id, 12, 'Native engines without language tags can match a clear language title');
assert.equal(subtitles.preferredSubtitleTrack(tracks, 'de', 'normal'), undefined, 'Do not enable an unrelated language');
assert.equal(subtitles.isForcedSubtitle({ forced: false, label: 'Forced' }), false, 'Explicit metadata takes precedence');
assert.equal(audio.preferredAudioTrack([{ lang: 'eng' }, { lang: 'fra', title: 'Commentary' }, { lang: 'fr' }], 'fr').lang, 'fr');
assert.equal(audio.preferredAudioTrack([{ lang: 'rus', title: 'French' }], 'fr'), undefined);
assert.equal(audio.streamLanguagePreference({ title: 'French audio, English subtitles' }, 'fr'), 2);
assert.equal(audio.streamLanguagePreference({ title: 'English audio, French subtitles' }, 'fr'), -1);

// Exercise the player's real subtitle request callback, including reverse
// resolution order and Off while a previous subtitle request is still pending.
const source = fs.readFileSync('components/global-media-player.tsx', 'utf8');
const ast = ts.createSourceFile('player.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let selection, defaultsEffect, toggle, feedback, loadingLabel;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'selectSubtitle') selection = node.initializer.arguments[0].getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'toggleCaptions') toggle = node.initializer.arguments[0].getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'showSubtitleShortcutFeedback') feedback = node.initializer.arguments[0].getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'trackLoadingLabel') loadingLabel = node.initializer.getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('choosePreferredSubtitle.current = choose')) defaultsEffect = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(selection && defaultsEffect && toggle && feedback && loadingLabel);
const compile = (text, globals) => vm.runInNewContext(ts.transpileModule(`(${text})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, globals);
const browserCaption = { kind: "subtitles", mode: "showing" };
let activeTracks = tracks.map(track => ({ ...track, active: false })), data = [], fetching = false;
const pending = [], failures = [];
let requested = null;
const selectionRequest = { current: 0 }, generation = { current: 1 };
const selectSubtitle = compile(selection, {
  nativePlayback: false, videoRef: { current: { textTracks: [browserCaption] } }, subtitleSelectionRequest: selectionRequest, loadGenerationRef: generation,
  setSubtitleData: value => { data = value; }, setCurrentSubtitle() {}, setSubtitleTracks: update => { activeTracks = update(activeTracks); },
  setRequestedSubtitleSrc: value => { requested = value; }, toast: { error: message => failures.push(message) },
  setWaitingForSubtitles() {},
  setFetchingSubtitles: value => { fetching = value; }, subtitleLoaderRef: { current: { file: src => new Promise((resolve, reject) => pending.push({ src, resolve, reject })) } },
  parseSubtitleTextContent: text => [text],
});
(async () => {
  const first = selectSubtitle(tracks[2]);
  assert.equal(browserCaption.mode, 'showing', 'Keep current captions until the requested download is usable');
  assert.equal(requested, tracks[2].src);
  const second = selectSubtitle(tracks[1]);
  pending[1].resolve({ success: true, content: 'French cue' }); await second;
  assert.equal(browserCaption.mode, 'disabled', 'Successful downloads disable embedded captions');
  assert.equal(requested, null);
  pending[0].resolve({ success: true, content: 'Old English cue' }); await first;
  assert.deepEqual(plain(data), ['French cue']);
  assert.equal(activeTracks.find(track => track.active).src, 'fr-normal');
  const replacement = selectSubtitle(tracks[2]);
  pending[2].reject(Error('offline')); await replacement;
  assert.deepEqual(plain(data), ['French cue'], 'Failure retains the previously applied captions');
  assert.equal(activeTracks.find(track => track.active).src, 'fr-normal');
  assert.equal(failures.length, 1);
  assert.equal(requested, null);
  const late = selectSubtitle(tracks[2]);
  await selectSubtitle(null);
  pending[3].resolve({ success: true, content: 'Must stay off' }); await late;
  assert.equal(data.length, 0); assert.equal(fetching, false); assert.ok(activeTracks.every(track => !track.active));
  const obsolete = selectSubtitle(tracks[2]); generation.current++;
  pending[4].resolve({ success: true, content: 'Previous episode' }); await obsolete;
  assert.equal(data.length, 0, 'Previous-episode subtitle results cannot attach to a new video');
  const failure = selectSubtitle(tracks[2]); pending[5].reject(Error('offline')); await failure;
  assert.equal(fetching, false, 'Network failures release the subtitle loader');

  function automatic({ enabled = true, mode = 'normal', manual = false, downloaded = tracks, native = [], browser, ready = 2, language = 'en', catalogReady = true } = {}) {
    const manualOverride = { current: manual };
    const applied = { current: manual }, chosen = [], listeners = new Map();
    let waiting = false, subtitleFeedback = null, timerId = 0;
    const timers = new Map();
    const element = { readyState: ready, controller: { tracks: native, selectTrack: (...args) => chosen.push(args) },
      addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) };
    if (browser) element.textTracks = Object.assign(new EventTarget(), { ...browser, length: browser.length });
    const bindings = {
      playbackPreferencesRef: { current: { ...defaults, subtitlesEnabledByDefault: enabled, subtitleMode: mode, subtitleLanguage: language } },
      isPlayerVisible: true, streamUrl: 'movie', subtitleOptionsReady: catalogReady, videoRef: { current: element },
      subtitleDefaultApplied: applied, subtitleManualOverride: manualOverride, subtitleDefaultSource: { current: null }, subtitleTracks: downloaded, preferredSubtitleTrack: subtitles.preferredSubtitleTrack,
      subtitleShortcutEnabled: { current: null }, choosePreferredSubtitle: { current: null }, requestedSubtitleSrc: null,
      setWaitingForSubtitles: value => { waiting = value; },
      selectSubtitle: track => { waiting = false; chosen.push(track?.src ?? null); },
    };
    bindings.showSubtitleShortcutFeedback = compile(feedback, {
      subtitleFeedbackTimer: { current: undefined }, setSubtitleShortcutFeedback: value => { subtitleFeedback = value; },
      setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id),
    });
    const cleanup = compile(defaultsEffect, bindings)();
    return { cleanup, toggle: compile(toggle, bindings), chosen, listeners, element, applied, manualOverride,
      get waiting() { return waiting; }, finishCatalog() { bindings.subtitleOptionsReady = true; bindings.choosePreferredSubtitle.current(); }, timers,
      label: (fetchingSubtitles = false) => compile(loadingLabel, { subtitleShortcutFeedback: subtitleFeedback,
        fetchingSubtitles, waitingForSubtitles: waiting, fetchingNativeTrack: null, fetchingBrowserAudio: false }) };
  }
  assert.deepEqual(automatic().chosen, ['en-normal']);
  assert.deepEqual(automatic({ native: [{ id: 7, type: 'sub', lang: 'eng' }] }).chosen, [['subtitle', '7']], 'Matching embedded captions take priority over external downloads');
  const lateEmbedded = automatic({ ready: 0 });
  assert.deepEqual(lateEmbedded.chosen, [], 'Do not latch an external default while embedded metadata is still loading');
  lateEmbedded.element.controller.tracks = [{ id: 8, type: 'sub', lang: 'eng' }];
  lateEmbedded.listeners.get('trackschange')();
  assert.deepEqual(lateEmbedded.chosen, [['subtitle', '8']]);
  const noEmbedded = automatic({ ready: 0 });
  noEmbedded.element.readyState = 2;
  noEmbedded.listeners.get('loadedmetadata')();
  assert.deepEqual(noEmbedded.chosen, ['en-normal'], 'Use external fallback once metadata confirms no matching embedded track');
  const lateBrowserTracks = [];
  const lateBrowser = automatic({ browser: lateBrowserTracks });
  assert.deepEqual(lateBrowser.chosen, ['en-normal']);
  lateBrowser.element.textTracks[0] = { kind: 'captions', language: 'eng', label: 'English', mode: 'disabled' };
  lateBrowser.element.textTracks.length = 1;
  lateBrowser.element.textTracks.dispatchEvent(new Event('addtrack'));
  assert.equal(lateBrowser.element.textTracks[0].mode, 'showing', 'A late in-stream browser track replaces only an automatic external fallback');
  assert.deepEqual(lateBrowser.chosen, ['en-normal', null], 'Upgrading cancels the pending external subtitle request');
  const manuallyChanged = automatic();
  manuallyChanged.manualOverride.current = true;
  manuallyChanged.element.controller.tracks = [{ id: 9, type: 'sub', lang: 'eng' }];
  manuallyChanged.listeners.get('trackschange')();
  assert.deepEqual(manuallyChanged.chosen, ['en-normal'], 'Late embedded discovery must preserve a user-selected external track or Off');



  assert.deepEqual(automatic({ mode: 'forced' }).chosen, ['en-forced']);
  assert.deepEqual(automatic({ enabled: false }).chosen, []);
  const firstPress = automatic({ enabled: false, catalogReady: false });
  firstPress.toggle();
  assert.equal(firstPress.waiting, true, 'First C press shows fetching while catalog discovery is pending');
  assert.deepEqual(firstPress.chosen, []);
  firstPress.finishCatalog();
  assert.equal(firstPress.waiting, false);
  assert.deepEqual(firstPress.chosen, ['en-normal'], 'Discovery hands the loader over to the subtitle download');
  firstPress.cleanup();
  const cancelDiscovery = automatic({ enabled: false, catalogReady: false });
  cancelDiscovery.toggle(); cancelDiscovery.toggle();
  assert.equal(cancelDiscovery.waiting, false);
  cancelDiscovery.finishCatalog();
  assert.deepEqual(cancelDiscovery.chosen, [null], 'Second press cancels the pending request to enable captions');
  cancelDiscovery.cleanup();
  const repeating = automatic({ enabled: false, native: [{ id: 7, type: 'sub', lang: 'eng' }] });
  for (const label of ['Fetching subtitles', 'Turning subtitles off', 'Fetching subtitles', 'Turning subtitles off', 'Fetching subtitles']) {
    repeating.toggle();
    assert.equal(repeating.label(), label, 'Every shortcut press displays feedback even for an immediate switch');
    assert.equal(repeating.timers.size, 1, 'Each press replaces the previous feedback timer');
  }
  [...repeating.timers.values()][0]();
  assert.equal(repeating.label(), null, 'Completed switches stop showing feedback');
  assert.equal(repeating.label(true), 'Fetching subtitles', 'A slow download keeps its label after the short feedback expires');
  repeating.cleanup();
  const shortcut = automatic({ enabled: false, language: 'fr', ready: 0 });
  shortcut.toggle();
  assert.deepEqual(shortcut.chosen, [], 'C waits for caption metadata even when startup captions are disabled');
  shortcut.element.readyState = 2;
  shortcut.listeners.get('loadedmetadata')();
  assert.deepEqual(shortcut.chosen, ['fr-normal'], 'C uses the saved subtitle language for the external fallback');
  shortcut.element.controller.tracks = [{ id: 5, type: 'sub', lang: 'eng' }, { id: 6, type: 'sub', lang: 'fra' }];
  shortcut.listeners.get('trackschange')();
  assert.deepEqual(shortcut.chosen, ['fr-normal', null, ['subtitle', '6']], 'Late preferred embedded tracks supersede the external request');
  shortcut.toggle();
  shortcut.listeners.get('trackschange')();
  assert.equal(shortcut.chosen.at(-1), null, 'C turns captions off and prevents future track updates from re-enabling them');
  shortcut.toggle();
  assert.deepEqual(shortcut.chosen.at(-1), ['subtitle', '6'], 'C can re-enable the preferred embedded track');
  shortcut.cleanup();
  assert.deepEqual(automatic({ manual: true }).chosen, [], 'Automatic defaults must not override a manual selection');
  const native = automatic({ downloaded: [], native: [{ id: 4, type: 'sub', lang: 'eng' }, { id: 5, type: 'sub', lang: 'eng', title: 'Forced' }] });
  assert.deepEqual(native.chosen, [['subtitle', '4']]);
  native.listeners.get('trackschange')(); assert.equal(native.chosen.length, 1, 'Track updates do not reapply a completed default');
  native.cleanup(); assert.equal(native.listeners.size, 0);
  const browserTracks = [{ kind: 'subtitles', language: 'en', label: 'English forced', mode: 'disabled' },
    { kind: 'captions', language: 'eng', label: 'English', mode: 'disabled' }];
  automatic({ downloaded: [], browser: browserTracks });
  assert.equal(browserTracks[1].mode, 'showing'); assert.equal(browserTracks[0].mode, 'disabled');
  const delayed = automatic({ downloaded: [] });
  delayed.element.controller.tracks = [{ id: 8, type: 'sub', lang: 'eng' }];
  delayed.listeners.get('trackschange')();
  assert.deepEqual(delayed.chosen, [['subtitle', '8']], 'Embedded tracks arriving later still get the preferred default');

  const { resolvePlayback } = load('lib/media/resolve-playback.ts', { '@/lib/media/audio-language': audio });
  for (const environment of ['web', 'native']) {
    const result = await resolvePlayback({ id: 'movie', type: 'movie' }, { environment, preferredAudioLanguage: 'fr',
      fetchStreams: async () => [{ url: 'https://test/english.mp4', title: 'English H264 AAC' }, { url: 'https://test/french.mp4', title: 'French H264 AAC' }] }, () => {});
    assert.equal(result.streamUrl, 'https://test/french.mp4');
  }
  preferences.savePlaybackPreferences({ ...defaults, audioLanguage: 'fr' });
  let receive; const commands = [];
  const { MpvController } = load('lib/desktop/mpv-controller.ts', {
    '@/lib/media/audio-language': audio, '@/lib/media/playback-preferences': preferences,
  }, { EventTarget, Event, CustomEvent, DOMException, URL, crypto: require('node:crypto') });
  const controller = new MpvController({ platform: 'android', subscribe: callback => { receive = callback; return () => {}; }, send: message => commands.push(message) });
  controller.load('https://test/movie.mp4');
  const message = { type: 'tracks', session: controller.previewSession, tracks: [{ id: 10, type: 'audio', lang: 'eng', selected: true }, { id: 11, type: 'audio', lang: 'fra' }] };
  receive(message);
  assert.equal(commands.at(-1).id, '11', 'Native track metadata applies the persisted preferred audio');
  controller.selectTrack('audio', '10'); const count = commands.length;
  receive(message); assert.equal(commands.length, count, 'Native manual audio selection stays in control');

  const browserAudio = new EventTarget();
  const browserAudioTracks = [{ language: 'en', enabled: true }, { language: 'fr', enabled: false }];
  browserAudio.audioTracks = Object.assign(new EventTarget(), { ...browserAudioTracks, length: 2 });
  const stopAudio = audio.installAudioLanguagePreference(browserAudio, 'fr');
  assert.equal(browserAudioTracks[1].enabled, true);
  browserAudioTracks[0].enabled = true; browserAudioTracks[1].enabled = false;
  browserAudio.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(browserAudioTracks[0].enabled, true, 'Browser manual audio survives later metadata events');
  stopAudio();

  console.log('PASS: persisted language/default preferences, corrupt storage recovery, normal/forced matching, web/native audio ranking, delayed native/browser tracks, embedded priority, manual Off and subtitle request races');
})().catch(error => { console.error(error); process.exitCode = 1; });

// Preference menus stay useful when the browser cannot name a language.
// Use the real component with an incomplete display-name provider.
assert.ok(preferences.PLAYBACK_LANGUAGES.length >= 30 && preferences.PLAYBACK_LANGUAGES.length <= 50);
assert.ok(!preferences.PLAYBACK_LANGUAGES.includes('aa'), 'Do not offer the full ISO language catalogue');
assert.equal(preferences.normalizePlaybackPreferences({ subtitleLanguage: 'eo' }).subtitleLanguage, 'eo', 'Preserve a valid preference saved by an earlier version');
const flags = load('lib/media/track-flags.ts');
const ui = hooks();
const { PlaybackLanguageSettings } = load('components/playback-language-settings.tsx', {
  'react/jsx-runtime': ui.jsx,
  '@/contexts/settings-context': { useSettings: () => ({ playbackPreferences: defaults, updatePlaybackPreferences() {} }) },
  '@/lib/media/playback-preferences': preferences,
  '@/lib/media/track-label': { trackLanguage: () => ({ label: 'Unknown language' }) },
  '@/lib/media/track-flags': flags,
  '@/components/arc/dropdown-menu/dropdown-menu': { DropdownMenu: 'Menu', DropdownMenuTrigger: 'Trigger', DropdownMenuContent: 'Content', DropdownMenuGroup: 'Group', DropdownMenuOptions: 'Options' },
  '@/components/arc/select/select': { Select: 'Select' }, '@/components/arc/switch/switch': { Switch: 'Switch' },
  '@/components/ui/button': { Button: 'Button' }, '@/components/ui/badge': { Badge: 'Badge' },
  '@/components/ui/field': { Field: 'Field', FieldGroup: 'FieldGroup', FieldLabel: 'FieldLabel', FieldDescription: 'FieldDescription', FieldContent: 'FieldContent' },
  '@/app/(main)/settings/settings.module.css': {},
});
function find(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => find(child, predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...find(node.props?.children, predicate)];
}
const languageField = find(PlaybackLanguageSettings({ kind: "subtitles" }), node => node.props?.id === 'preferred-subtitle-language')[0];
const rows = find(languageField.type(languageField.props), node => node.type === 'Select')[0].props.options;
assert.equal(rows[0].label, 'English');
assert.equal(rows.length, preferences.PLAYBACK_LANGUAGES.length);
assert.ok(rows.every(row => row.label && row.label !== 'Unknown language' && row.badge && row.flag));
assert.equal(rows.find(row => row.value === 'bs').label, 'Bosnian');
assert.equal(rows.find(row => row.value === 'pt-BR').label, 'Portuguese (Brazil)');
const legacy = find(languageField.type({ ...languageField.props, value: 'eo' }), node => node.type === 'Select')[0].props.options;
assert.equal(legacy[0].value, 'eo'); assert.notEqual(legacy[0].label, 'Unknown language');
console.log(`PASS: ${rows.length} named common-language choices with flags, incomplete browser dictionary fallback and saved preference compatibility`);

// Toggle state and callbacks use the same settings store as other playback preferences.
let gpuSettings = { ...defaults }, patches = [];
assert.equal(preferences.normalizePlaybackPreferences({ hdrPeakNits: 600 }).hdrPeakNits, 600);
assert.equal(preferences.normalizePlaybackPreferences({ hdrPeakNits: NaN }).hdrPeakNits, 1000);
assert.equal(preferences.normalizePlaybackPreferences({ hdrPeakNits: 10 }).hdrPeakNits, 203);
assert.equal(preferences.normalizePlaybackPreferences({ hdrPeakNits: 20000 }).hdrPeakNits, 10000);
function mountPlaybackSettings(desktop) {
  const host = hooks();
  const { PlaybackSettings } = load('components/playback-settings.tsx', {
    react: host.react, 'react/jsx-runtime': host.jsx,
    '@/lib/desktop/bridge': { desktopBridge: () => desktop },
    '@/contexts/settings-context': { useSettings: () => ({ playbackPreferences: gpuSettings,
      updatePlaybackPreferences(patch) { patches.push(patch); gpuSettings = { ...gpuSettings, ...patch }; } }) },
    '@/components/arc/switch/switch': { Switch: 'Switch' },
    '@/components/ui/field': { Field: 'Field', FieldGroup: 'FieldGroup', FieldLabel: 'FieldLabel', FieldDescription: 'FieldDescription', FieldContent: 'FieldContent' },
    '@/app/(main)/settings/settings.module.css': {},
    '@/components/arc/number-field/number-field': { NumberField: 'NumberField' },
    '@/components/ui/button': { Button: 'Button' },
    '@/components/ui/tooltip': { Tooltip: 'Tooltip', TooltipTrigger: 'TooltipTrigger', TooltipContent: 'TooltipContent' },
    './playback-language-settings': { PlaybackLanguageSettings: 'PlaybackLanguageSettings' },
  });
  const render = () => host.render(PlaybackSettings);
  render(); host.flush();
  return render;
}
const renderWebSettings = mountPlaybackSettings();
const switches = () => find(renderWebSettings(), node => node.type === 'Switch');
switches().find(node => node.props.id === 'hdr-output').props.onCheckedChange(true);
switches().find(node => node.props.id === 'webgpu-playback').props.onCheckedChange(false);
const hdrSwitch = switches().find(node => node.props.id === 'hdr-output');
assert.equal(hdrSwitch.props.disabled, true);
assert.equal(hdrSwitch.props.checked, true, 'Disabling WebGPU keeps the saved HDR selection');
assert.deepEqual(plain(patches), [{ hdrOutput: true }, { webGpuPlayback: false }]);

const backwardField = find(renderWebSettings(), node => node.props?.id === 'keyboard-seek-backward')[0];
const forwardField = find(renderWebSettings(), node => node.props?.id === 'keyboard-seek-forward')[0];
assert.equal(backwardField.props.value, 10);
assert.equal(forwardField.props.value, 10);
const seekReset = () => find(renderWebSettings(), node => node.props?.['aria-label'] === 'Reset both skips to 10 seconds')[0];
assert.equal(seekReset().props['aria-disabled'], true);
backwardField.props.onValueChange(5);
assert.equal(gpuSettings.keyboardSeekForwardSeconds, 10);
forwardField.props.onValueChange(15);
assert.equal(gpuSettings.keyboardSeekBackwardSeconds, 5);
assert.equal(gpuSettings.keyboardSeekForwardSeconds, 15);
const controlsSource = ts.createSourceFile('media-player.tsx',
  fs.readFileSync('components/ui/media-player.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function verifySeekControl(direction, label, step, offset, override) {
  const name = `MediaPlayerSeek${direction}`;
  const control = controlsSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const seeks = [];
  const render = vm.runInNewContext(ts.transpileModule(`(${control.getText(controlsSource)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText, {
    React: { createElement: (type, props, child) => ({ type, props, child }), useCallback: callback => callback },
    useMediaPlayerContext: () => ({ ...gpuSettings, isVideo: true }),
    useMediaDispatch: () => action => seeks.push(action.detail),
    useMediaSelector: selector => selector({ mediaCurrentTime: 30, mediaSeekable: [0, 120] }),
    MediaActionTypes: { MEDIA_SEEK_REQUEST: 'seek' },
    MediaPlayerTooltip: 'Tooltip', Button: 'Button',
  });
  const { props, child } = render({ children: 'icon', seconds: override });
  assert.equal(props.tooltip, `${label} ${step}s`);
  assert.equal(child.props['aria-label'], `${label} ${step} second${step === 1 ? '' : 's'}`);
  child.props.onClick({ defaultPrevented: false });
  assert.deepEqual(seeks, [30 + offset]);
}
verifySeekControl('Backward', 'Back', 5, -5);
verifySeekControl('Forward', 'Forward', 15, 15);
verifySeekControl('Forward', 'Forward', 1, 1, 1);
assert.equal(seekReset().props['aria-disabled'], false);
seekReset().props.onClick();
assert.deepEqual(plain(patches.at(-1)), { keyboardSeekBackwardSeconds: 10, keyboardSeekForwardSeconds: 10 });
assert.equal(seekReset().props['aria-disabled'], true);
verifySeekControl('Backward', 'Back', 10, -10);
verifySeekControl('Forward', 'Forward', 10, 10);
assert.equal(gpuSettings.webGpuPlayback, false);
const peakField = find(renderWebSettings(), node => node.props?.id === 'hdr-peak-nits')[0];
assert.equal(peakField.props.disabled, true);
peakField.props.onValueChange(600);
assert.equal(gpuSettings.hdrPeakNits, 600);


for (const desktop of [{ platform: 'macos' }, { platform: 'windows' }, { platform: 'ios' }]) {
  const render = mountPlaybackSettings(desktop);
  assert.equal(find(render(), node => /webgpu|automatic-web-stream|hdr-peak-nits/.test(node.props?.id || '')).length, 0,
    'Native players do not display browser-only controls or options unsupported by their runtime');
}
for (const [platform, capabilities] of [
  ['macos', { macHdrPeak: true }], ['macos', { nativeHdrPeak: true }], ['windows', { nativeHdrPeak: true }],
]) {
  const renderSettings = mountPlaybackSettings({ platform, capabilities });
  const nativeAuto = () => find(renderSettings(), node => node.props?.id === 'native-hdr-auto' && node.type === 'Switch')[0];
  assert.equal(nativeAuto().props.checked, true);
  nativeAuto().props.onCheckedChange(false);
  const nativePeak = find(renderSettings(), node => node.props?.id === 'native-hdr-peak-nits')[0];
  assert.equal(nativePeak.props.id, 'native-hdr-peak-nits');
  nativePeak.props.onValueChange(1600);
  assert.equal(gpuSettings.nativeHdrPeakNits, 1600);
  assert.equal(gpuSettings.hdrPeakNits, 600);
  nativeAuto().props.onCheckedChange(true);
  assert.equal(gpuSettings.nativeHdrPeakNits, null);
}
console.log('PASS: native HDR is automatic by default, with a separate peak target and capability-gated settings');
