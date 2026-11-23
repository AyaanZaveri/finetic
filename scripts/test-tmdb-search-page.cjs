const assert = require('node:assert/strict');
const React = require('react');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const runtime = require('react/jsx-runtime');
const movie = { id: 'tmdb:123', name: 'Example', type: 'movie', year: 2020 };
const show = { id: 'tmdb:20', name: 'Example TV', type: 'series', year: 2020 };
const extra = { id: 'tmdb:99', name: 'Type-only result', type: 'movie', year: 2021 };
const person = { id: '7', name: 'Example Person', type: 'person', knownFor: [] };
const css = { loadStatus: 'load-status' };
const ui = {
    react: React, 'react/jsx-runtime': runtime, 'next/link': 'a',
    'lucide-react': { SearchIcon: 'icon' },
    '@/components/ui/button': { Button: 'button' },
    '@/components/ui/empty': { Empty: 'empty', EmptyDescription: 'description', EmptyHeader: 'header', EmptyMedia: 'icon', EmptyTitle: 'title' },
    '@/components/search-page-controls': { SearchPageHeading: 'search-heading', SearchRetryButton: 'retry', SearchTypeFilters: 'search-filters' },
    '@/components/media-card': { MediaCard: 'media-card' },
    '@/components/search-person-card': { SearchPersonCard: 'person-card' },
    '@/components/home-palette-provider': { HomeInitialPalette: 'palette' },
};
const calls = []; let fail = false;
const { default: Page } = load('app/(main)/search/page.tsx', {
    ...ui,
    '@/components/search-results-view': { SearchResultsView: 'results-view' },
    '@/components/search-page.module.css': css,
    '@/components/search-section-loading': { SearchSectionLoading: 'loading' },
    '@/lib/discovery': { searchDiscovery: async (query, _signal, type, page) => {
        calls.push({ query, type, page });
        if (fail) throw new Error('Add your TMDB read access token in Settings → TMDB.');
        return { provider: 'TMDB', results: type === 'movie' ? [movie, extra] : type === 'series' ? [show] : type === 'person' ? [person] : [show, person, movie],
            totalPages: 3, totalResults: type ? 41 : 82 };
    } },
}, { Error });
function all(node) {
    if (!node || typeof node !== 'object') return [];
    return [node, ...React.Children.toArray(node.props?.children).flatMap(all)];
}
function text(node) {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    return React.Children.toArray(node?.props?.children).map(text).join('');
}
const rows = tree => React.Children.toArray(all(tree).find(node => node.type === 'ul').props.children);
const visibleIds = tree => rows(tree).filter(row => !row.props.hidden).map(row => row.props.children.props.item.id);
const keys = tree => rows(tree).map(row => row.key).sort();
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    const shell = await Page({ searchParams: Promise.resolve({ q: ' Example ', page: '4' }) });
    const results = all(shell).find(node => typeof node.type === 'function' && node.type.name === 'SearchResults');
    const body = await results.type(results.props);
    assert.equal(body.type, 'results-view');
    assert.deepEqual(calls.map(c => [c.type, c.page]), [['movie', 1], ['series', 1], [undefined, 1], ['person', 1]], 'Legacy page links start the infinite feed at page one');
    const props = body.props;
    let params = new URLSearchParams('q=Example&page=4');
    const changes = [], requests = [], observers = [];
    const h = hooks();
    const scrollRoot = { id: 'persistent-scrollport' };
    class Observer {
        constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this); }
        observe(target) { this.target = target; }
        disconnect() { this.disconnected = true; }
        fire() { this.callback([{ isIntersecting: true }]); }
    }
    const { SearchResultsView } = load('components/search-results-view.tsx', {
        ...ui, react: { ...React, ...h.react, useSyncExternalStore: (_subscribe, get) => get() }, './search-page.module.css': css,
        'next/navigation': { useSearchParams: () => params },
    }, { Error, URLSearchParams, IntersectionObserver: Observer,
        fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })),
        window: { history: { pushState(_state, _unused, url) { changes.push(url); params = new URL(url, 'http://app').searchParams; } } },
    });
    let tree;
    function render() {
        tree = h.render(SearchResultsView, props);
        const sentinel = all(tree).find(node => node.type === 'div' && node.props.ref);
        if (sentinel) sentinel.props.ref.current = { closest(selector) { assert.equal(selector, '[data-page-scroll]'); return scrollRoot; } };
        h.flush();
        return tree;
    }
    render();
    assert.deepEqual(visibleIds(tree), ['tmdb:20', '7', 'tmdb:123']);
    const originalKeys = keys(tree), originalItems = rows(tree).map(row => row.props.children.props.item);
    assert.ok(rows(tree).every(row => row.props.children.type === 'person-card' || row.props.children.props.revealArtwork === false));
    assert.equal(all(tree).some(node => node.type === 'nav'), false, 'Remove pagination controls');
    assert.equal(all(tree).some(node => /^Page \d/.test(text(node))), false, 'Remove page numbers');
    assert.equal(observers.at(-1).options.root, scrollRoot);
    assert.equal(observers.at(-1).options.rootMargin, '600px 0px');
    for (const type of ['movie', 'series', 'person', 'all']) {
        all(tree).find(node => node.type === 'search-filters').props.onValueChange(type); render();
        assert.deepEqual(keys(tree), originalKeys, 'Segment changes retain keyed cards');
        assert.deepEqual(visibleIds(tree), type === 'movie' ? ['tmdb:123', 'tmdb:99'] : type === 'series' ? ['tmdb:20'] : type === 'person' ? ['7'] : ['tmdb:20', '7', 'tmdb:123']);
    }
    assert.equal(requests.length, 0, 'Cached first-page segment changes make no requests');
    assert.equal(changes[0], '/search?q=Example&type=movie');
    const observer = observers.at(-1); observer.fire(); observer.fire();
    assert.equal(requests.length, 1, 'A visible sentinel fetches exactly once');
    assert.equal(new URL(requests[0].url, 'http://app').searchParams.get('page'), '2');
    render(); assert.equal(all(tree).find(node => node.type === 'ul').props['aria-busy'], true);
    requests[0].resolve({ ok: true, json: async () => ({ results: [movie, extra], totalPages: 3, totalResults: 82 }) });
    await tick(); render();
    assert.deepEqual(visibleIds(tree), ['tmdb:20', '7', 'tmdb:123', 'tmdb:99'], 'Append in native order without duplicates');
    assert.ok(rows(tree).every(row => originalItems.includes(row.props.children.props.item)), 'Existing card metadata remains stable');
    const palette = all(tree).find(node => node.type === 'palette').props.primary;
    all(tree).find(node => node.type === 'search-filters').props.onValueChange('series'); render();
    params = new URLSearchParams('q=Example'); render();
    assert.deepEqual(visibleIds(tree), ['tmdb:20', '7', 'tmdb:123', 'tmdb:99'], 'History navigation restores the complete loaded feed');
    assert.equal(all(tree).find(node => node.type === 'palette').props.primary, palette, 'Appending does not change the first-poster palette');
    observers.at(-1).fire(); render();
    requests[1].resolve({ ok: false, json: async () => ({ error: 'Search is unavailable' }) });
    await tick(); render();
    assert.ok(all(tree).some(node => node.props?.role === 'alert'));
    assert.equal(visibleIds(tree).length, 4, 'A later failure keeps the grid');
    const count = requests.length; observers.at(-1).fire(); assert.equal(requests.length, count, 'Do not loop retries automatically');
    all(tree).find(node => node.type === 'button' && text(node) === 'Try again').props.onClick(); render();
    requests[2].resolve({ ok: true, json: async () => ({ results: [], totalPages: 3, totalResults: 82 }) });
    await tick(); render();
    assert.equal(all(tree).some(node => node.type === 'button' && text(node) === 'Load more results'), false, 'Final page removes the sentinel');
    h.unmount(); assert.ok(observers.every(observer => observer.disconnected));

    fail = true; const error = await results.type(results.props);
    assert.equal(error.props.role, 'alert'); assert.ok(all(error).some(node => node.type === 'retry'));
    const beforeInvalid = calls.length;
    for (const q of ['', 'x'.repeat(301)]) {
        const invalid = await Page({ searchParams: Promise.resolve({ q }) });
        assert.ok(!all(invalid).some(node => typeof node.type === 'function' && node.type.name === 'SearchResults'));
    }
    assert.equal(calls.length, beforeInvalid);

    const headingHooks = hooks(), scrolls = [], focuses = [];
    const { SearchPageHeading } = load('components/search-page-controls.tsx', {
        ...ui, react: { ...React, ...headingHooks.react },
        'next/navigation': { useSearchParams: () => params },
        '@/components/arc/segmented-control/segmented-control': 'segments', './search-page.module.css': css,
    }, { document: { title: '', querySelector: () => ({ scrollTo: options => scrolls.push(options) }) } });
    const heading = headingHooks.render(SearchPageHeading, { query: 'Example' });
    all(heading).find(node => node.type === 'h1').props.ref.current = { focus: options => focuses.push(options) };
    headingHooks.flush();
    params = new URLSearchParams('q=Example&type=movie');
    headingHooks.render(SearchPageHeading, { query: 'Example' }); headingHooks.flush();
    assert.equal(focuses.length, 0, 'Filters retain keyboard focus'); assert.equal(scrolls.length, 1, 'A new type starts at the top');
    params.set('page', '2'); headingHooks.render(SearchPageHeading, { query: 'Example' }); headingHooks.flush();
    assert.equal(scrolls.length, 1, 'Legacy page parameters cannot reset scrolling');
    headingHooks.render(SearchPageHeading, { query: 'New query' }); headingHooks.flush();
    assert.equal(focuses.length, 1, 'A new search restores heading focus'); headingHooks.unmount();
    console.log('PASS: search infinite-scroll integration, persistent scrollport, filter/history caches, stable cards/palette, retry, final-page stop, and heading focus.');
})().catch(error => { console.error(error); process.exitCode = 1; });
