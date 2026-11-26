const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, globals = {}) {
    const context = { exports: {}, ...globals };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, context);
    return context.exports;
}

const routes = load('lib/series-route.ts');
const helpers = load('lib/media/resume-playback.ts', { require: () => routes });
const { resumePlaybackTarget, formatResumePosition } = helpers;
const media = { id: 'show', seriesId: 'show', type: 'series', name: 'Episode 3', showName: 'Show',
    mediaSourceId: 'show:1:3', seasonNumber: 1, episodeNumber: 3 };
const progress = { videoId: 'show:1:3', resumePositionTicks: 754, totalDuration: 1800 };
assert.equal(formatResumePosition(754), '12:34');
assert.equal(formatResumePosition(3754), '1:02:34');
assert.equal(resumePlaybackTarget(media, progress).resumePositionTicks, 754);
assert.equal(resumePlaybackTarget(media, { ...progress, videoId: 'show:1:2' }).resumePositionTicks, undefined,
    'Another episode’s progress must never become this episode’s resume position');
for (const position of [0, -1, NaN, Infinity, 1799, 1800, 1801]) {
    assert.equal(resumePlaybackTarget(media, { ...progress, resumePositionTicks: position }).resumePositionTicks, undefined);
}
assert.equal(resumePlaybackTarget(media, { ...progress, resumePositionTicks: 1790 }).resumePositionTicks, 1790);
const overview = { id: 'show', type: 'series', name: 'Show' };
const resumed = resumePlaybackTarget(overview, progress);
assert.equal(resumed.mediaSourceId, 'show:1:3');
assert.equal(resumed.seasonNumber, 1);
assert.equal(resumed.episodeNumber, 3);
assert.equal(resumePlaybackTarget(overview, { ...progress, videoId: 'other:1:3' }).resumePositionTicks, undefined);
assert.equal(resumePlaybackTarget(overview, { ...progress, videoId: 'show:0:1' }).resumePositionTicks, undefined,
    'Show-level playback continues to ignore specials');
const opaque = resumePlaybackTarget(overview, { ...progress, videoId: 'opaque-source' }, [
    { id: 'opaque-source', season: 2, episode: 12, title: 'Known episode' },
]);
assert.equal(opaque.episodeTitle, 'Known episode');
assert.equal(opaque.episodeNumber, 12);

let saved;
let sharedPlayback;
const played = [];
const { MediaPlayButton } = load('components/media-page/play-button.tsx', {
    require: name => {
        if (name === 'react') return { useState: () => [saved, () => {}], useEffect() {} };
        if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
        if (name === '@/lib/media/resume-playback') return helpers;
        if (name === '@/contexts/MediaPlayerContext') return { usePlaybackActions: () => ({ playMedia: target => played.push(target) }) };
        if (name === '@/contexts/account-context') return { useAccountAccess: () => ({ authenticated: true }) };
        if (name === '@/components/series-overview-playback') return { useSeriesOverviewPlayback: () => sharedPlayback };
        if (name === '@/components/metadata-preload') return { useMetadataIntent: () => ({}) };
        if (name === '@/components/ui/button') return { Button: 'button' };
        return new Proxy({}, { get: (_, key) => key });
    },
});
function render(target, state = progress) {
    saved = { key: `${target.type}:${target.seriesId || target.id}:${target.mediaSourceId || 'overview'}`, progress: state };
    return MediaPlayButton({ media: target });
}
const episodeTree = render(media);
const [resumeButton, tooltip] = episodeTree.props.children;
const label = resumeButton.props.children[1];
assert.equal(label.type, 'span');
assert.equal(label.props.children[0], 'Resume');
assert.equal(label.props.children[1].props.children[0], ' ', 'Use a natural inline space');
const detail = label.props.children[1].props.children[1];
assert.equal(detail.props.children, 'from 12:34');
assert.ok(detail.props.className.includes('text-background/60'), 'From and timestamp are muted');
resumeButton.props.onClick();
assert.equal(played.at(-1).resumePositionTicks, 754);
assert.equal(tooltip.props.delayDuration, 600);
const restart = tooltip.props.children[0].props.children;
assert.equal(restart.props.variant, 'media-secondary');
assert.equal(restart.props.size, 'icon-lg');
assert.ok(restart.props.className.includes('rounded-full'));
assert.equal(restart.props['aria-label'], 'Play from start');
restart.props.onClick();
assert.equal(played.at(-1).resumePositionTicks, 0);
assert.equal(played.at(-1).mediaSourceId, media.mediaSourceId, 'Restart targets the selected episode');
const showTree = render(overview);
const showButton = showTree.props.children[0];
assert.equal(showButton.props.children[1].props.children[0], 'Resume');
assert.equal(showButton.props.children[1].props.children[1].props.children[1].props.children, 'S01E03');
showButton.props.onClick();
assert.equal(played.at(-1).mediaSourceId, progress.videoId, 'Show overview resumes the saved episode');
showTree.props.children[1].props.children[0].props.children.props.onClick();
assert.equal(played.at(-1).mediaSourceId, progress.videoId, 'Overview restart plays the resume episode from zero');
assert.equal(played.at(-1).resumePositionTicks, 0);
const unwatched = render(media, null);
assert.equal(unwatched.props.children[0].props.children[1].props.children[0], 'Play');
assert.equal(unwatched.props.children[1], false, 'No redundant restart button without progress');
saved = null;
assert.equal(MediaPlayButton({ media }).props.children[0].props.disabled, true, 'Wait for current episode progress before playing');

async function testDetailProgress() {
    const { load, hooks } = require('./test-support/react-hooks.cjs');
    const h = hooks();
    const lookups = [];
    const { MediaPlayButton } = load('components/media-page/play-button.tsx', {
        react: h.react, 'react/jsx-runtime': h.jsx,
        '@/lib/media/resume-playback': helpers,
        '@/app/actions': { fetchPlaybackProgress: async (id, videoId, identity) => {
            lookups.push([id, videoId, identity.type, identity.imdbId]);
            return { ...progress, videoId };
        } },
        '@/contexts/MediaPlayerContext': { usePlaybackActions: () => ({ playMedia: target => played.push(target) }) },
        '@/contexts/account-context': { useAccountAccess: () => ({ authenticated: true }) },
        '@/components/series-overview-playback': { useSeriesOverviewPlayback: () => null },
        '@/components/metadata-preload': { useMetadataIntent: () => ({}) },
        '@/components/ui/button': { Button: 'button' },
        '@/components/ui/tooltip': {}, '@/components/media-page/watch-toggle-button': {},
        '@/components/media-page/shuffle-episode-button': {}, '@/lib/preload-tools': {},
    }, { window: { addEventListener() {}, removeEventListener() {} } });
    const movie = { id: 'tmdb:21', type: 'movie', name: 'Movie' };
    const episode = { ...media, id: 'tmdb:42', seriesId: 'tmdb:42', mediaSourceId: 'tmdb:42:1:3' };
    for (const [target, imdbId] of [[movie, 'tt21'], [episode, 'tt42']]) {
        const render = () => h.render(MediaPlayButton, { media: target, titleIds: { imdbId } }).props.children[0];
        render(); h.flush();
        await new Promise(resolve => setImmediate(resolve));
        const button = render();
        assert.deepEqual(lookups.at(-1), [target.id, target.mediaSourceId ?? target.id, target.type, imdbId]);
        assert.equal(button.props.children[1].props.children[0], 'Resume');
        button.props.onClick();
        assert.equal(played.at(-1).resumePositionTicks, 754);
    }
    h.unmount();
}

async function testSeriesOverview() {
    const { load, hooks } = require('./test-support/react-hooks.cjs');
    const h = hooks();
    const show = { id: 'tmdb:42', imdbId: 'tt42', type: 'series', name: 'Show' };
    const reads = [], lookups = [];
    const listeners = new Map();
    const following = { id: 'tmdb:42:6:10', season: 6, episode: 10, title: 'Next' };
    let params = { id: show.id };
    let latest = { ...progress, videoId: 'tt42:6:9' };
    const deps = {
        'next/navigation': { useParams: () => params },
        '@/lib/media/resume-playback': helpers,
        '@/lib/watch-history': { WATCH_HISTORY_CHANGED: 'watch-history-changed' },
        '@/contexts/account-context': { useAccountAccess: () => ({ authenticated: true }) },
        '@/app/actions/media': { fetchPlaybackProgress: async (id, videoId, identity) => {
            assert.equal(videoId, undefined);
            assert.equal(identity.tmdbId, 42, 'Read the legacy alias alongside the canonical overview record');
            reads.push(id);
            return latest;
        } },
        '@/app/actions/tv-shows': {
            getFollowingEpisodeForSeries: async (...args) => { lookups.push(args); return following; },
        },
    };
    const { SeriesOverviewPlaybackProvider } = load('components/series-overview-playback.tsx', {
        ...deps, react: h.react, 'react/jsx-runtime': h.jsx,
    }, { window: {
        addEventListener: (name, callback) => listeners.set(name, callback),
        removeEventListener: name => listeners.delete(name),
    } });
    const { SeriesEpisodesRouteAware } = load('components/series-episodes-route-aware.tsx', {
        ...deps, 'react/jsx-runtime': h.jsx,
        '@/components/series-overview-playback': { useSeriesOverviewPlayback: () => sharedPlayback },
        '@/components/season-episodes': { SeasonEpisodes: 'season-episodes', SeasonEpisodesPlaceholder: 'season-placeholder' },
    });
    const renderProvider = () => {
        sharedPlayback = h.render(SeriesOverviewPlaybackProvider, { show }).props.value;
        h.flush();
    };
    const tick = () => new Promise(resolve => setImmediate(resolve));
    const selection = () => {
        const { currentSeasonNumber, currentEpisodeNumber } = SeriesEpisodesRouteAware({ showId: show.id }).props;
        return [currentSeasonNumber, currentEpisodeNumber];
    };
    const play = () => MediaPlayButton({ media: show }).props.children[0].props.onClick();
    renderProvider();
    assert.equal(MediaPlayButton({ media: show }).props.children[0].props.disabled, true);
    assert.equal(SeriesEpisodesRouteAware({ showId: show.id }).type, 'season-placeholder',
        'The first render must reserve the episode rail without rendering or loading the pilot');
    await tick(); renderProvider();
    assert.deepEqual(reads, ['tt42'], 'TMDB cards use playback history from the canonical show');
    assert.deepEqual(selection(), [6, 9]);
    play();
    assert.equal(played.at(-1).mediaSourceId, 'tt42:6:9');
    assert.equal(played.at(-1).resumePositionTicks, 754);

    latest = { videoId: 'tt42:6:9', completed: true, resumePositionTicks: 1700, totalDuration: 1800 };
    listeners.get('watch-history-changed')({ detail: { id: 'tt42' } });
    await tick(); renderProvider();
    assert.deepEqual(lookups, [[show.id, 6, 9]]);
    assert.deepEqual(selection(), [6, 10]);
    play();
    assert.equal(played.at(-1).mediaSourceId, following.id);
    assert.equal(played.at(-1).resumePositionTicks, undefined);

    params = { id: show.id, season: '0', episode: '2' };
    renderProvider();
    assert.deepEqual(selection(), [0, 2], 'Explicit episode links render while progress is still pending');
    await tick(); renderProvider();
    assert.deepEqual(selection(), [0, 2], 'Explicit episode links take precedence over show progress');
    assert.equal(lookups.length, 1, 'Episode pages skip next-episode selection');

    latest = null;
    params = { id: show.id };
    renderProvider();
    await tick(); renderProvider();
    assert.deepEqual(selection(), [1, 1], 'New viewers see the pilot');
    h.unmount();
    console.log('PASS: series overview and playback share the saved, next, or first episode; direct episode links keep their selection.');
}

testDetailProgress().then(testSeriesOverview).catch(error => { console.error(error); process.exitCode = 1; });
