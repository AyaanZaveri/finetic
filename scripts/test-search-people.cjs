const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const { groupSearchSuggestions } = load('lib/search-suggestion-groups.ts');
for (const leadingType of ['movie', 'series', 'person']) {
    const input = [
        { id: '1', type: leadingType }, { id: '2', type: 'movie' },
        { id: '3', type: 'person' }, { id: '4', type: 'series' }, { id: '1', type: leadingType },
    ];
    const grouped = groupSearchSuggestions(input);
    assert.equal(grouped[0].type, leadingType);
    assert.equal(grouped.length, 4, 'Duplicate suggestions do not consume the shortlist');
    assert.ok(grouped.every((item, index) => index === 0 || item.type === grouped[index - 1].type || !grouped.slice(0, index - 1).some(previous => previous.type === item.type)), 'Every type is contiguous');
}
assert.equal(groupSearchSuggestions([]).length, 0, 'Do not create empty groups');
const h = hooks(), timers = new Map(), navigations = [], prefetches = [];
let timerId = 0;
const suggestions = [
    { id: '7', type: 'person', name: 'Nathan Fielder', department: 'Acting', poster: '/person.jpg' },
    { id: 'tmdb:20', type: 'series', name: 'Nathan for You', year: 2013 },
    { id: 'tmdb:123', type: 'movie', name: 'Example film', year: 2020 },
    { id: 'tmdb:21', type: 'series', name: 'Another show' },
    { id: '8', type: 'person', name: 'Another person' },
    { id: 'tmdb:124', type: 'movie', name: 'Another movie' },
    { id: 'tmdb:125', type: 'movie', name: 'Weaker match outside shortlist' },
];
const { SearchBar } = load('components/search-component.tsx', {
    react: h.react, 'react/jsx-runtime': h.jsx,
    '@/components/artwork-image': { ArtworkImage: 'artwork' },
    'lucide-react': { Film: 'film', Star: 'star', Tv: 'tv', UserRound: 'person-icon' },
    'next/navigation': { usePathname: () => '/', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: href => navigations.push(href), prefetch: href => prefetches.push(href) }) },
    '@/lib/search-catalog-stream': { fetchSearchSuggestions: async (_query, publish) => publish([{ items: suggestions }]) },
    '@/components/arc/expanding-search/expanding-search': { ExpandingSearch: 'search' },
    '@/contexts/MediaPlayerContext': { useIsPlayerVisible: () => false },
    '@/lib/route-prefetch': { scheduleRoutePrefetch: (href, start) => { start(); return () => {}; } },
}, { URLSearchParams, document: { addEventListener() {}, removeEventListener() {} },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); } });
(async () => {
    let tree = h.render(SearchBar, {}); h.flush();
    tree.props.onValueChange('Nathan');
    tree = h.render(SearchBar, {}); h.flush();
    await Array.from(timers.values()).at(-1)();
    tree = h.render(SearchBar, {}); h.flush();
    assert.deepEqual(Array.from(tree.props.items, item => item.id), ['person:7', 'person:8', 'series:tmdb:20', 'series:tmdb:21', 'movie:tmdb:123', 'movie:tmdb:124']);
    assert.deepEqual(Array.from(new Set(tree.props.items.map(item => item.group))), ['People', 'TV shows', 'Movies'], 'The strongest matching group leads and each type has one heading');
    assert.ok(tree.props.placeholder.includes('people'));
    tree.props.onItemIntent(tree.props.items[0]);
    assert.equal(prefetches.at(-1), '/person/7');
    tree.props.onSelect(tree.props.items[0]);
    assert.equal(navigations.at(-1), '/person/7', 'Selecting a person opens their profile rather than a movie or another search');
    tree.props.onSelect(tree.props.items[2]);
    assert.equal(navigations.at(-1), '/series/tmdb:20');
    h.unmount();
    console.log('PASS: search suggestions group the strongest six matches by type, prioritize the best group, prefetch profiles, and select the correct routes');
})().catch(error => { console.error(error); process.exitCode = 1; });
