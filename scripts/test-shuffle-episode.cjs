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

async function run() {
    const shuffle = load('lib/media/shuffle-episode.ts');
    const { pickRandomEpisode } = shuffle;
    const now = Date.parse('2026-11-02T12:00:00Z');
    const first = { id: 'show:1:1', season: 1, episode: 1, title: 'Pilot', released: '2025-01-01', resumePositionTicks: 100 };
    const second = { id: 'show:2:1', season: 2, episode: 1, title: 'Second season', released: '2025-02-01' };
    const episodes = [
        { id: 'show:0:1', season: 0, episode: 1 },
        first, first, second,
        { id: 'show:3:1', season: 3, episode: 1, released: '2099-01-01' },
        { id: 'show:4:1', season: 4, episode: 1, released: 'invalid-date' },
        { id: 'invalid', season: 1.5, episode: 1 },
    ];
    assert.equal(pickRandomEpisode(episodes, now, () => 0).id, first.id);
    assert.equal(pickRandomEpisode(episodes, now, () => 0.5).id, second.id, 'Deduplicate before sampling and weight episodes equally');
    assert.equal(pickRandomEpisode(episodes, now, () => 0.999).id, second.id);
    assert.equal(pickRandomEpisode([], now), null);
    assert.equal(pickRandomEpisode([episodes[0], episodes[4]], now), null, 'Do not fall back to specials or future episodes');
    assert.equal(pickRandomEpisode([{ ...first, released: undefined }], now).id, first.id, 'Support add-ons that omit release dates');

    const played = [], lookups = [];
    let cursor = 0, fail = false, lookupResult = second, cleanup;
    const state = [];
    const { ShuffleEpisodeButton } = load('components/media-page/shuffle-episode-button.tsx', {
        require: name => {
            if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
            if (name === 'react') return {
                useState(initial) {
                    const i = cursor++;
                    state[i] ??= { value: initial };
                    return [state[i].value, value => { state[i].value = value; }];
                },
                useRef(initial) { return state[cursor++] ??= { current: initial }; },
                useEffect(fn) { cleanup = fn(); },
            };
            if (name === '@/lib/media/shuffle-episode') return { pickRandomEpisode: rows => pickRandomEpisode(rows, now, () => 0.99) };
            if (name === '@/app/actions/tv-shows') return { getRandomEpisodeForSeries: async id => {
                lookups.push(id);
                if (fail) throw new Error('offline');
                return lookupResult;
            } };
            if (name === '@/contexts/MediaPlayerContext') return { usePlaybackActions: () => ({ playMedia: async media => played.push(media) }) };
            return new Proxy({}, { get: (_, key) => key });
        },
    });
    const media = { id: 'show', seriesId: 'show', type: 'series', name: 'Show', streamUrl: 'https://old-stream.test',
        resumePositionTicks: 999, mediaSourceId: 'show:1:1', backdropUrl: '/show-backdrop' };
    const render = rows => { cursor = 0; return ShuffleEpisodeButton({ media, episodes: rows }); };
    const button = tree => tree.props.children[0].props.children[0].props.children;
    const firstTree = render(episodes);
    assert.equal(button(firstTree).props.variant, 'secondary');
    assert.equal(button(firstTree).props.size, 'icon-lg');
    assert.equal(button(firstTree).props['aria-label'], 'Shuffle episodes');
    assert.equal(firstTree.props.children[0].props.delayDuration, 600);
    const click = button(firstTree).props.onClick;
    const pending = click();
    await click();
    await pending;
    assert.equal(played.length, 1, 'Rapid clicks cannot start competing episodes');
    assert.equal(lookups.length, 0, 'Reuse the overview’s episode list');
    assert.equal(played[0].mediaSourceId, second.id);
    assert.equal(played[0].name, second.title);
    assert.equal(played[0].showName, 'Show');
    assert.equal(played[0].resumePositionTicks, 0);
    assert.equal(played[0].streamUrl, undefined, 'Fetch the chosen episode’s own stream');
    assert.equal(played[0].backdropUrl, media.backdropUrl);

    await button(render(undefined)).props.onClick();
    assert.deepEqual(lookups, ['show'], 'Server fallback handles missing overview metadata');
    lookupResult = null;
    const beforeEmpty = played.length;
    await button(render([])).props.onClick();
    assert.equal(played.length, beforeEmpty);
    assert.equal(render([]).props.children[1].props.role, 'alert');
    fail = true;
    await button(render(undefined)).props.onClick();
    assert.equal(render(undefined).props.children[1].props.children, "Couldn't choose an episode. Try again.");

    // A delayed lookup must not launch a show after its page unmounts.
    fail = false;
    lookupResult = second;
    const beforeUnmount = played.length;
    const delayed = button(render(undefined)).props.onClick();
    cleanup();
    await delayed;
    assert.equal(played.length, beforeUnmount);

    const routes = load('lib/series-route.ts');
    const resume = load('lib/media/resume-playback.ts', { require: () => routes });
    const { MediaPlayButton } = load('components/media-page/play-button.tsx', {
        require: name => {
            if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
            if (name === 'react') return { useState: () => [null, () => {}], useEffect() {} };
            if (name === '@/lib/media/resume-playback') return resume;
            if (name === '@/components/series-overview-playback') return { useSeriesOverviewPlayback: () => null };
            if (name === '@/contexts/MediaPlayerContext') return { usePlaybackActions: () => ({ playMedia() {} }) };
            return new Proxy({}, { get: (_, key) => key });
        },
    });
    const hasShuffle = media => MediaPlayButton({ media, episodes }).props.children
        .some(child => child && child.type === 'ShuffleEpisodeButton');
    assert.equal(hasShuffle({ id: 'show', type: 'series', name: 'Show' }), true);
    assert.equal(hasShuffle({ ...media, mediaSourceId: 'show:1:1' }), false, 'Episode actions stay focused on the selected episode');
    assert.equal(hasShuffle({ id: 'movie', type: 'movie', name: 'Movie' }), false);
    console.log('PASS: uniform random episodes, release/special filtering, fresh playback targets, rapid clicks, lookup failures, stale navigation, and show-only placement.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
