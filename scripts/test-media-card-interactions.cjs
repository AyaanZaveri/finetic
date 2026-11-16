const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const state = [];
let stateIndex = 0;
const playback = [];
const routes = [];
const palettes = [];
let finePointer = true;
let resumeWarmup = null;
let cardArtwork = { poster: '/poster.jpg', background: '/backdrop.jpg' };
class TestNode {}
class TestElement extends TestNode { matches(selector) { return selector === ':focus-visible'; } }
const routeContext = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/series-route.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, routeContext);
const context = { exports: {}, Element: TestElement, Node: TestNode, window: { matchMedia: () => ({ matches: finePointer }) }, require(name) {
    if (name === '@/components/metadata-preload') return { useMetadataIntent: () => ({ start() {}, cancel() {} }) };
    if (name === '@/components/artwork-image') return { ArtworkImage: 'img' };
    if (name === '@/lib/preload-tools') return { preloadPlayer() {} };
    if (name === '@/lib/media/playback-details') return require('./test-support/playback-context.cjs').details;
    if (name === '@/components/continue-watching-warmup') return { useContinueWatchingWarmup: () => resumeWarmup };
    if (name === '@/components/home-palette-provider') return { useHomePaletteScene: () => ({
        hover: (...args) => palettes.push(['hover', ...args]), focus: (...args) => palettes.push(['focus', ...args]),
        leave: (...args) => palettes.push(['leave', ...args]), release() {},
    }) };
    if (name === 'react') return { ...React, useState(initial) {
        const index = stateIndex++;
        if (!(index in state)) state[index] = initial;
        return [state[index], value => { state[index] = value; }];
    }, useRef: initial => ({ current: initial }), useCallback: callback => callback, useEffect() {} };
    if (name === '@/lib/artwork') return { mediaArtwork: () => cardArtwork, backdropVariantUrl: (url, width) => `${url}?width=${width}` };
    if (name === '@/components/watched-indicator') return { WatchedIndicator: () => null };
    if (name === '@/lib/series-route') return routeContext.exports;
    if (name === '@/contexts/MediaPlayerContext') return { usePlaybackActions: () => ({ playMedia: async item => playback.push(item), setIsPlayerVisible: visible => playback.push(visible) }) };
    if (name === 'next/link') return ({ children }) => children;
    if (name === '@/components/intent-link') return { IntentLink: ({ children }) => children };
    if (name === 'next/navigation') return { useRouter: () => ({ push: (href, options) => routes.push({ href, options }) }) };
    if (name.endsWith('.module.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    return require(name);
} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/media-card.tsx', 'utf8'), {
    fileName: 'components/media-card.tsx',
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, context);
function render(continueWatching = false) {
    stateIndex = 0;
    return context.exports.MediaCard({ continueWatching, item: { id: 'tt123', name: 'Fixture', type: 'movie', progressPercent: 42, resumePositionTicks: 30, streamUrl: 'https://example.test/movie.mp4' } });
}
assert.equal(render(true).props['data-continue-watching'], true, 'Resume cards opt into stable brightness styling');
function find(node, predicate) {
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) return node;
    let found;
    React.Children.forEach(node.props?.children, child => { found ||= find(child, predicate); });
    return found;
}
const surface = (resume = false) => find(render(resume), node => node.props?.className?.split(' ').includes('surface'));
const thumbnail = find(render(true), node => node.type === 'img');
assert.equal(thumbnail.props.sizes, '320px');
assert.equal(thumbnail.props.src, '/backdrop.jpg?width=780');
assert.equal(thumbnail.props.width, 320);
assert.equal(thumbnail.props.height, 180);
assert.ok(thumbnail.props.srcSet.includes('width=1280 1280w'));
assert.equal(render().props['data-continue-watching'], undefined, 'Regular posters retain normal hover styling');
for (const pointerType of ['touch', 'pen']) render().props.onPointerEnter({ pointerType });
assert.equal(palettes.length, 0, 'Touch and pen cannot create hover palette changes');
finePointer = false; render().props.onPointerEnter({ pointerType: 'mouse' }); assert.equal(palettes.length, 0);
finePointer = true;
render(true).props.onPointerEnter({ pointerType: 'mouse' });
assert.equal(palettes.at(-1)[2].primary, '/backdrop.jpg', 'Resume colors come from the displayed backdrop');
render().props.onPointerEnter({ pointerType: 'mouse' });
assert.equal(palettes.at(-1)[2].primary, '/poster.jpg', 'Catalog colors come from the displayed poster');
render().props.onFocusCapture({ target: new TestElement(), relatedTarget: null });
assert.equal(palettes.at(-1)[0], 'focus');
const beforePointerFocus = palettes.length;
render().props.onFocusCapture({ target: { matches: () => false } });
assert.equal(palettes.length, beforePointerFocus, 'Mouse focus cannot bypass hover intent');
function hasSeparateResumeShade(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.props?.className?.includes('bg-black/35')) return true;
    return React.Children.toArray(node.props?.children).some(hasSeparateResumeShade);
}
assert.equal(hasSeparateResumeShade(render(true)), false, 'A separate shade must not be composited over the resume image');
for (const resume of [false, true]) {
    for (const end of ['onPointerLeave', 'onPointerCancelCapture', 'onPointerUpCapture']) {
        render(resume).props.onPointerDownCapture({ button: 0, isPrimary: true });
        const card = render(resume), pressedSurface = surface(resume);
        assert.equal(pressedSurface.props['data-pressed'], true);
        assert.ok(find(pressedSurface, node => node.type === 'img'), 'Artwork is inside the shared press plane');
        assert.ok(find(pressedSurface, node => node.type === 'button'), 'Play scales with the complete thumbnail');
        assert.ok(find(pressedSurface, node => Object.hasOwn(node.props ?? {}, 'aboveProgress')), 'The watched marker scales with the thumbnail');
        if (resume) assert.ok(find(pressedSurface, node => node.props?.role === 'progressbar'), 'Playback progress scales on the same plane');
        assert.equal(find(pressedSurface, node => node.props?.children === 'Fixture'), undefined, 'Text below the thumbnail stays outside the transform');
        assert.equal(card.props.children[0].props['data-pressed'], undefined, 'The details link remains a stable hit target');
        card.props[end]();
        assert.equal(surface(resume).props['data-pressed'], undefined, end + ' must clear press feedback');
    }
}
render().props.onPointerDownCapture({ button: 2, isPrimary: true });
assert.equal(surface().props['data-pressed'], undefined, 'Secondary clicks must not scale the card');
render().props.onPointerDownCapture({ button: 0, isPrimary: false });
assert.equal(surface().props['data-pressed'], undefined, 'A secondary touch must not start press feedback');
function findButton(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'button') return node;
    let found;
    React.Children.forEach(node.props?.children, child => { found ||= findButton(child); });
    return found;
}
(async () => {
    cardArtwork = { poster: '/poster.jpg' };
    await findButton(render()).props.onClick({ preventDefault() {}, stopPropagation() {} });
    assert.equal(playback.at(-2).backdropUrl, undefined, 'Movie catalog Play never sends a poster as a backdrop');
    cardArtwork = { poster: '/poster.jpg', background: '/backdrop.jpg' };
    for (const resume of [false, true]) {
        await findButton(render(resume)).props.onClick({ preventDefault() {}, stopPropagation() {} });
        assert.equal(playback.at(-2).backdropUrl, '/backdrop.jpg', 'Catalog and Continue Watching both pass landscape artwork');
    }
    let prevented = false, stopped = false;
    await findButton(render()).props.onClick({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    assert.equal(prevented && stopped, true);
    assert.equal(playback[0].streamUrl, 'https://example.test/movie.mp4');
    assert.equal(playback[0].resumePositionTicks, 30);
    assert.equal(playback[1], true);
    assert.equal(routes.length, 0, 'Card Play cannot switch the page before the player covers it');
    assert.equal(playback[0].detailsPath, '/movie/tt123', 'The player receives the return destination');
    const shared = { id: 'resume', promise: Promise.resolve([]) };
    resumeWarmup = { claim: () => shared, intent: () => () => {} };
    await findButton(render(true)).props.onClick({ preventDefault() {}, stopPropagation() {} });
    assert.equal(playback.at(-2).streamRequest, shared, 'Continue Watching Play hands the existing discovery request to playback');
    resumeWarmup = null;
    for (const continueWatching of [false, true]) {
        stateIndex = 0;
        const card = context.exports.MediaCard({ continueWatching, item: { id: 'tt-show', name: 'Show', type: 'series', seasonNumber: 2, episodeNumber: 3, mediaSourceId: 'tt-show:2:3', resumePositionTicks: 42 } });
        await findButton(card).props.onClick({ preventDefault() {}, stopPropagation() {} });
        assert.equal(playback.at(-2).detailsPath, continueWatching ? '/series/tt-show/2/3' : '/series/tt-show');
        assert.equal(playback.at(-2).resumePositionTicks, 42);
    }
    const episodeContext = { exports: {}, require: context.require };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/episode-card.tsx', 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, episodeContext);
    stateIndex = 0;
    const episode = episodeContext.exports.EpisodeCard({ seriesId: 'tmdb:114294', episode: { id: 'tmdb:114294:1:2', title: 'Episode two', season: 1, episode: 2, resumePositionTicks: 15 } });
    await findButton(episode).props.onClick({ preventDefault() {}, stopPropagation() {} });
    assert.equal(playback.at(-2).detailsPath, '/series/tmdb%3A114294/1/2', 'Episode Play retains its exact return route');
    assert.equal(playback.at(-2).mediaSourceId, 'tmdb:114294:1:2');
    console.log('PASS: press scale resets on pointer leave, cancel and release; secondary clicks are ignored; playback remains intact.');
    console.log('PASS: movie, show, Continue Watching, and episode Play navigate to their matching detail route.');
})().catch(error => { console.error(error); process.exitCode = 1; });
