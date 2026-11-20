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
    const still = 'https://image.tmdb.org/t/p/w500/episode-still.jpg';
    let videos = [
        { id: 'tt123:0:1', season: 0, episode: 1, title: 'Special' },
        { id: 'tt123:2:1', season: 2, episode: 1 },
        { id: 'tt123:1:2', season: 1, episode: 2 },
        { id: 'tt123:1:1', season: 1, episode: 1, title: 'Pilot' },
    ];
    const context = { exports: {}, URLSearchParams, AbortSignal, console,
        fetch: async () => ({ ok: true, json: async () => ({ meta: { videos } }) }),
        require: name => name === '@/lib/series-route' ? load('lib/series-route.ts') : name === '@/lib/server/outbound-fetch' ? { outboundFetch: async () => ({ ok: true, json: async () => ({ meta: { videos } }) }) } : name === '@/lib/tmdb-artwork' ? { getTMDBArtwork: async () => still } : name === '@/lib/artwork' ? artwork : name === '@/lib/media/shuffle-episode' ? load('lib/media/shuffle-episode.ts') : name === '@/lib/tmdb-discovery' ? {
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
        if (name === '@/lib/media/episode-continuation') return { UP_NEXT_SECONDS: 5 };
        if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
        return new Proxy({}, { get: (_, key) => key });
    });
    const next = { id: 'tt123:2:1', title: 'Next season', season: 2, episode: 1 };
    const control = PlayerNextEpisode({ next, advancing: false, onAdvance: () => { advanced = true; } });
    const nextButton = control.props.children;
    assert.equal(control.props.tooltip, 'S2 E1 · Next season');
    assert.equal(nextButton.props['aria-label'], 'Play next episode: Next season');
    assert.equal(nextButton.props.variant, 'player-control');
    nextButton.props.onClick(); assert.ok(advanced, 'Manual Next shares the continuation controller');
    const busyButton = PlayerNextEpisode({ next, advancing: true, onAdvance() {} }).props.children;
    assert.equal(busyButton.props.variant, nextButton.props.variant);
    assert.equal(busyButton.props.loading, true);
    assert.equal(PlayerNextEpisode({ next: null, advancing: false, onAdvance() {} }), null,
        'An unavailable next episode must not reserve a toolbar slot');
    let cancelled = 0, played = 0;
    const thumbnail = 'https://image.tmdb.org/t/p/w300/next.jpg';
    const prompt = PlayerUpNext({ next, thumbnail, seconds: 5, onPlay: () => played++, onCancel: () => cancelled++ });
    const [artworkFrame, details] = prompt.props.children.props.children;
    const image = artworkFrame.props.children;
    const [heading, actions] = details.props.children;
    const [titleBlock, countdown] = heading.props.children;
    const timer = countdown.type(countdown.props);
    assert.equal(prompt.props['data-player-native-glass'], '');
    assert.equal(prompt.props['data-player-hdr-glass'], '');
    assert.equal(prompt.props.children.props['data-player-up-next-content'], '');
    assert.equal(image.props.src, thumbnail);
    assert.match(image.props.className, /\bsize-full\b/);
    assert.equal(timer.props['aria-label'], 'Plays in 5 seconds');
    assert.equal(timer.props.children[0].props.children[1].props['data-player-up-next-ring'], 'running');
    assert.equal(timer.props.children[1].props.children.props.digit, 5);
    assert.equal(titleBlock.props.children[1].props.children, next.title);
    const preview = PlayerUpNext({ next, thumbnail, seconds: null, onPlay() {}, onCancel() {} });
    assert.equal(preview.props.children.props.children[1].props.children[0].props.children[1], false);
    actions.props.children[0].props.onClick();
    actions.props.children[1].props.onClick();
    prompt.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    assert.equal(cancelled, 2);
    assert.equal(played, 1);

    const { hooks } = require('./test-support/react-hooks.cjs');
    const selectHost = hooks();
    const { Select } = load('components/arc/select/select.tsx', name => {
        if (name === 'react') return { ...selectHost.react, useId: () => 'season', forwardRef: render => render };
        if (name === 'react/jsx-runtime') return selectHost.jsx;
        if (name === '@radix-ui/react-select') return new Proxy({}, { get: (_, key) => key });
        if (name === 'motion/react') return { useReducedMotion: () => false, motion: { span: 'span' } };
        if (name === '../lib/motion-tokens') return load('components/arc/motion-tokens.ts');
        return { default: {} };
    });
    const seasonMenu = selectHost.render(Select, {
        label: 'Season', value: '2', options: [{ value: '2', label: 'Season 2' }], portalContainer: {},
    });
    const optionsPopup = seasonMenu.props.children[1].props.children[1].props.children;
    assert.equal(optionsPopup.props['data-base-ui-swipe-ignore'], '', 'The portalled options must opt out of drawer pointer capture');

    const drawer = hooks();
    let activeHooks = drawer;
    drawer.react.useReducer = (transition, initial) => {
        const [state, setState] = drawer.react.useState(initial);
        return [state, event => setState(previous => transition(previous, event))];
    };
    const { PlayerSelectionControls } = load('components/player-selection-controls.tsx', name => {
        if (name === 'react') return new Proxy({}, { get: (_, key) => activeHooks.react[key] });
        if (name === 'react/jsx-runtime') return drawer.jsx;
        if (name.endsWith('.css')) return { default: { surface: 'surface' } };
        if (name === '@/app/actions/tv-shows') return context.exports;
        if (name === '@/lib/artwork') return artwork;
        if (name === '@/lib/format-runtime') return load('lib/format-runtime.ts');
        if (name === '@/lib/format-release-date') return load('lib/format-release-date.ts');
        return new Proxy({}, { get: (_, key) => key });
    });
    const container = {};
    const button = { closest: () => container };
    const selections = [];
    const renderDrawer = () => drawer.render(PlayerSelectionControls, {
        media: { id: 'tt123:2:1' }, streamUrl: 'https://stream.test/current',
        playingEpisode: { seriesId: 'tt123', season: 2, episode: 1 },
        onEpisodeSelect: value => selections.push(value), onStreamSelect: value => selections.push(value),
    });
    const openPanel = index => renderDrawer().props.children[index].props.children.props.onClick({ currentTarget: button });
    const getPanel = () => renderDrawer().props.children[2];
    assert.equal(renderDrawer().props.open, false);
    openPanel(0);
    assert.equal(getPanel().props.container, container, 'The drawer opens inside the fullscreen root');
    assert.equal(getPanel().props.children[1].props.season, 2);
    getPanel().props.children[1].props.onSeasonChange(1);
    assert.equal(getPanel().props.children[1].props.season, 1);
    renderDrawer().props.onOpenChange(false);
    openPanel(0);
    assert.equal(getPanel().props.children[1].props.season, 2, 'Reopening starts at the playing season');
    getPanel().props.children[1].props.onSelect({ season: 2, episode: 1 });
    assert.equal(renderDrawer().props.open, false);
    assert.ok(getPanel(), 'Keep the panel mounted for the closing transition');
    assert.equal(selections.length, 0, 'Selecting the active episode does not restart it');
    openPanel(1);
    const selectStream = getPanel().props.children[2].props.children.props.streamSelection.onSelect;
    selectStream({ url: 'https://stream.test/current' });
    assert.equal(renderDrawer().props.open, false);
    assert.equal(selections.length, 0, 'Selecting the active stream does not restart it');
    renderDrawer().props.onOpenChangeComplete(false);
    assert.equal(getPanel(), null, 'Remove the panel when the closing transition completes');
    openPanel(1);
    const replacement = { url: 'https://stream.test/replacement' };
    getPanel().props.children[2].props.children.props.streamSelection.onSelect(replacement);
    assert.equal(selections.length, 0, 'Keep playback mounted until the drawer exits');
    renderDrawer().props.onOpenChangeComplete(false);
    assert.equal(selections[0], replacement);

    openPanel(0);
    const picker = getPanel().props.children[1];
    activeHooks = hooks();
    const choices = activeHooks.render(picker.type, picker.props).props.children[1];
    activeHooks = hooks();
    videos = [{ id: 'tt123:2:1', season: 2, episode: 1, title: 'Manhunter' }];
    const renderChoices = () => activeHooks.render(choices.type, choices.props);
    const placeholder = renderChoices().props.children[0].props.children[1];
    assert.equal(placeholder.type, 'LoadingPlaceholder');
    assert.equal(placeholder.props.children.length, 6);
    activeHooks.flush();
    await new Promise(resolve => setImmediate(resolve));
    const episodeRow = renderChoices().props.children[2].props.children[0].props.children;
    assert.equal(episodeRow.props.children[0].props.children.props.src, still, 'IMDb playback loads a TMDB still for an episode without addon artwork');
    assert.equal(episodeRow.props['aria-current'], true);
    activeHooks.unmount();

    console.log('PASS: series Play starts S1E1, skips specials, and episode playback uses the show backdrop.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
