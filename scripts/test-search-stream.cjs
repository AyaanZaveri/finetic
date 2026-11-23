const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const globals = { Error, Request, Response, URL, URLSearchParams, ReadableStream, TextEncoder, TextDecoder, AbortController, AbortSignal };
(async () => {
  let upstream, finish, fail;
  const calls = [];
  const { GET } = load('app/api/search/suggestions/route.ts', {
    '@/lib/discovery': { searchDiscovery: (query, signal) => {
      calls.push(query); upstream = signal;
      return new Promise((resolve, reject) => { finish = resolve; fail = reject;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
    } },
    '@/app/actions/search': new Proxy({}, { get() { throw Error('Search must never call a Stremio add-on'); } }),
  }, globals);
  for (const query of ['', '   ', 'a'.repeat(301)]) {
    assert.equal((await GET(new Request(`http://app/api/search/suggestions?${new URLSearchParams({ q: query })}`))).status, 400);
  }
  assert.equal(calls.length, 0);
  for (const query of ['f1', 'it', 'x']) {
    const shortSearch = GET(new Request(`http://app/api/search/suggestions?q=${query}`));
    await tick();
    assert.equal(calls.at(-1), query, 'Short titles must reach TMDB');
    finish({ provider: 'TMDB', results: [{ id: 'tmdb:911430', type: 'movie', name: query }] });
    const shortResponse = await shortSearch;
    assert.equal(shortResponse.status, 200);
    assert.equal(JSON.parse(await shortResponse.text()).sections[0].items[0].name, query);
  }
  calls.length = 0;
  const pending = GET(new Request('http://app/api/search/suggestions?q=Interstellar'));
  await tick();
  assert.deepEqual(calls, ['Interstellar'], 'One TMDB multi-search, with no add-on fan-out or per-result lookups');
  finish({ provider: 'TMDB', results: [{ id: 'tmdb:157336', type: 'movie', name: 'Interstellar' }] });
  const response = await pending;
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const message = JSON.parse(await response.text());
  assert.equal(message.sections[0].items[0].id, 'tmdb:157336');
  const request = new AbortController();
  const cancelledSearch = GET(new Request('http://app/api/search/suggestions?q=test', { signal: request.signal }));
  await tick(); request.abort();
  assert.equal((await cancelledSearch).status, 503);
  assert.equal(upstream.aborted, true, 'Replaced queries cancel the TMDB request');
  const unavailable = GET(new Request('http://app/api/search/suggestions?q=test'));
  await tick(); fail(Error('Add your TMDB read access token in Settings → TMDB.'));
  assert.match((await (await unavailable).json()).error, /TMDB read access token/);

  const encoder = new TextEncoder();
  const results = [];
  let cancelled = false;
  const sections = [{ key: 'one', items: [{ name: 'Épisode' }] }];
  const bytes = encoder.encode(JSON.stringify({ sections }) + '\n' + JSON.stringify({ sections: [{ key: 'two', items: [] }] }));
  const helper = load('lib/search-catalog-stream.ts', {}, { ...globals, fetch: async () => new Response(new ReadableStream({
    start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); },
  })) });
  await helper.fetchSearchSuggestions('test', rows => results.push(...rows), new AbortController().signal);
  assert.equal(results.length, 2);
  assert.equal(results[0].items[0].name, 'Épisode', 'UTF-8 and JSON may span arbitrary network chunks');
  const broken = load('lib/search-catalog-stream.ts', {}, { ...globals, fetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode('invalid json\n')); }, cancel() { cancelled = true; },
  })) });
  await assert.rejects(broken.fetchSearchSuggestions('test', () => {}, new AbortController().signal));
  assert.equal(cancelled, true, 'Malformed streams must release their network reader');

  let upstreamSignal;
  const actions = load('app/actions/search.ts', {
    '@/lib/server/auth': { getAuthData: async () => ({ authKey: 'fixture-only' }) },
    '@/lib/server/outbound-fetch': { outboundFetch: 'fixture-fetch' },
    react: { cache: fn => fn }, '@/lib/artwork': { publicArtworkUrl: () => '/poster' }, '@/lib/server/media-artwork': { resolveArtworkList: async items => items },
    './auth': { getInstalledAddons: async () => [{ transportUrl: 'https://addon.test', manifest: {
      id: 'one', name: 'One', catalogs: [{ id: 'top', type: 'movie', extra: [{ name: 'search' }] }],
    } }] },
  }, { ...globals, console: { error() {} }, fetch: async (_url, init) => {
    upstreamSignal = init.signal;
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  } });
  const abort = new AbortController();
  const work = actions.searchCatalogSectionsForAddon('test', 'https://addon.test', abort.signal);
  await tick(); abort.abort();
  await assert.rejects(work);
  assert.equal(upstreamSignal.aborted, true);

  const h = hooks(), timers = new Map(), suggestions = [], warmups = [], prefetched = [];
  let timerId = 0;
  const { SearchBar } = load('components/search-component.tsx', {
    react: h.react, 'react/jsx-runtime': h.jsx,
    '@/components/artwork-image': { ArtworkImage: 'artwork' },
    '@/lib/route-prefetch': { scheduleRoutePrefetch(href, warm) { const entry = { href, warm, cancelled: false }; warmups.push(entry); return () => { entry.cancelled = true; }; } },
    'lucide-react': { Film: 'film', Star: 'star', Tv: 'tv' },
    'next/navigation': { useRouter: () => ({ prefetch: href => prefetched.push(href) }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() },
    '@/lib/search-catalog-stream': { fetchSearchSuggestions: async (query, publish, signal) => {
      suggestions.push({ query, signal });
      publish([{ catalogType: 'multi', items: query === 'amazing race' ? [
        { id: 'tmdb:30957', type: 'series', name: 'The Amazing Race', communityRating: 6.9 },
        { id: 'tmdb:45665', type: 'series', name: 'The Amazing Race Australia', communityRating: 8.3 },
        { id: 'tmdb:236182', type: 'series', name: 'Amazing Race Finland', communityRating: 10, poster: '/poster.jpg' },
        { id: 'tmdb:30957', type: 'series', name: 'Duplicate' },
        { id: 'tmdb:30957', type: 'movie', name: 'Different media type with same ID' },
        { id: 'tmdb:5', type: 'movie', name: 'Fifth' },
        { id: 'tmdb:6', type: 'series', name: 'Sixth' },
        { id: 'tmdb:7', type: 'series', name: 'Seventh' },
      ] : [{ id: 'tmdb:911430', type: 'movie', name: 'F1' }] }]);
    } },
    '@/components/arc/expanding-search/expanding-search': { ExpandingSearch: 'search' },
    '@/contexts/MediaPlayerContext': { useIsPlayerVisible: () => false },
  }, { AbortController, document: { addEventListener() {}, removeEventListener() {} },
    setTimeout(fn, delay) { assert.equal(delay, 300); timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  const render = () => { const tree = h.render(SearchBar, {}); h.flush(); return tree; };
  let tree = render();
  tree.props.onValueChange(' f1 ');
  tree = render();
  assert.equal(tree.props.loading, true);
  assert.ok((tree.props.minQueryLength ?? 1) <= 2, 'The dropdown must display short-query results');
  assert.equal(suggestions.length, 0, 'Short queries retain the debounce');
  for (const [id, run] of timers) { timers.delete(id); await run(); }
  tree = render();
  assert.equal(suggestions[0].query, 'f1');
  assert.equal(tree.props.items[0].title, 'F1');
  tree.props.onValueChange('amazing race'); tree = render();
  for (const [id, run] of timers) { timers.delete(id); await run(); }
  tree = render();
  assert.deepEqual(Array.from(tree.props.items, item => item.id), [
    'series:tmdb:30957', 'series:tmdb:45665', 'series:tmdb:236182', 'series:tmdb:6',
    'movie:tmdb:30957', 'movie:tmdb:5',
  ], 'Suggestions group the top six provider matches, with the strongest group first and provider rank preserved within each group');
  assert.equal(warmups.length, 0, 'Publishing six suggestions never prefetches six routes');
  tree.props.onItemIntent(tree.props.items[1]);
  assert.equal(warmups[0].href, '/series/tmdb:45665');
  tree.props.onItemIntent(tree.props.items[0]);
  assert.equal(warmups[0].cancelled, true, 'Moving selection cancels the old suggestion dwell');
  warmups[1].warm(); assert.deepEqual(prefetched, ['/series/tmdb:30957']);
  tree.props.onItemIntent(null); assert.equal(warmups[1].cancelled, true);
  tree.props.onValueChange('   ');
  tree = render();
  assert.equal(tree.props.loading, false);
  assert.equal(tree.props.items.length, 0);
  assert.equal(timers.size, 0, 'Blank input must not schedule a search');
  assert.equal(suggestions[0].signal.aborted, true);
  h.unmount();
  console.log('PASS: public TMDB suggestions, native result ordering, one-request lookup, cancellation, token errors, split UTF-8 chunks and reader cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
