const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const { homeAuroraBase, homeAuroraArtwork, createHomeAuroraSelection } = load('lib/home-aurora.ts');

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const node = (bounds, attributes = {}) => ({
    bounds, attributes, matches: {},
    getBoundingClientRect() { return this.bounds; },
    getAttribute(name) { return this.attributes[name] ?? null; },
    querySelector(selector) { return this.matches[selector]?.[0] ?? null; },
    querySelectorAll(selector) { return this.matches[selector] ?? []; },
});
const card = (name, bounds, imageBounds = bounds) => {
    const element = node(bounds, { 'data-aurora-primary': name, 'data-aurora-fallback': `${name}-fallback` });
    element.matches['[data-home-aurora-artwork]'] = [node(imageBounds)];
    return element;
};
const row = (bounds, cards) => {
    const element = node(bounds);
    element.matches['[data-home-aurora-card]'] = cards;
    return element;
};
const viewport = node(rect(0, 0, 1000, 700));
const header = node(rect(0, 0, 1000, 90));
const page = node(rect(0, 0, 1000, 2000));
const hero = node(rect(0, 0, 1000, 460), { 'data-aurora-primary': 'hero', 'data-aurora-fallback': 'hero-poster' });
const a = card('first', rect(40, 500, 150, 230));
const b = card('second', rect(206, 500, 150, 230));
const firstRow = row(rect(40, 500, 920, 230), [a, b]);
const c = card('next-row', rect(40, 820, 150, 230));
const nextRow = row(rect(40, 820, 920, 230), [c]);
page.matches['[data-home-hero]'] = [hero];
// Virtual rows need not be DOM-ordered by their current screen coordinates.
page.matches['[data-media-row-viewport]'] = [nextRow, firstRow];
const source = () => homeAuroraBase(page, viewport, header)?.primary;
assert.equal(source(), 'hero', 'The displayed hero owns the upper viewport');
hero.attributes['data-aurora-primary'] = 'hero-next';
assert.equal(source(), 'hero-next', 'The displayed slide change becomes the new base');
hero.bounds = rect(0, -460, 1000, 460);
firstRow.bounds = rect(40, 40, 920, 230);
a.bounds = a.matches['[data-home-aurora-artwork]'][0].bounds = rect(40, 40, 150, 230);
b.bounds = b.matches['[data-home-aurora-artwork]'][0].bounds = rect(206, 40, 150, 230);
nextRow.bounds = rect(40, 360, 920, 230);
c.bounds = c.matches['[data-home-aurora-artwork]'][0].bounds = rect(40, 360, 150, 230);
assert.equal(source(), 'first', 'The first visible row owns the base after the hero scrolls away');
a.bounds = a.matches['[data-home-aurora-artwork]'][0].bounds = rect(-180, 40, 150, 230);
assert.equal(source(), 'second', 'Horizontal scrolling selects the leftmost visible poster, not the first mounted card');
b.matches['[data-home-aurora-artwork]'][0].bounds = rect(206, -120, 150, 200);
assert.equal(source(), 'next-row', 'A poster hidden behind the header cannot hold the base with just its caption');
page.matches['[data-home-hero]'] = [];
assert.equal(source(), 'next-row', 'Home can use Aurora without featured artwork');
assert.equal(homeAuroraArtwork(node(rect(0, 0, 0, 0))), null);

const tick = () => new Promise(resolve => setImmediate(resolve));

async function controllerLifecycle() {
    const h = hooks();
    class FakeElement {}
    const row = node(rect(40, 440, 900, 230));
    const left = card('left', rect(40, 440, 150, 230));
    const right = card('right', rect(206, 440, 150, 230));
    [left, right].forEach(element => {
        Object.setPrototypeOf(element, FakeElement.prototype);
        element.closest = () => element;
        element.contains = target => target === element;
    });
    row.matches['[data-home-aurora-card]'] = [left, right];
    const fixtureHero = node(rect(0, 0, 1000, 400), { 'data-aurora-primary': 'hero-art' });
    const fixturePage = node(rect(0, 0, 1000, 1400));
    fixturePage.matches['[data-home-hero]'] = [fixtureHero];
    fixturePage.matches['[data-media-row-viewport]'] = [row];
    fixturePage.contains = target => target === left || target === right;
    const fixtureViewport = node(rect(0, 0, 1000, 700));
    fixtureViewport.matches['[data-home-page]'] = [fixturePage];
    fixtureViewport.contains = fixturePage.contains;
    fixtureViewport.closest = () => ({ querySelector: () => header });
    const listeners = new Map(), frames = new Map(), timers = new Map(), publications = [], sources = [];
    let frameId = 0, timerId = 0, released = 0, mutation, registrationCount = 0;
    fixtureViewport.addEventListener = (name, listener) => listeners.set(name, listener);
    fixtureViewport.removeEventListener = name => listeners.delete(name);
    const clock = {
        set(fn) { timers.set(++timerId, fn); return timerId; },
        clear(id) { timers.delete(id); },
    };
    const register = () => { registrationCount++; return { resolve: colors => publications.push(colors[0]), release: () => released++ }; };
    const { HomeAuroraController } = load('components/home-aurora-controller.tsx', {
        react: h.react, 'react/jsx-runtime': h.jsx,
        'next/navigation': { usePathname: () => '/' }, 'next-themes': { useTheme: () => ({ resolvedTheme: 'dark' }) },
        jotai: { useAtomValue: () => false }, '@/lib/atoms': {},
        '@/components/aurora-provider': { useAuroraRegistration: () => register },
        '@/lib/aurora-palette-loader': { loadHomePalette: async primary => { sources.push(primary); return [primary]; } },
        '@/lib/home-aurora': { homeAuroraArtwork, homeAuroraBase, createHomeAuroraSelection: (load, publish) => createHomeAuroraSelection(load, publish, clock) },
    }, {
        Element: FakeElement, Node: FakeElement,
        window: {
            matchMedia: () => ({ matches: true }),
            requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; },
            cancelAnimationFrame(id) { frames.delete(id); }, addEventListener() {}, removeEventListener() {},
        },
        ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
        MutationObserver: class { constructor(fn) { mutation = fn; } observe() {} disconnect() { mutation = null; } },
    });
    const flush = async () => {
        for (const [id, fn] of [...frames]) { frames.delete(id); fn(); }
        for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
        await tick();
    };
    h.render(HomeAuroraController).props.ref.current = { closest: () => fixtureViewport };
    h.flush(); await tick();
    assert.equal(publications.at(-1), 'hero-art');
    fixtureHero.attributes['data-aurora-primary'] = 'new-hero'; mutation(); await flush();
    assert.equal(publications.at(-1), 'new-hero', 'Hero DOM changes retarget the persistent Aurora');
    fixtureHero.bounds = rect(0, -400, 1000, 400);
    row.bounds = rect(40, 40, 900, 230);
    left.matches['[data-home-aurora-artwork]'][0].bounds = rect(40, 40, 150, 230);
    right.matches['[data-home-aurora-artwork]'][0].bounds = rect(206, 40, 150, 230);
    listeners.get('scroll')(); listeners.get('scroll')();
    assert.equal(frames.size, 1, 'Scroll measurements coalesce into a single frame');
    await flush(); assert.equal(publications.at(-1), 'left');
    listeners.get('pointermove')({ pointerType: 'mouse', target: right }); await flush();
    assert.equal(publications.at(-1), 'right');
    listeners.get('pointerout')({ pointerType: 'mouse', relatedTarget: null }); await flush();
    assert.equal(publications.at(-1), 'left', 'Leaving hover restores the top-left visible poster');
    listeners.get('pointermove')({ pointerType: 'touch', target: right }); await flush();
    assert.equal(publications.at(-1), 'left', 'Touch does not create phantom hover');
    assert.equal(registrationCount, 1, 'All updates reuse one persistent scene');
    const count = sources.length;
    listeners.get('pointermove')({ pointerType: 'mouse', target: right });
    h.unmount(); await flush();
    assert.equal(sources.length, count, 'Unmount cancels pending hover extraction');
    assert.equal(listeners.size, 0); assert.equal(released, 1); assert.equal(mutation, null);
}

(async () => {
    let now = 0, timerId = 0;
    const timers = new Map(), requests = [], publications = [];
    const clock = {
        set(fn, delay) { const id = ++timerId; timers.set(id, { fn, time: now + delay }); return id; },
        clear(id) { timers.delete(id); },
    };
    const selection = createHomeAuroraSelection((primary, fallback) => new Promise(resolve => requests.push({ primary, fallback, resolve })), colors => publications.push(colors), clock);
    const advance = duration => {
        now += duration;
        for (const [id, timer] of [...timers]) if (timer.time <= now) { timers.delete(id); timer.fn(); }
    };
    const art = primary => ({ primary });
    const red = ['#ff0000', '#cc0000', '#aa0000'], blue = ['#0000ff', '#0000cc', '#0000aa'], green = ['#00ff00', '#00cc00', '#00aa00'];
    selection.setBase(art('hero'), true);
    requests.at(-1).resolve(red); await tick();
    assert.equal(publications.at(-1), red);
    selection.setHover(art('brief')); advance(50); selection.setHover(null); advance(100);
    assert.equal(requests.length, 1, 'Brief pointer crossings do not extract a palette');
    selection.setHover(art('hover')); advance(90);
    const hoverRequest = requests.at(-1);
    selection.setBase(art('new-row')); advance(100);
    assert.equal(requests.at(-1), hoverRequest, 'A changing base cannot replace an intentional hover');
    hoverRequest.resolve(blue); await tick();
    assert.equal(publications.at(-1), blue);
    selection.setHover(null);
    assert.equal(requests.at(-1).primary, 'new-row', 'Leaving restores the latest scroll base');
    requests.at(-1).resolve(green); await tick();
    assert.equal(publications.at(-1), green);
    selection.setHover(art('slow-hover')); advance(90);
    const stale = requests.at(-1);
    selection.scroll(art('landed-row')); advance(90);
    const landing = requests.at(-1);
    assert.equal(landing.primary, 'landed-row');
    landing.resolve(red); await tick(); stale.resolve(blue); await tick();
    assert.equal(publications.at(-1), red, 'Scrolling clears hover and stale results cannot repaint the landing row');
    selection.setBase(art('landed-row')); advance(100);
    assert.equal(requests.at(-1), landing, 'Repeated scroll measurements do not duplicate extraction');
    selection.setFocus(art('keyboard')); const keyboard = requests.at(-1);
    keyboard.resolve(null); await tick(); assert.equal(publications.at(-1), red, 'Extraction failures retain the last valid palette');
    selection.setFocus(null);
    selection.setHover(art('late')); advance(90); const late = requests.at(-1);
    selection.dispose(); late.resolve(blue); await tick();
    assert.equal(publications.at(-1), red, 'Unmounted controllers cannot publish late results');
    assert.equal(timers.size, 0);
    await controllerLifecycle();
    console.log('PASS: Home Aurora follows visible hero/rail/poster geometry, horizontal scroll, hover and keyboard intent, latest-base restoration, failure and stale-result protection.');
})().catch(error => { console.error(error); process.exitCode = 1; });
