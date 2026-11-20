const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const widgets = {};
let prefersReducedMotion = false;
function widget(name) { const Component = () => null; widgets[name] = Component; return Component; }
const cardModules = {
    '@/lib/navigator-scene-progress': load('lib/navigator-scene-progress.ts', {}),
    'framer-motion': { motion: { div: widget('reveal') }, useReducedMotion: () => prefersReducedMotion },
    '@/components/arc/lib/motion-tokens': load('components/arc/motion-tokens.ts', {}),
    './result-card-motion': load('components/navigator/result-card-motion.ts', {}),
    '@/components/ui/button': { Button: widget('button') },
    '@/components/arc/accordion/accordion': { Accordion: widget('accordion') },
    './media-link-card': { MediaLinkCard: widget('media') },
    './media-details-card': { MediaDetailsCard: widget('details') },
    './season-card': { SeasonCard: widget('season') },
    './stream-list-card': { StreamListCard: widget('streams') },
    './navigation-card': { NavigationCard: widget('navigation') },
    './play-media-card': { PlayMediaCard: widget('playback') },
    './theme-toggle-card': { ThemeToggleCard: widget('theme') },
    './subtitle-track-card': { SubtitleTrackCard: widget('subtitle-track') },
    './subtitle-skip-card': { SubtitleSkipCard: widget('seek') },
    './scene-explain-card': { SceneExplainCard: widget('scene') },
    './media-analysis-card': { MediaAnalysisCard: widget('analysis') },
    './person-card': { PersonCard: widget('person') },
    './web-source-card': { WebSourceCard: widget('web-source') },
    './episode-metadata-card': { EpisodeMetadataCard: widget('episode-metadata') },
};
function load(file, dependencies) {
    const context = { exports: {}, URLSearchParams, require: name => dependencies[name] || require(name) };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, context, { filename: file });
    return context.exports;
}
const chat = load('lib/navigator-chat.ts', {});
const timing = load('lib/navigator-timing.ts', { './navigator-chat': chat });
const timedUser = { id: 'timed-user', role: 'user', parts: [{ type: 'text', text: 'Play a show' }] };
const timedLookup = { id: 'timed-lookup', role: 'assistant', parts: [{ type: 'text', text: 'Finding the show' }] };
const timedAnswer = { id: 'timed-answer', role: 'assistant', parts: [{ type: 'text', text: 'Playing the show' }] };
const timingResult = timing.navigatorResponseDurations([timedUser, timedLookup, timedAnswer], { 'timed-user': 7123 });
assert.equal(timingResult['timed-answer'], 7.123);
assert.equal(timingResult['timed-lookup'], undefined, 'Only the final reply gets a completion timer');
assert.equal(timing.isNavigatorRequestComplete([timedUser, timedAnswer]), true);
assert.equal(timing.isNavigatorRequestSettled([timedUser, timedAnswer]), true);
const noMatchTurn = [timedUser, { ...timedAnswer, parts: [{ type: 'tool-skipToSubtitleContent', state: 'output-available', output: { success: false, error: 'No confident match' } }] }];
assert.equal(timing.isNavigatorRequestSettled(noMatchTurn), true, 'A completed no-match lookup still receives elapsed time');
assert.equal(timing.isNavigatorRequestComplete(noMatchTurn), false, 'Elapsed time must not turn a no-match into success');
assert.equal(timing.isNavigatorRequestSettled([timedUser, { ...timedAnswer, parts: [{ type: 'tool-findEpisode', state: 'input-available' }] }]), false, 'An active lookup cannot finish its timer');
assert.equal(timing.isNavigatorRequestSettled([timedUser, { ...timedAnswer, parts: [{ type: 'tool-playMedia', state: 'output-available', output: { success: true, execution: 'prepared', preparedToolCallId: 'play-1' } }] }]), false, 'Wait for browser execution before finalizing action timing');
for (const output of [
    { success: true, execution: 'prepared', preparedToolCallId: 'play-1' },
    { success: true, execution: 'completed', status: 'requested', preparedToolCallId: 'play-1' },
    { success: false, execution: 'completed', status: 'failed', preparedToolCallId: 'play-1' },
]) {
    assert.equal(timing.isNavigatorRequestComplete([timedUser, { ...timedAnswer, parts: [{ type: 'tool-playMedia', state: 'output-available', output }] }]), false, 'Pending, unconfirmed, and failed actions must not say Done');
}
assert.equal(timing.isNavigatorRequestComplete([timedUser, { ...timedAnswer, parts: [{ type: 'tool-playMedia', state: 'output-available', output: { success: true, execution: 'completed', status: 'completed', preparedToolCallId: 'play-1' } }] }]), true);
const nextTimedUser = { ...timedUser, id: 'next-user' };
const nextTimedAnswer = { ...timedAnswer, id: 'next-answer' };
const twoTimers = timing.navigatorResponseDurations([timedUser, timedAnswer, nextTimedUser, nextTimedAnswer], { 'timed-user': 7123, 'next-user': 1100 });
assert.equal(twoTimers['timed-answer'], 7.123);
assert.equal(twoTimers['next-answer'], 1.1);
for (const greeting of ['hi', 'Hello!', 'hey there', 'Good morning']) {
    const user = { ...timedUser, parts: [{ type: 'text', text: greeting }] };
    assert.equal(timing.navigatorResponseDurations([user, timedAnswer], { 'timed-user': 4000 })['timed-answer'], 4, 'Greetings retain completion timers for speed comparisons');
}
const greetingWithRequest = { ...timedUser, parts: [{ type: 'text', text: 'Hi, play The Curse' }] };
assert.equal(timing.navigatorResponseDurations([greetingWithRequest, timedAnswer], { 'timed-user': 4000 })['timed-answer'], 4, 'A greeting before a real request must retain its timer');
// Render the actual transcript with short content. It must remain scrollable
// when a child later expands without changing the messages prop.
let focusHookIndex = 0;
let focusPhase = 'open', focusReducedMotion = true, completedFocusPhase;
const focusReact = require('react');
const { NavigatorFocus } = load('components/navigator/focus.tsx', {
    '@/components/navigator/request-error': { NavigatorRequestError: widget('request-error') },
    react: { ...focusReact, useState: value => focusHookIndex++ === 0
        ? [focusPhase, value => { completedFocusPhase = value; }]
        : [value, () => {}],
        useMemo: fn => fn(), useRef: value => ({ current: value }), useCallback: value => value, useEffect: () => {}, useLayoutEffect: () => {} },
    'framer-motion': { motion: { div: 'div', section: 'section', span: 'span' }, AnimatePresence: 'div', LayoutGroup: 'div', useReducedMotion: () => focusReducedMotion },
    'border-beam': { BorderBeam: 'div' }, streamdown: { Streamdown: 'div' },
    'next-themes': { useTheme: () => ({ resolvedTheme: 'dark' }) },
    '@/components/ui/button': { Button: 'button' }, './launcher': { NavigatorLauncher: 'button' },
    './focus-ui/input-group': { InputGroup: 'div', InputGroupAddon: 'div', InputGroupButton: 'button', InputGroupInput: 'input' },
    './composer-input': { NavigatorComposerInput: 'textarea' },
    './activity-status': { NavigatorActivityStatus: 'span' }, './focus-results': { toNavigatorSegments: () => [], isPlaybackRequest: () => false }, './focus.css': {},
    '@/components/arc/floating-surface.module.css': { surface: 'sampled-surface' },
    '@/components/arc/motion-tokens': load('components/arc/motion-tokens.ts', {}),
    '@/lib/navigator-activity-label': { getNavigatorActivityLabel: () => '', NAVIGATOR_ACTIVITY_VARIANT_COUNT: 1 },
    '@/lib/navigator-beam': { navigatorBeamColors: {} }, '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    '@/lib/navigator-timing': timing,
    '@/lib/navigator-rows': load('lib/navigator-rows.ts', { './navigator-chat': chat, './navigator-timing': timing }),
    '@/lib/navigator-chat': chat,
});
const focusTree = NavigatorFocus({ open: true, showLauncher: true, messages: [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Play a show' }] }], input: '', isBusy: false, responseDurations: {} });
function findTranscript(node) {
    if (!node || typeof node !== 'object') return undefined;
    if (node.props?.onScroll) return node;
    for (const child of focusReact.Children.toArray(node.props?.children)) {
        const found = findTranscript(child);
        if (found) return found;
    }
}
const transcript = findTranscript(focusTree);
assert.ok(transcript, 'Inspect the rendered transcript, not an unrelated wrapper');
assert.equal(transcript.props.style.overflowY, 'auto', 'A child accordion must be able to create scroll overflow without new messages');
function findAskSurface(node) {
    if (!node || typeof node !== 'object') return;
    if (node.props?.['aria-label'] === 'Ask Navigator') return node;
    for (const child of focusReact.Children.toArray(node.props?.children)) {
        const found = findAskSurface(child); if (found) return found;
    }
}
assert.equal(findAskSurface(focusTree).props['data-player-native-glass'], undefined, 'Browsing must not request native video samples');
focusHookIndex = 0;
const playerFocus = NavigatorFocus({ open: true, showLauncher: false, messages: [], input: '', isBusy: false, responseDurations: {} });
const playerSurface = findAskSurface(playerFocus);
assert.equal(playerSurface.props['data-player-native-glass'], '', 'Ask Navigator over native playback must request sampled video');
assert.ok(playerSurface.props.className.split(' ').includes('sampled-surface'), 'Reuse the player menu material');
assert.ok(playerSurface.props.className.split(' ').includes('relative'), 'Keep sampled canvas clipped after backdrop-filter takeover');

function findPanelMotion(node) {
    if (!node || typeof node !== 'object') return;
    if (node.props?.className === 'mb-2 w-full' && node.props?.onAnimationComplete) return node;
    for (const child of focusReact.Children.toArray(node.props?.children)) {
        const found = findPanelMotion(child); if (found) return found;
    }
}
for (const reduced of [false, true]) {
    focusReducedMotion = reduced;
    for (const phase of ['open', 'panel-exiting']) {
        focusPhase = phase; focusHookIndex = 0; completedFocusPhase = undefined;
        const panel = findPanelMotion(NavigatorFocus({ open: phase === 'open', showLauncher: false, messages: [], input: '', isBusy: false, responseDurations: {} }));
        assert.ok(panel, 'The player panel remains rendered until its exit completes');
        assert.equal(panel.props.initial.transform, reduced ? 'none' : 'translateY(24px)');
        assert.equal(panel.props.animate.opacity, phase === 'open' ? 1 : 0);
        assert.equal(panel.props.transition.duration, phase === 'open' ? 0.24 : 0.18);
        if (phase === 'panel-exiting') {
            assert.equal(panel.props.animate.transform, reduced ? 'none' : 'translateY(24px)');
            panel.props.onAnimationComplete();
            assert.equal(completedFocusPhase, 'closed', 'Unmount only after the downward exit finishes');
        }
    }
}
focusPhase = 'open'; focusReducedMotion = true;

function findDuration(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type?.$$typeof === Symbol.for('react.memo')) return findDuration(node.type.type(node.props));
    if (/^(Done|Finished) in /.test(node.props?.['aria-label'] || '')) return node;
    for (const child of focusReact.Children.toArray(node.props?.children)) {
        const found = findDuration(child); if (found) return found;
    }
}
focusHookIndex = 0;
const timerOnlyTree = NavigatorFocus({ open: true, showLauncher: true, messages: [timedUser, timedAnswer], input: '', isBusy: false, responseDurations: { 'timed-answer': 7.123 } });
assert.equal(findDuration(timerOnlyTree).props['aria-label'], 'Done in 7 seconds', 'A final assistant message with no visible segments still displays its completion timer');
focusHookIndex = 0;
const noMatchTimerTree = NavigatorFocus({ open: true, showLauncher: true, messages: noMatchTurn, input: '', isBusy: false, responseDurations: { 'timed-answer': 7.123 } });
assert.equal(findDuration(noMatchTimerTree).props['aria-label'], 'Finished in 7 seconds', 'A no-match response displays elapsed time without claiming success');
focusHookIndex = 0;
let retryUserId;
const stoppedFocusTree = NavigatorFocus({ open: true, showLauncher: true,
    messages: chat.markNavigatorRequestStopped([timedUser, timedAnswer]), input: '', isBusy: false,
    responseDurations: { 'timed-answer': 7.123 }, onRetryRequest: id => { retryUserId = id; } });
function findNode(node, predicate) {
    if (node?.type?.$$typeof === Symbol.for('react.memo')) return findNode(node.type.type(node.props), predicate);
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) return node;
    for (const child of focusReact.Children.toArray(node.props?.children)) { const found = findNode(child, predicate); if (found) return found; }
}
const retryRequest = findNode(stoppedFocusTree, node => node.type === 'button' && node.props.children === 'Retry request');
assert.ok(retryRequest, 'A stopped turn has an explicit retry affordance even without rendered tool segments');
retryRequest.props.onClick();
assert.equal(retryUserId, timedUser.id, 'Retry targets the stopped request, not whichever user turn is currently last');
assert.equal(findDuration(stoppedFocusTree), undefined, 'Stopped turns never retain a success duration');


const { toNavigatorSegments } = load('components/navigator/focus-results.tsx', { ...cardModules, '@/lib/navigator-chat': chat });

const episodeLookupParts = [
    { type: 'tool-navigateToEpisode', toolCallId: 'episode-cards', state: 'output-available', input: { seriesQuery: 'Nathan for You' },
        output: { success: true, mediaName: 'The Anecdote', mediaType: 'Episode', seriesId: 'tmdb:58957',
            evidence: [{ url: 'https://example.com/recap', title: 'Episode recap' }] } },
    { type: 'data-episodeProgress', id: 'catalog', data: { toolCallId: 'episode-cards', stage: 'episodes', state: 'completed',
        catalog: { seriesId: 'tmdb:58957', seriesName: 'Nathan for You', episodeCount: 32, seasonCount: 4 } } },
    { type: 'data-episodeProgress', id: 'web', data: { toolCallId: 'episode-cards', stage: 'web', state: 'completed' } },
];
const episodeLookupCards = toNavigatorSegments(episodeLookupParts).filter(segment => segment.kind === 'results');
assert.equal(episodeLookupCards.length, 3, 'Catalog, web sources, and navigation each get their own result group');
assert.equal(episodeLookupCards[0].results.cards.type, widgets['episode-metadata']);
assert.equal(episodeLookupCards[0].results.cards.props.catalog.episodeCount, 32);
assert.equal(episodeLookupCards[1].results.cards[0].type, widgets['web-source']);
assert.equal(episodeLookupCards[1].results.cards[0].props.source.title, 'Episode recap', 'Older saved progress uses final evidence for source cards');
assert.equal(episodeLookupCards[2].results.cards.type, widgets.navigation, 'The final episode has no duplicate source list');
const streamingWebCards = toNavigatorSegments([
    { ...episodeLookupParts[0], state: 'input-available', output: undefined },
    { ...episodeLookupParts[2], data: { ...episodeLookupParts[2].data, state: 'running', sources: [{ url: 'https://example.com/recap', title: 'Episode recap' }] } },
]).filter(segment => segment.kind === 'results');
assert.equal(streamingWebCards[0].results.cards[0].type, widgets['web-source'], 'Fetched sources appear before verification finishes');
const matchedEpisode = { id: 'tmdb:58957:4:4', name: 'The Anecdote', title: 'The Anecdote', seriesId: 'tmdb:58957', seriesName: 'Nathan for You', seasonNumber: 4, episodeNumber: 4, type: 'Episode' };
// Live repro: verification and browser handoff may be different tools/messages in one turn.
const verificationParts = [
    { type: 'tool-verifyEpisode', toolCallId: 'verify-one', state: 'output-available', output: { success: true, episodes: [matchedEpisode] } },
    { type: 'data-episodeProgress', id: 'verify-progress', data: { toolCallId: 'verify-one', stage: 'verify', state: 'completed', episode: matchedEpisode } },
];
const episodeNavigation = { type: 'tool-navigateToEpisode', toolCallId: 'open-one', state: 'output-available', input: {}, output: {
    success: true, mediaId: matchedEpisode.id, seriesId: matchedEpisode.seriesId, mediaName: matchedEpisode.name,
    mediaType: 'Episode', seasonNumber: 4, episodeNumber: 4, url: '/series/tt2297757/4/4', execution: 'completed', status: 'requested',
} };
const canonicalParts = [...verificationParts, episodeNavigation];
const canonicalCards = canonicalParts.flatMap(part => toNavigatorSegments([part], { turnParts: canonicalParts })).filter(s => s.kind === 'results');
assert.equal(canonicalCards.length, 1, 'Different verification/action calls and continuation messages share one canonical episode card');
assert.equal(canonicalCards[0].results.cards.props.result.seriesName, 'Nathan for You', 'Navigation retains the verified show subtitle');
const recoveredParts = [
    { type: 'tool-findEpisodeByTitle', state: 'output-error', toolCallId: 'failed-attempt', input: {}, errorText: 'Navigator could not complete this request. Please try again.' },
    ...canonicalParts,
];
const recoveredSegments = toNavigatorSegments(recoveredParts);
assert.equal(recoveredSegments.some(s => s.trace?.phase === 'error'), false, 'A later successful episode lookup marks the earlier related attempt recovered');
assert.ok(recoveredSegments.some(s => s.trace?.label === 'Recovered episode lookup'));
const unrelatedFailure = toNavigatorSegments([recoveredParts[0], { type: 'tool-themeToggle', state: 'output-available', output: { success: true, execution: 'completed' } }]);
assert.ok(unrelatedFailure.some(s => s.trace?.phase === 'error'), 'An unrelated successful action cannot hide a failed episode lookup');
const cancelledSegments = toNavigatorSegments([{ type: 'tool-searchMediaWeb', state: 'input-available', toolCallId: 'pending' },
    { type: 'data-episodeProgress', data: { toolCallId: 'pending', stage: 'search', state: 'running' } }], { cancelled: true });
assert.equal(cancelledSegments.some(s => s.trace?.phase === 'running'), false, 'Stopped requests never retain running progress');
assert.ok(cancelledSegments.some(s => s.trace?.phase === 'stopped'), 'Aborted progress is distinct from a completed step');
const cancelledActionParts = [...verificationParts, { ...episodeNavigation, output: { ...episodeNavigation.output, execution: 'prepared', preparedToolCallId: 'open-one' } }];
const cancelledActionSegments = toNavigatorSegments(cancelledActionParts, { cancelled: true });
assert.equal(cancelledActionSegments.some(s => s.results?.cards?.type === widgets.navigation), false, 'Cancelled prepared actions cannot remain Opening/Opened cards');
assert.ok(cancelledActionSegments.some(s => s.trace?.phase === 'stopped'));
const differentSeriesError = { ...recoveredParts[0], input: { seriesId: 'tmdb:other-series' } };
assert.ok(toNavigatorSegments([differentSeriesError, episodeNavigation]).some(s => s.trace?.phase === 'error'), 'Success for a different show cannot recover this failure');
const failedApplication = toNavigatorSegments([...verificationParts, { ...episodeNavigation, output: { ...episodeNavigation.output, success: false, message: 'Navigation failed' } }]);
assert.ok(failedApplication.some(s => s.trace?.phase === 'error'), 'Browser failure remains visible after successful verification');
assert.equal(failedApplication.filter(s => s.results?.cards?.type === widgets.media).length, 1, 'Failed handoffs keep the verified target without claiming it opened');
// Scene title was first inserted while running, then updated in place after lookup.
const combinedEpisodeParts = [
    { type: 'tool-skipToSubtitleContent', toolCallId: 'episode-cards', state: 'input-available', input: {} },
    { type: 'data-sceneProgress', id: 'scene-title', data: { toolCallId: 'episode-cards', stage: 'title', state: 'completed', media: matchedEpisode } },
    episodeLookupParts[1], episodeLookupParts[2],
    { type: 'data-episodeProgress', id: 'episode-verify', data: { toolCallId: 'episode-cards', stage: 'verify', state: 'completed', episode: matchedEpisode, detail: 'Found The Anecdote (S4E4).' } },
    { type: 'data-sceneProgress', id: 'scene-subtitles', data: { toolCallId: 'episode-cards', stage: 'subtitles', state: 'completed', subtitles: { index: 0, lineCount: 525 } } },
    { type: 'data-sceneProgress', id: 'scene-match', data: { toolCallId: 'episode-cards', stage: 'scene', state: 'completed', scene: { timestamp: 1059, timestampFormatted: '00:17:39', text: 'Welcome Nathan Fielder' } } },
];
const combinedSegments = toNavigatorSegments(combinedEpisodeParts);
assert.deepEqual(Array.from(combinedSegments.filter(segment => segment.kind === 'trace'), segment => segment.trace.label),
    ['Read episode metadata', 'Checked web sources', 'Found the episode', 'Loaded subtitles', 'Found the scene'],
    'Show dependency order without an early title claim or a duplicate episode sentence');
const verifiedIndex = combinedSegments.findIndex(segment => segment.trace?.label === 'Found the episode');
assert.equal(combinedSegments[verifiedIndex + 1].results.cards.type, widgets.media, 'The verified episode has its card directly beneath the status');
assert.equal(combinedSegments[verifiedIndex + 1].results.cards.props.item.name, 'The Anecdote');
assert.equal(combinedSegments.filter(segment => segment.kind === 'results' && segment.results.cards?.type === widgets.media).length, 1, 'Show the episode once');
const legacyCombinedParts = combinedEpisodeParts.map(part => part.id === 'episode-verify' ? { ...part, data: { ...part.data, episode: undefined } } : part);
const legacyCombinedSegments = toNavigatorSegments(legacyCombinedParts);
assert.equal(legacyCombinedSegments.find(segment => segment.kind === 'results' && segment.results.cards?.type === widgets.media).results.cards.props.item.name, 'The Anecdote', 'Saved conversations reuse the stored scene title card at the verified stage');
// Actual agent orchestration: verifyEpisode and subtitle matching use different
// tool calls, sometimes in separate assistant continuation messages.
const separateSceneParts = [
    { type: 'tool-skipToSubtitleContent', toolCallId: 'separate-scene', state: 'input-available', input: { mediaId: matchedEpisode.id, mediaType: 'episode' } },
    { type: 'data-sceneProgress', id: 'separate-title', data: { toolCallId: 'separate-scene', stage: 'title', state: 'completed', media: { ...matchedEpisode, type: 'episode', seriesName: 'Nathan for You: The Anecdote' } } },
    { type: 'data-sceneProgress', id: 'separate-subtitles', data: { toolCallId: 'separate-scene', stage: 'subtitles', state: 'completed', subtitles: { index: 0, lineCount: 502 } } },
];
const sceneTurnParts = [...verificationParts, ...separateSceneParts];
const separateSegments = [
    ...toNavigatorSegments(verificationParts, { turnParts: sceneTurnParts }),
    ...toNavigatorSegments(separateSceneParts, { turnParts: sceneTurnParts }),
];
assert.equal(separateSegments.filter(s => s.results?.cards?.type === widgets.media).length, 1, 'Verification and subtitle lookup share one episode card across calls and assistant messages');
assert.equal(separateSegments.some(s => s.trace?.label === 'Found the title'), false, 'Do not repeat the verified episode as a second title discovery');
assert.ok(separateSegments.some(s => s.trace?.label === 'Loaded subtitles'), 'Keep distinct subtitle progress');
const differentScene = separateSceneParts.map(p => p.id === 'separate-title' ? { ...p, data: { ...p.data, media: { ...matchedEpisode, id: 'tmdb:58957:4:5', episodeNumber: 5 } } } : p);
assert.ok(toNavigatorSegments(differentScene, { turnParts: [...verificationParts, ...differentScene] }).some(s => s.trace?.label === 'Found the title'), 'A different episode must not be hidden');
const aliasScene = separateSceneParts.map(p => p.id === 'separate-title' ? { ...p, data: { ...p.data, media: { ...p.data.media, id: 'tt2297757:4:4' } } } : p);
assert.equal(toNavigatorSegments(aliasScene, { turnParts: [...verificationParts, ...aliasScene] }).some(s => s.trace?.label === 'Found the title'), false, 'Stable show and episode coordinates reconcile playback ID aliases');
const playbackIdentityScene = separateSceneParts.map(p => p.id === 'separate-title' ? { ...p, data: { ...p.data, media: {
    ...p.data.media, id: 'tt2297757:4:4', seriesId: 'tt2297757', seriesName: 'The Anecdote',
} } } : p);
assert.equal(toNavigatorSegments(playbackIdentityScene, { turnParts: [...verificationParts, ...playbackIdentityScene] }).some(s => s.trace?.label === 'Found the title'), false,
    'A scene tool resolves its canonical input to IMDb playback IDs without creating another episode discovery');
const wrongPlaybackEpisode = playbackIdentityScene.map(p => p.id === 'separate-title' ? { ...p, data: { ...p.data, media: { ...p.data.media, episodeNumber: 5 } } } : p);
assert.ok(toNavigatorSegments(wrongPlaybackEpisode, { turnParts: [...verificationParts, ...wrongPlaybackEpisode] }).some(s => s.trace?.label === 'Found the title'), 'Canonical input cannot conceal a different resolved episode');
const guessByName = playbackIdentityScene.map(p => p.type === 'tool-skipToSubtitleContent' ? { ...p, input: { mediaName: 'The Anecdote', mediaType: 'Episode' } } : p);
assert.ok(toNavigatorSegments(guessByName, { turnParts: [...verificationParts, ...guessByName] }).some(s => s.trace?.label === 'Found the title'), 'Matching names are not an identity mapping across providers');
const movieScene = separateSceneParts.map(p => p.id === 'separate-title' ? { ...p, data: { ...p.data, media: { ...p.data.media, type: 'movie' } } } : p);
assert.ok(toNavigatorSegments(movieScene, { turnParts: [...verificationParts, ...movieScene] }).some(s => s.trace?.label === 'Found the title'), 'A movie cannot collide with an episode identity');
const titleError = separateSceneParts.map(p => p.id === 'separate-title' ? { ...p, data: { ...p.data, state: 'error', detail: 'Could not load the episode metadata', media: undefined } } : p);
assert.ok(toNavigatorSegments(titleError, { turnParts: [...verificationParts, ...titleError] }).some(s => s.trace?.phase === 'error'), 'Prior verification must not hide a later title-loading failure');
const { EpisodeMetadataCard } = load('components/navigator/episode-metadata-card.tsx', {
    '@/lib/artwork': load('lib/artwork.ts', {}),
    '@/lib/navigator-title-path': { navigatorTitlePath: () => '/api/navigator/title?id=tmdb:58957&type=series' },
    './result-card': { ResultCard: widget('catalog-card'), ResultMeta: widget('catalog-meta') },
});
const catalogPoster = 'https://image.tmdb.org/t/p/w500/show-poster.jpg';
const catalogCard = EpisodeMetadataCard({ catalog: { seriesId: 'tmdb:58957', seriesName: 'Nathan for You', year: 2013, poster: catalogPoster } });
assert.equal(catalogCard.props.image, catalogPoster, 'Show cards use the resolved poster carried by the catalog record');

const sceneAction = { type: 'tool-skipToSubtitleContent', toolCallId: 'scene-progress-test', state: 'input-available', input: {} };
const sceneProgress = (stage, state, detail) => ({ type: 'data-sceneProgress', id: `scene-${stage}`, data: { toolCallId: sceneAction.toolCallId, stage, state, detail } });
const progressParts = [sceneAction, sceneProgress('title', 'completed', 'Glass Onion'), sceneProgress('subtitles', 'completed', 'eng · 2,111 lines'), sceneProgress('scene', 'running', 'the confession scene')];
const progressSegments = toNavigatorSegments(progressParts);
assert.equal(progressSegments.length, 3);
assert.deepEqual(Array.from(progressSegments, segment => segment.trace.phase), ['completed', 'completed', 'running']);
assert.equal(progressSegments[2].trace.label, 'Finding the scene in the dialogue');
const activity = load('lib/navigator-activity-label.ts', { '@/lib/navigator-scene-progress': cardModules['@/lib/navigator-scene-progress'] });
assert.equal(activity.getNavigatorActivityLabel([{ role: 'user', parts: [{ type: 'text', text: 'go to the confession scene in glass onion' }] }, { role: 'assistant', parts: progressParts }]), 'Finding the scene in the dialogue');
const failedProgress = toNavigatorSegments([{ ...sceneAction, state: 'output-available', output: { success: false, error: 'No match' } }, sceneProgress('scene', 'error', 'No match')]);
assert.equal(failedProgress.length, 1, 'A failed stage must show one error instead of duplicating the tool error');
const completedProgress = toNavigatorSegments([{ ...sceneAction, state: 'output-available', output: { success: true, execution: 'prepared', preparedToolCallId: sceneAction.toolCallId } }, sceneProgress('title', 'completed', 'Glass Onion'), sceneProgress('subtitles', 'completed', 'eng'), sceneProgress('scene', 'completed', '01:46:32')]);
assert.equal(completedProgress[0].kind, 'trace');
assert.equal(completedProgress.at(-1).kind, 'results', 'Progress stays before the eventual scene card');

// Stage cards appear while the scene tool is still running, not just after playback.
const richProgress = [
  { ...sceneProgress('title', 'completed', 'Knives Out'), data: { ...sceneProgress('title', 'completed').data,
    media: { id: 'tt8946378', name: 'Knives Out', type: 'movie', year: 2019 } } },
  { ...sceneProgress('subtitles', 'completed', 'eng'), data: { ...sceneProgress('subtitles', 'completed').data,
    subtitles: { language: 'eng', provider: 'OpenSubtitles', index: 0, lineCount: 2111 } } },
  { ...sceneProgress('scene', 'completed', '01:46:32'), data: { ...sceneProgress('scene', 'completed').data,
    scene: { timestamp: 6392, timestampFormatted: '01:46:32', text: 'I lied about what happened.' } } },
];
const richSegments = toNavigatorSegments([sceneAction, ...richProgress]);
const stageCards = richSegments.filter(segment => segment.kind === 'results').map(segment => segment.results.cards);
assert.equal(stageCards.length, 3, 'Each completed stage exposes its real result before final playback acknowledgement');
assert.equal(stageCards[0].type, widgets.media);
assert.equal(stageCards[0].props.item.name, 'Knives Out');
assert.equal(stageCards[1].type, widgets['subtitle-track']);
assert.equal(stageCards[1].props.track.provider, 'OpenSubtitles');
assert.equal(stageCards[2].type, widgets.seek);
assert.equal(stageCards[2].props.result.text, 'I lied about what happened.');
const richFinal = { ...sceneAction, state: 'output-available', output: { success: true, execution: 'completed', text: 'I lied about what happened.' } };
assert.equal(toNavigatorSegments([richFinal, ...richProgress]).filter(segment => segment.kind === 'results').length, 3, 'Final action must not duplicate the scene evidence card');
const playbackFailure = toNavigatorSegments([{ ...richFinal, output: { success: false, error: 'Playback was closed before it started.' } }, ...richProgress]);
assert.equal(playbackFailure.filter(segment => segment.kind === 'results').length, 3, 'Playback failure must preserve the movie, loaded track and found quote');
assert.equal(playbackFailure.at(-1).trace.phase, 'error');
const incomplete = toNavigatorSegments([sceneAction, { ...richProgress[1], data: { ...richProgress[1].data, state: 'running' } }]);
assert.equal(incomplete.filter(segment => segment.kind === 'results').length, 0, 'Running stages never claim a completed result');
// Render the real track component to verify it shares dropdown language names
// and local rectangular flags while retaining the standard Navigator card layout.
const trackLabels = load('lib/media/track-label.ts', { './track-flags': load('lib/media/track-flags.ts', {}) });
const { SubtitleTrackCard } = load('components/navigator/subtitle-track-card.tsx', {
  '@/lib/media/track-label': trackLabels,
  './result-card': { ResultCard: widget('result-row'), ResultBadge: widget('result-badge'), ResultMeta: widget('result-meta') },
});
const subtitleRow = SubtitleTrackCard({ track: { language: 'eng', provider: 'OpenSubtitles', filename: 'Knives.Out.2019.srt', index: 2, lineCount: 2111 } });
assert.equal(subtitleRow.type, widgets['result-row']);
assert.equal(subtitleRow.props.title, 'English');
assert.equal(subtitleRow.props.iconContent.type, 'img');
assert.equal(subtitleRow.props.iconContent.props.src, '/flags/3x2/language/en.svg');
assert.equal(subtitleRow.props.iconContent.props.width, 24);
assert.equal(subtitleRow.props.iconContent.props.height, 16, 'Preserve the rectangular flag aspect ratio');
assert.equal(subtitleRow.props.icon, undefined, "A language flag does not need a second boxed icon");
assert.equal(subtitleRow.props.metadata.props.children[0].props.children, 'OpenSubtitles');
assert.equal(subtitleRow.props.metadata.props.children[1].props.children.join(''), '2,111 lines');
assert.equal(subtitleRow.props.description, undefined, 'Keep provider and line count on one metadata row instead of adding a release filename row');
assert.equal(subtitleRow.props.className, undefined, 'Use the same vertical centering as shared favicon cards');
const unknownSubtitleRow = SubtitleTrackCard({ track: { language: 'und', index: 0, lineCount: 1 } });
assert.equal(unknownSubtitleRow.props.title, 'Unknown language');
assert.notEqual(unknownSubtitleRow.props.iconContent.type, 'img', 'Unknown languages use a Lucide fallback instead of a broken flag');
const { formatSceneTime } = load('lib/format-scene-time.ts', {});
for (const [seconds, expected] of [[0, '0s'], [27.168, '27s'], [65, '1m 5s'], [6147.168, '1h 42m 27s'], [3600, '1h 0m 0s']]) {
  assert.equal(formatSceneTime(seconds), expected);
}
assert.equal(formatSceneTime(undefined, '01:42:27,168'), '1h 42m 27s', 'Old SRT timestamps become readable without milliseconds');
assert.equal(formatSceneTime(undefined, '02:05.987'), '2m 5s');
assert.equal(formatSceneTime(undefined, 'not a timestamp'), undefined);
assert.equal(formatSceneTime(-1), undefined);
assert.equal(formatSceneTime(Infinity), undefined);
const { SubtitleSkipCard } = load('components/navigator/subtitle-skip-card.tsx', {
  '@/lib/format-scene-time': { formatSceneTime }, './result-card': { ResultCard: widgets['result-row'] },
  './subtitle-skip-card.module.css': { time: 'scene-time', quote: 'scene-quote' },
});
const sceneRow = SubtitleSkipCard({ result: { success: true, timestamp: 6147.168, text: 'You have always been good to me.' } });
assert.equal(sceneRow.props.icon, undefined, 'Scene evidence has no decorative subtitle tile');
assert.equal(sceneRow.props.metadata, undefined, 'Timestamp is plain text, not a badge');
assert.deepEqual(Array.from(sceneRow.props.title.props.children), ['At ', '1h 42m 27s']);
assert.equal(sceneRow.props.children.type, 'blockquote');
assert.equal(sceneRow.props.children.props.className, 'scene-quote');
assert.equal(SubtitleSkipCard({ result: { success: true, text: 'A quote without a timestamp.' } }).props.title, null);
assert.equal(SubtitleSkipCard({ result: { success: false, error: 'No match' } }).props.error, 'No match');




// Long discovery lists retain every candidate while showing only a compact preview.
let resultsExpanded = false;
const React = require('react');
const presentation = load('components/navigator/focus-results.tsx', {
    ...cardModules, '@/lib/navigator-chat': chat,
    react: { ...React, useId: () => 'result-list', useState: () => [resultsExpanded, update => { resultsExpanded = update(resultsExpanded); }] },
});
const credits = { type: 'tool-getFilmography', state: 'output-available', input: {}, output: {
    success: true, results: Array.from({ length: 39 }, (_, index) => ({ id: String(index), name: `Title ${index}` })),
} };
const browsing = presentation.toNavigatorSegments([credits]);
const allCards = browsing.find(segment => segment.kind === 'results').results.cards;
const selectedParts = [credits, { type: 'tool-presentMediaResults', toolCallId: 'selected-list', state: 'output-available', input: {}, output: {
    success: true, presentation: 'selection', heading: 'Selected credits', results: [credits.output.results[6], credits.output.results[2]],
} }];
const selectedSegments = presentation.toNavigatorSegments(selectedParts);
assert.equal(selectedSegments.filter(segment => segment.kind === 'lookup').length, 1, 'Raw retrieval stays available as collapsed research');
assert.match(selectedSegments[0].trace.label, /^Research/);
const selectedCards = selectedSegments.find(segment => segment.kind === 'results').results.cards;
assert.deepEqual(Array.from(selectedCards, c => c.props.item.id), ['6', '2'], 'Primary cards follow the explicit ordered selection, not the raw batch');
assert.ok(selectedSegments.some(segment => segment.trace?.label === 'Selected credits · 2 results'));
assert.equal(allCards.length, 39, 'Presentation must not remove candidates from tool output');
let preview = presentation.NavigatorResultCards({ cards: allCards });
assert.equal(preview.props.children[0].props.children.length, 5);
assert.equal(preview.props.children[0].props.children[0].props.initial.opacity, 0, 'New result cards fade in from their first appearance');
assert.equal(preview.props.children[0].props.children[0].props.initial.transform, 'translateY(10px)', 'A straight vertical entrance avoids lateral movement from scaling wide cards');
assert.equal(preview.props.children[0].props.children[1].props.transition.delay, 0.05, 'Initial cards reuse the historical 50ms stagger');
assert.ok(preview.props.children[0].props.children[4].props.transition.delay <= 0.15, 'Stagger stays bounded');
assert.equal(preview.props.children[0].props.children[0].props.animate.opacity, 1);
const previewKey = preview.props.children[0].props.children[0].key;
let expandButton = preview.props.children[1].props.children;
assert.equal(expandButton.props.children, 'Show 34 more results');
assert.equal(expandButton.props['aria-expanded'], false);
assert.equal(expandButton.props['aria-controls'], preview.props.children[0].props.id);
expandButton.props.onClick();
preview = presentation.NavigatorResultCards({ cards: allCards });
assert.equal(preview.props.children[0].props.children.length, 39);
assert.equal(preview.props.children[0].props.children[0].key, previewKey, 'Existing cards keep their identity when expanding');
assert.equal(preview.props.children[0].props.children[5].props.initial.opacity, 0, 'Newly revealed cards get the same mount entrance');
assert.equal(preview.props.children[0].props.children[5].props.initial.transform, 'translateY(10px)');
assert.equal(preview.props.children[0].props.children[5].props.transition.duration, 0.18);
assert.equal(preview.props.children[0].props.children[5].props.transition.delay, 0, 'Expanded long lists must never wait for a stagger');
assert.equal(preview.props.children[1].props.children.props['aria-expanded'], true);
preview.props.children[1].props.children.props.onClick();
assert.equal(presentation.NavigatorResultCards({ cards: allCards }).props.children[0].props.children.length, 5);
assert.equal(presentation.NavigatorResultCards({ cards: allCards.slice(0, 5) }).props.children[1], false);
const closedPreview = presentation.NavigatorResultCards({ cards: allCards, revealed: false });
assert.equal(closedPreview.props.children[0].props.children[0].props.animate.opacity, 0, 'Closed accordions hold their reveal until opened');
prefersReducedMotion = true;
resultsExpanded = true;
const reducedPreview = presentation.NavigatorResultCards({ cards: allCards });
assert.equal(reducedPreview.props.children[0].props.children[5].props.initial.transform, 'none');
assert.equal(reducedPreview.props.children[0].props.children[5].props.animate.transform, 'none');
assert.equal(reducedPreview.props.children[0].props.children[5].props.initial.opacity, 0, 'Reduced motion keeps the fade');
assert.equal(reducedPreview.props.children[0].props.children[1].props.transition.delay, 0, 'Reduced motion removes stagger delays');
prefersReducedMotion = false;
resultsExpanded = false;
const playbackLookup = presentation.toNavigatorSegments([credits], { playbackRequest: true });
for (const count of [1, 2, 3, 4, 5, 10, 20]) {
    const lookup = { ...credits, output: { ...credits.output, results: credits.output.results.slice(0, count) } };
    const playback = presentation.toNavigatorSegments([lookup], { playbackRequest: true });
    assert.equal(playback.some(segment => segment.kind === 'lookup'), count > 3, `Playback lookup with ${count} results uses the three-card cutoff`);
    if (count <= 3) assert.equal(playback.find(segment => segment.kind === 'results').results.cards.length, count);
    const browse = presentation.toNavigatorSegments([lookup]);
    assert.equal(browse.some(segment => segment.kind === 'lookup'), false, 'Explicit browsing keeps the direct preview');
}
const personLookup = presentation.toNavigatorSegments([{ type: 'tool-searchPeople', state: 'output-available', input: {}, output: { success: true, results: [{ id: 1, name: 'Nathan Fielder' }] } }], { playbackRequest: true });
assert.equal(personLookup.some(segment => segment.kind === 'lookup'), false, 'A single person match needs no accordion');
assert.equal(personLookup.find(segment => segment.kind === 'results').results.cards[0].type, widgets.person);
const detailLookup = presentation.toNavigatorSegments([{ type: 'tool-getPersonDetails', state: 'output-available', input: {}, output: { success: true, person: { id: 1, name: 'Nathan Fielder' } } }], { playbackRequest: true });
assert.equal(detailLookup.find(segment => segment.kind === 'results').results.cards.type, widgets.person, 'Single detail cards also stay visible');
assert.equal(playbackLookup.length, 1, 'Playback research replaces the trace and cards with a single disclosure');
assert.equal(playbackLookup[0].kind, 'lookup');
assert.match(playbackLookup[0].trace.label, /39 results/);
const disclosure = presentation.NavigatorLookup(playbackLookup[0]);
assert.equal(disclosure.type, widgets.accordion, 'Use the UI Arc accordion for lookup disclosures');
assert.equal(disclosure.props.defaultOpen, -1, 'Research starts collapsed before playback resolves');
assert.equal(disclosure.props.items[0].title, playbackLookup[0].trace.label);
assert.equal(disclosure.props.items[0].content.props.cards.length, 39, 'The panel retains the complete expandable result list');
assert.equal(disclosure.props.size, 'sm', 'Lookup accordions use the compact borderless variant');
const pendingLookup = presentation.toNavigatorSegments([{ ...credits, state: 'input-available', output: undefined }], { playbackRequest: true });
assert.equal(pendingLookup[0].trace.phase, 'running');
const failedLookup = presentation.toNavigatorSegments([{ ...credits, output: { success: false, error: 'Lookup failed' } }], { playbackRequest: true });
assert.equal(failedLookup[0].kind, 'trace');
assert.equal(failedLookup[0].trace.phase, 'error', 'Lookup errors must remain visible');
const playTool = { type: 'tool-playMedia', state: 'output-available', input: {}, output: { success: true, mediaId: 'example', mediaType: 'Movie' } };
const playbackSegments = presentation.toNavigatorSegments([credits, playTool]);
assert.equal(playbackSegments[0].kind, 'lookup');
assert.equal(playbackSegments.find(segment => segment.kind === 'results').results.cards.type, widgets.playback, 'The chosen playback card stays visible');
assert.equal(presentation.isPlaybackRequest('please play the first episode'), true);
assert.equal(presentation.isPlaybackRequest('Can you watch The Curse'), true);
assert.equal(presentation.isPlaybackRequest('Show me movies to watch'), false);
assert.equal(presentation.isPlaybackRequest("Don't play anything"), false);
const preparedTheme = {
    type: 'tool-themeToggle', state: 'output-available', toolCallId: 'theme-1', input: { action: 'light' },
    output: { success: true, action: 'setTheme', theme: 'light', preparedToolCallId: 'theme-1', execution: 'prepared' },
};
assert.equal(toNavigatorSegments([preparedTheme]).length, 0, 'Prepared actions must never show readiness text, success rows, or premature controls');
const appliedTheme = { ...preparedTheme, output: { ...preparedTheme.output, execution: 'completed', status: 'completed', message: 'Theme changed to light.' } };
const answer = { type: 'text', text: 'Switched to light mode.' };
const theme = toNavigatorSegments([appliedTheme, answer]);
assert.equal(theme.filter(segment => segment.kind === 'results').length, 1, 'Theme changes restore exactly one theme widget');
assert.equal(theme.find(segment => segment.kind === 'results').results.cards.type, widgets.theme);
assert.equal(theme.filter(segment => segment.kind === 'trace').length, 0, 'Theme changes have no extra status or play-icon row');
assert.equal(theme.filter(segment => segment.kind === 'text').length, 1, 'The assistant gives one confirmation');
assert.equal(toNavigatorSegments([appliedTheme]).filter(segment => segment.kind === 'text').length, 0, 'The theme widget is sufficient for a tool-only reply');
const legacy = { type: 'tool-completeAction', state: 'output-available', input: { preparedToolCallId: 'theme-1' }, output: { preparedToolCallId: 'theme-1', success: true, status: 'completed', message: 'Theme changed to light.' } };
const legacySegments = toNavigatorSegments([{ ...preparedTheme, output: { ...preparedTheme.output, message: 'Ready to apply your request.' } }, legacy, answer]);
assert.equal(legacySegments.filter(segment => segment.kind === 'results').length, 1, 'Saved chats with the older handoff also regain the widget');
assert.equal(legacySegments.filter(segment => segment.kind === 'trace').length, 0);
const legacyError = toNavigatorSegments([preparedTheme, { ...legacy, state: 'output-error', output: undefined, errorText: 'The app could not apply this change.' }]);
assert.equal(legacyError.length, 1);
assert.equal(legacyError[0].trace.phase, 'error');
assert.doesNotMatch(JSON.stringify(legacySegments), /Ready to apply|Theme change ready|Title ready/);
const navigation = { type: 'tool-navigateToMediaByQuery', state: 'output-available', toolCallId: 'nav-1', input: {}, output: { success: true, action: 'navigate', preparedToolCallId: 'nav-1', execution: 'prepared', url: '/movie/tt123', mediaName: 'Example' } };
const navigationSegments = toNavigatorSegments([navigation]);
assert.equal(navigationSegments.filter(segment => segment.kind === 'results').length, 1, 'Selected-title cards remain visible');
assert.equal(navigationSegments.filter(segment => segment.kind === 'trace').length, 0);
assert.equal(navigationSegments.filter(segment => segment.kind === 'text').length, 0);
const failedTheme = { ...appliedTheme, output: { ...appliedTheme.output, success: false, message: 'Could not change the theme.' } };
const failed = toNavigatorSegments([failedTheme]);
assert.equal(failed.length, 1);
assert.equal(failed[0].trace.phase, 'error');
assert.equal(failed[0].trace.label, 'Could not change the theme.');

const episodeResults = toNavigatorSegments([{ type: 'tool-getEpisodes', state: 'output-available', toolCallId: 'episodes-1', input: {},
    output: { success: true, source: 'TMDB', episodes: [{ id: 'tmdb:114294:1:1', name: 'Premiere', seasonNumber: 1, episodeNumber: 1, thumbnail: 'https://image.tmdb.org/t/p/w500/still.jpg' }] } }]);
const episodeItem = episodeResults.find(segment => segment.kind === 'results').results.cards[0].props.item;
assert.equal(episodeItem.source, 'TMDB', 'Episode cards retain the tool-level artwork source');
const fakeResult = widget('artwork-result');
const resultDependencies = { './result-card': { ResultCard: fakeResult, ResultBadge: widget('badge'), ResultMeta: widget('meta'), formatCardRuntime: () => '' } };
const { MediaLinkCard } = load('components/navigator/media-link-card.tsx', {
    ...resultDependencies,
    '@/lib/artwork': { artworkFromPath: () => undefined },
    '@/lib/navigator-title-path': { navigatorTitlePath: () => '/api/navigator/title?id=tmdb:114294&season=1&episode=1' },
    '../icons/rotten-tomatoes': { RottenTomatoesIcon: widget('rating') },
});
const episodeCard = MediaLinkCard({ item: episodeItem });
assert.equal(episodeCard.props.image, episodeItem.thumbnail, 'TMDB redirect routes must not discard supplied episode stills');
assert.equal(episodeCard.props.imageAspect, 'landscape');
const { SeasonCard } = load('components/navigator/season-card.tsx', {
    ...resultDependencies, '@/lib/navigator-title-path': { navigatorTitlePath: () => '/series/example/1/1' },
});
const seasonCard = SeasonCard({ season: { id: 'tmdb:114294:1', name: 'Season 1', poster: 'https://image.tmdb.org/t/p/w500/season.jpg' } });
assert.match(seasonCard.props.image, /season.jpg$/, 'Season cards render the supplied portrait poster');
const titlePaths = load('lib/navigator-title-path.ts', { '@/lib/series-route': load('lib/series-route.ts', {}), '@/lib/navigator-chat': chat });
const { PlayMediaCard } = load('components/navigator/play-media-card.tsx', {
    ...resultDependencies,
    '@/lib/artwork': load('lib/artwork.ts', {}),
    '@/lib/series-route': load('lib/series-route.ts', {}),
    '@/lib/navigator-title-path': titlePaths,
});
assert.equal(PlayMediaCard({ result: { success: false } }), null, 'Failed actions never render Media/Media even outside the segment renderer');
const playbackCard = PlayMediaCard({ result: { success: true, mediaId: 'tt13623608:1:1', mediaName: 'The Curse', showName: 'The Curse', episodeTitle: 'Land of Enchantment', mediaType: 'Episode', seasonNumber: 1, episodeNumber: 1, thumbnail: 'https://image.tmdb.org/t/p/w500/still.jpg' } });
const playbackImage = new URL(playbackCard.props.image, 'http://localhost');
assert.equal(playbackImage.href, 'https://image.tmdb.org/t/p/w500/still.jpg');
assert.equal(playbackCard.props.imageAspect, 'landscape');
assert.equal(playbackCard.props.title, 'Land of Enchantment');
assert.equal(playbackCard.props.subtitle, 'The Curse', 'The show name belongs under the episode title, before badges');
assert.equal(playbackCard.props.description, undefined);
assert.equal(playbackCard.props.href, '/series/tt13623608/1/1', 'Playback cards link to the exact episode and enable the shared hover arrow');
assert.equal(titlePaths.navigatorArtworkTarget(playbackCard.props.href)?.episodeNumber, 1);
assert.equal(titlePaths.navigatorArtworkTarget('/movie/tt123')?.type, 'movie');
assert.equal(titlePaths.navigatorArtworkTarget('/person/123'), undefined);
assert.equal(titlePaths.navigatorArtworkTarget('/api/navigator/title?id=tmdb%3A114294&type=series&season=0&episode=7')?.episodeNumber, 7);
assert.equal(titlePaths.navigatorArtworkTarget('/api/navigator/title?id=tmdb%3A114294&type=series&season=0'), undefined);
const suppliedStill = PlayMediaCard({ result: { success: true, mediaId: 'tmdb:114294:1:1', mediaType: 'Episode', thumbnail: 'https://image.tmdb.org/t/p/w500/still.jpg' } });
assert.match(suppliedStill.props.image, /\/still.jpg$/, 'Prefer the still returned with single-episode metadata');
const nativeEpisodeLink = new URL(suppliedStill.props.href, 'http://localhost');
assert.equal(nativeEpisodeLink.pathname, '/api/navigator/title');
assert.equal(nativeEpisodeLink.searchParams.get('id'), 'tmdb:114294');
assert.equal(nativeEpisodeLink.searchParams.get('season'), '1');
assert.equal(nativeEpisodeLink.searchParams.get('episode'), '1');
const moviePoster = 'https://image.tmdb.org/t/p/w500/interstellar.jpg';
const moviePlayback = PlayMediaCard({ result: { success: true, mediaId: 'tt0816692', mediaName: 'Interstellar', mediaType: 'Movie', thumbnail: moviePoster } });
assert.equal(moviePlayback.props.image, moviePoster, 'Playback cards retain the resolved public poster');
assert.equal(moviePlayback.props.imageAspect, 'portrait');
assert.equal(moviePlayback.props.href, '/movie/tt0816692');

// Preserve the existing widget's actual Light/Dark/System controls and their wiring.
let selected;
const fakeSegments = widget('segments');
const { ThemeToggleCard } = load('components/navigator/theme-toggle-card.tsx', {
    'next-themes': { useTheme: () => ({ theme: 'dark', setTheme: value => { selected = value; } }) },
    '@/components/arc/segmented-control/segmented-control': fakeSegments,
    '@/lib/utils': { cn: (...classes) => classes.filter(Boolean).join(' ') },
    './theme-toggle-card.module.css': {},
});
const card = ThemeToggleCard({});
const segments = card.props.children[1];
assert.equal(segments.type, fakeSegments);
assert.equal(segments.props.value, 'dark');
assert.deepEqual(Array.from(segments.props.options, option => option.value), ['light', 'dark', 'system']);
segments.props.onValueChange('light');
assert.equal(selected, 'light');

const configured = [];
const { createOpenCodeGoModel } = load('lib/opencode-go.ts', {
    '@/lib/server/outbound-fetch': { providerFetch: () => { throw new Error('Unexpected network request in presentation test'); } },
    '@ai-sdk/openai': { createOpenAI: settings => ({ responses: modelId => { configured.push({ ...settings, modelId, protocol: 'responses' }); return {}; } }) },
    '@ai-sdk/openai-compatible': { createOpenAICompatible: settings => modelId => { configured.push({ ...settings, modelId, protocol: 'chat' }); return {}; } },
});
for (const id of ['muse-spark-1.3-contributor', 'muse-spark-1.2-contributor', 'gpt-6-luna', 'gpt-5.6-luna', 'grok-4.7']) createOpenCodeGoModel(id, 'test-key', 'stable-session');
createOpenCodeGoModel('glm-5.3', 'test-key', 'stable-session');
assert.equal(configured.slice(0, 5).every(config => config.protocol === 'responses'), true, 'Muse and Luna use the Go-documented native Responses API');
assert.equal(configured[5].protocol, 'chat');
assert.equal(configured.every(config => config.baseURL === 'https://opencode.ai/inference/go/openai/v1'), true);
assert.equal(configured.every(config => config.headers['x-opencode-session'] === 'stable-session'), true);
assert.equal(configured.every(config => config.headers['user-agent'] === 'navigator/1.0'), true);
console.log('PASS: restored theme widget and controls, single confirmation, hidden readiness/handoff rows, navigation cards, action errors, and native Muse/Luna API routing.');

const failedEpisodePlayback = toNavigatorSegments([
  { type: 'tool-playMedia', toolCallId: 'empty-season', state: 'output-available', input: { episodeQuery: 'Jimmy Kimmel' }, output: { success: false, error: 'No episodes were found for that show and season.' } },
  { type: 'data-episodeProgress', id: 'empty-season-episodes', data: { toolCallId: 'empty-season', stage: 'episodes', state: 'error', detail: 'No episodes were found for that show and season.' } },
]);
assert.equal(failedEpisodePlayback.filter(segment => segment.kind === 'results').length, 0, 'A failed episode lookup must not render a placeholder playback card');
assert.equal(failedEpisodePlayback.filter(segment => segment.kind === 'trace').length, 1, 'A failed episode lookup shows exactly one actionable error');

const fastWebResults = Array.from({ length: 10 }, (_, index) => ({ title: `Web result ${index}`, url: `https://example.com/${index}`, snippet: 'Discovery snippet' }));
const fastWebSegments = toNavigatorSegments([
    { type: 'tool-searchMediaWeb', toolCallId: 'fast-web', state: 'output-available', input: { query: 'Example' }, output: { success: true, results: fastWebResults, evidenceLevel: 'search-results' } },
    { type: 'data-episodeProgress', id: 'fast-web-search', data: { toolCallId: 'fast-web', stage: 'search', state: 'completed', sources: fastWebResults } },
]);
const fastWebCards = fastWebSegments.filter(segment => segment.kind === 'results');
assert.equal(fastWebCards.length, 1, 'Search progress and final output must not duplicate the result list');
assert.equal(fastWebCards[0].results.cards.length, 10, 'Render all ten search hits before any page reads');
assert.equal(fastWebSegments.filter(segment => segment.kind === 'trace').length, 1, 'Search progress is not repeated');
assert.equal(fastWebSegments.find(segment => segment.kind === 'trace').trace.label, 'Found web results');

// Optional replay of a captured live SSE event array, with no browser/provider
// calls. Updates retain their initial insertion position as in the SDK client.
const replayIndex = process.argv.indexOf('--replay-events');
if (replayIndex >= 0) {
    const events = JSON.parse(fs.readFileSync(process.argv[replayIndex + 1], 'utf8'));
    const parts = new Map();
    for (const event of events) {
        if (event.type === 'tool-input-available') parts.set(event.toolCallId, { type: `tool-${event.toolName}`,
            toolCallId: event.toolCallId, state: 'input-available', input: event.input });
        if (event.type === 'tool-output-available') Object.assign(parts.get(event.toolCallId), { state: 'output-available', output: event.output });
        if (['data-episodeProgress', 'data-sceneProgress'].includes(event.type)) parts.set(event.id, event);
    }
    const replayed = toNavigatorSegments([...parts.values()]);
    const episodes = replayed.filter(s => s.results?.cards?.type === widgets.media && String(s.results.cards.props.item.type).toLowerCase() === 'episode');
    assert.equal(episodes.length, 1, 'Live verification/subtitle tools render exactly one episode card');
    assert.equal(replayed.some(s => s.trace?.label === 'Found the title'), false, 'Live playback aliases do not repeat episode discovery');
    assert.ok(replayed.some(s => s.trace?.label === 'Loaded subtitles'));
    console.log('PASS: live SSE replay keeps one canonical episode card across provider-ID conversion.');
}
