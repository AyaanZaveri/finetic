const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, require) {
    const context = { exports: {}, require, URLSearchParams, AbortSignal, console };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, context);
    return context.exports;
}

async function run() {
    const artwork = load('lib/artwork.ts');
    let videos = [
        { id: 'tt123:0:1', season: 0, episode: 1, title: 'Special' },
        { id: 'tt123:2:1', season: 2, episode: 1 },
        { id: 'tt123:1:2', season: 1, episode: 2 },
        { id: 'tt123:1:1', season: 1, episode: 1, title: 'Pilot' },
    ];
    const context = { exports: {}, URLSearchParams, AbortSignal, console,
        fetch: async () => ({ ok: true, json: async () => ({ meta: { videos } }) }),
        require: name => name === '@/lib/series-route' ? load('lib/series-route.ts') : name === '@/lib/server/outbound-fetch' ? { outboundFetch: async () => ({ ok: true, json: async () => ({ meta: { videos } }) }) } : name === '@/lib/tmdb-artwork' ? { getTMDBArtwork: async () => undefined } : name === '@/lib/artwork' ? artwork : name === '@/lib/media/shuffle-episode' ? load('lib/media/shuffle-episode.ts') : name === '@/lib/tmdb-discovery' ? {
            getTMDBEpisodes: async (id, season) => {
                assert.equal(season, 1);
                return [{ id: `${id}:1:2`, season: 1, episode: 2 }, { id: `${id}:1:1`, season: 1, episode: 1 }];
            },
        } : {
            getAuthData: async () => ({}),
            getInstalledAddons: async () => [{ transportUrl: 'https://addon.test/manifest.json', manifest: { resources: ['meta'] } }],
        },
    };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/actions/tv-shows.ts', 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, context);
    assert.equal((await context.exports.getNextEpisodeForSeries('tt123')).id, 'tt123:1:1');
    assert.equal((await context.exports.getFollowingEpisodeForSeries('tt123', 1, 1)).id, 'tt123:1:2');
    assert.equal((await context.exports.getFollowingEpisodeForSeries('tt123', 1, 2)).id, 'tt123:2:1', 'Advance across seasons');
    assert.equal(await context.exports.getFollowingEpisodeForSeries('tt123', 2, 1), null, 'Last episode has no next button');
    assert.equal((await context.exports.getFollowingEpisodeForSeries('tt123', 0, 1)).id, 'tt123:1:1', 'Specials advance to regular seasons');
    assert.ok((await context.exports.getRandomEpisodeForSeries('tt123')).season > 0, 'Server shuffle also excludes specials');
    videos = [videos[0]];
    assert.equal(await context.exports.getNextEpisodeForSeries('tt123'), null, 'Never auto-start a special');
    assert.equal(await context.exports.getRandomEpisodeForSeries('tt123'), null, 'Shuffle cannot substitute a special when no regular episodes exist');
    assert.equal((await context.exports.getNextEpisodeForSeries('tmdb:123')).id, 'tmdb:123:1:1');

    const atoms = load('lib/atoms.ts', name => name === 'jotai'
        ? { atom: (initial, write) => ({ initial, write }) }
        : name === '@/lib/media/playback-context' ? require('./test-support/playback-context.cjs') : name === '@/lib/desktop/bridge' ? { recordDesktopStage() {} } : artwork);
    const updates = new Map();
    const play = request => atoms.playMediaAtom.write(() => {}, (key, value) => updates.set(key, value), request);
    play({ id: 'tt123', type: 'series', mediaSourceId: 'tt123:0:1', backdropUrl: '/episode-still.jpg', details: { background: 'https://image.tmdb.org/t/p/original/show.jpg' } });
    const episode = updates.get(atoms.currentMediaAtom);
    assert.equal(episode.backdropUrl, 'https://image.tmdb.org/t/p/original/show.jpg');
    assert.equal(episode.mediaSourceId, 'tt123:0:1', 'Explicitly selected specials remain playable');
    play({ id: 'movie', type: 'movie', backdropUrl: '/movie.jpg' });
    assert.equal(updates.get(atoms.currentMediaAtom).backdropUrl, '/movie.jpg');
    let advanced = false;
    const { PlayerNextEpisode, PlayerUpNext } = load('components/player-next-episode.tsx', name => {
        if (name === 'react') return { useEffect() {}, useId: () => 'up-next-title', useRef: () => ({ current: null }) };
        if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
        return new Proxy({}, { get: (_, key) => key });
    });
    const next = { id: 'tt123:2:1', title: 'Next season', season: 2, episode: 1 };
    const control = PlayerNextEpisode({ next, advancing: false, onAdvance: () => { advanced = true; } });
    const nextButton = control.props.children;
    assert.equal(control.props.tooltip, 'S2 E1 · Next season');
    assert.equal(nextButton.props['aria-label'], 'Play next episode: Next season');
    assert.equal(nextButton.props.size, 'icon-sm');
    nextButton.props.onClick(); assert.ok(advanced, 'Manual Next shares the continuation controller');
    const busyButton = PlayerNextEpisode({ next, advancing: true, onAdvance() {} }).props.children;
    assert.equal(busyButton.props.size, nextButton.props.size);
    assert.equal(busyButton.props.loading, true);
    const spacer = PlayerNextEpisode({ next: null, advancing: false, onAdvance() {} });
    assert.equal(spacer.type, 'span');
    assert.equal(spacer.props['data-player-next-slot'], '');
    let cancelled = 0, played = 0;
    const thumbnail = 'https://image.tmdb.org/t/p/w300/next.jpg';
    const prompt = PlayerUpNext({ next, thumbnail, seconds: 5, onPlay: () => played++, onCancel: () => cancelled++ });
    const [heading, title, artworkFrame, actions] = prompt.props.children.props.children;
    const image = artworkFrame.props.children;
    const timer = heading.props.children[1];
    assert.equal(prompt.props['data-player-native-glass'], '');
    assert.equal(prompt.props['data-player-hdr-glass'], '');
    assert.equal(prompt.props.children.props['data-player-up-next-content'], '');
    assert.equal(image.props.src, thumbnail);
    assert.match(image.props.className, /\bw-full\b/);
    assert.equal(timer.props['aria-label'], '5 seconds remaining');
    assert.equal(timer.props.children[0].props.children.props.digit, 5);
    assert.equal(title.props.children, next.title);
    const preview = PlayerUpNext({ next, thumbnail, seconds: null, onPlay() {}, onCancel() {} });
    assert.equal(preview.props.children.props.children[0].props.children[1], false);
    actions.props.children[0].props.onClick();
    actions.props.children[1].props.onClick();
    prompt.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    assert.equal(cancelled, 2);
    assert.equal(played, 1);
    console.log('PASS: series Play starts S1E1, skips specials, and episode playback uses the show backdrop.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
