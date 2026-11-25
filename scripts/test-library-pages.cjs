const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const pure = load('lib/library-page.ts', {}, { URLSearchParams });
const { INITIAL_LIBRARY_QUERY: initial, selectLibraryPage } = pure;
const items = Array.from({ length: 120 }, (_, i) => ({ id: `tt${i}`, type: 'movie', name: `Title ${String(i).padStart(3, '0')}`, releaseInfo: String(2000 + i), description: 'Large synopsis' }));
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  assert.equal(selectLibraryPage(items, initial).items.length, 48);
  assert.equal(selectLibraryPage(items, { ...initial, search: 'Title 119' }).items[0].id, 'tt119', 'Search covers items outside the initial page');
  assert.equal(selectLibraryPage(items, { ...initial, sort: 'year', order: 'desc' }).items[0].id, 'tt119');
  const random = { ...initial, sort: 'random', seed: 123 };
  const randomized = [1, 2, 3].flatMap(page => selectLibraryPage(items, { ...random, page }).items.map(item => item.id));
  assert.equal(new Set(randomized).size, 120, 'Seeded pages form a complete permutation without repeats');
  assert.deepEqual(selectLibraryPage(items, random), selectLibraryPage(items, random));
  assert.notDeepEqual(selectLibraryPage(items, random), selectLibraryPage(items, { ...random, seed: 124 }));
  assert.equal(selectLibraryPage(items, { ...initial, page: 999 }).page, 3);
  assert.equal(pure.parseLibraryQuery(new URLSearchParams('page=-1&sort=invalid')).page, 1);

  let account = 'A', calls = 0, clock = 0, installed = true;
  const core = load('lib/server/library-page.ts', {
    'server-only': {},
    '@/app/actions/auth': { getAuthData: async () => ({ authKey: account }), getInstalledAddons: async () => installed ? [{ transportUrl: 'addon', manifest: { catalogs: [{ id: 'top' }] } }] : [] }, "@/lib/server/auth": { getAuthData: async () => ({ authKey: account }) },
    '@/app/actions/media': { fetchLibraryItems: async () => { calls++; await tick(); return { items: account === 'empty' ? [] : items, totalRecordCount: items.length }; } },
    '@/lib/library-page': pure,
  }, { Date: { now: () => clock } });
  const pages = await Promise.all([core.loadLibraryPage('addon', initial), core.loadLibraryPage('addon', { ...initial, page: 2 })]);
  assert.equal(calls, 1, 'Concurrent page reads share one snapshot');
  assert.equal(pages[0].items.length, 48);
  assert.equal(pages[0].items[0].description, undefined, 'Pages contain only card metadata');
  assert.equal(pages[0].totalLibraryCount, 120);
  await core.loadLibraryPage('addon', { ...initial, search: 'Title 119' });
  assert.equal(calls, 1, 'Paging/searching reuse the short-lived catalog read');
  account = 'B'; await core.loadLibraryPage('addon', initial);
  assert.equal(calls, 2, 'Accounts cannot share private catalog snapshots');
  clock = 31_000; await core.loadLibraryPage('addon', initial);
  assert.equal(calls, 3, 'Expired catalogs refresh');
  account = 'empty';
  const beforeEmpty = calls;
  assert.equal((await core.loadLibraryPage('addon', initial)).items.length, 0);
  await core.loadLibraryPage('addon', { ...initial, search: 'anything' });
  assert.equal(calls, beforeEmpty + 1, 'Successful empty catalogs are cached too, avoiding repeated server work');
  installed = false;
  await assert.rejects(core.loadLibraryPage('addon', initial), core.LibraryNotFound);
  assert.equal(calls, beforeEmpty + 1, 'Membership is checked even with a cached snapshot');

  let active = 0, peak = 0;
  const jobs = new Map();
  const addon = { transportUrl: 'https://addon.test', manifest: { catalogs: Array.from({ length: 6 }, (_, i) => ({ id: String(i), type: 'movie' })) } };
  const actions = load('app/actions/media.ts', {
    'server-only': {},
    '@/lib/server/metadata-cache': {}, '@/lib/server/metadata-identity': {}, '@/lib/server/catalog-cache': {}, '@/lib/server/media-artwork': { resolveArtworkList: async items => items },
    '@/lib/server/auth': { getAuthData: async () => ({ authKey: 'fixture-only' }) },
    '@/lib/server/outbound-fetch': { outboundFetch: 'fixture-fetch' },
    '@/lib/media/playback-details': load('lib/media/playback-details.ts'),
    './auth': { getInstalledAddons: async () => [addon] }, './tv-shows': {}, '@/lib/artwork': { mediaArtwork: () => ({}), publicArtworkUrl: () => undefined }, '@/lib/tmdb-artwork': {}, '@/lib/media-description': {}, '@/lib/stremio-watched': {},
  }, { AbortController, AbortSignal, fetch: url => new Promise(resolve => {
    active++; peak = Math.max(peak, active);
    jobs.set(url, () => { active--; resolve({ ok: true, json: async () => ({ metas: [{ id: url, type: 'movie', name: url }] }) }); });
  }) });
  const all = actions.fetchLibraryItems('https://addon.test', 100);
  await tick(); assert.equal(jobs.size, 4);
  jobs.get('https://addon.test/catalog/movie/3.json')(); await tick();
  jobs.get('https://addon.test/catalog/movie/4.json')(); await tick();
  for (const id of [0, 1, 2, 5]) jobs.get(`https://addon.test/catalog/movie/${id}.json`)();
  const catalog = await all;
  assert.equal(peak, 4);
  assert.equal(jobs.size, 6, 'Each catalog is fetched once');
  assert.deepEqual(Array.from(catalog.items, item => item.id), Array.from({ length: 6 }, (_, i) => `https://addon.test/catalog/movie/${i}.json`), 'Completion order cannot reorder providers');

  const h = hooks(), timers = new Map(), requests = [], pendingClient = [];
  let hold = false;
  let timerId = 0;
  const dependencies = new Proxy({
    react: { ...require('react'), ...h.react }, 'react/jsx-runtime': h.jsx, '@/lib/library-page': pure,
  }, { has: () => true, get: (object, key) => key in object ? object[key] : new Proxy({}, { get: (_, name) => name }) });
  const { LibraryMediaList } = load('components/library-media-list.tsx', dependencies, {
    URLSearchParams, AbortController, setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id),
    fetch: (url, options) => {
      requests.push({ url, signal: options.signal });
      const response = { ok: true, json: async () => selectLibraryPage(items, pure.parseLibraryQuery(new URL(url, 'http://app').searchParams)) };
      return hold ? new Promise(resolve => pendingClient.push(() => resolve(response))) : Promise.resolve(response);
    },
  });
  const firstPage = selectLibraryPage(items, initial);
  const render = () => { const tree = h.render(LibraryMediaList, { initialPage: firstPage, addonUrl: 'addon' }); h.flush(); return tree; };
  const find = (node, predicate) => !node || typeof node !== 'object' ? [] : [...(predicate(node) ? [node] : []), ...[].concat(node.props?.children ?? []).flatMap(child => find(child, predicate))];
  let tree = render();
  assert.equal(timers.size, 0, 'SSR initial page cannot be fetched a second time during hydration');
  assert.equal(find(tree, node => node.type === 'MediaCard').length, 48);
  find(tree, node => node.type === 'Button' && node.props.children === 'Next')[0].props.onClick();
  render();
  const runTimer = async () => { const work = [...timers.values()]; timers.clear(); await Promise.all(work.map(run => run())); };
  await runTimer(); tree = render();
  assert.ok(requests[0].url.includes('page=2'));
  assert.equal(find(tree, node => node.type === 'MediaCard')[0].props.item.id, 'tt48');
  find(tree, node => node.type === 'Input')[0].props.onChange({ target: { value: 'Title 119' } });
  render(); await runTimer(); tree = render();
  assert.equal(find(tree, node => node.type === 'MediaCard').length, 1);
  assert.equal(find(tree, node => node.type === 'MediaCard')[0].props.item.id, 'tt119');
  hold = true;
  find(tree, node => node.type === 'Input')[0].props.onChange({ target: { value: 'Title 118' } });
  render();
  let work = [...timers.values()]; timers.clear(); const oldRead = work[0](); await tick();
  find(tree, node => node.type === 'Input')[0].props.onChange({ target: { value: 'Title 117' } });
  render();
  assert.equal(requests.at(-1).signal.aborted, true, 'Replacing a query aborts its request');
  work = [...timers.values()]; timers.clear(); const newRead = work[0](); await tick();
  pendingClient[1](); await newRead; tree = render();
  pendingClient[0](); await oldRead; tree = render();
  assert.equal(find(tree, node => node.type === 'MediaCard')[0].props.item.id, 'tt117', 'Late old queries cannot overwrite the latest library page');
  h.unmount();
  console.log('PASS: bounded server pages, global search/sort, stable random paging, one account-scoped catalog snapshot, expiry, authorization, concurrent catalogs, no hydration refetch, and paged client rendering.');
})().catch(error => { console.error(error); process.exitCode = 1; });
