const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');

function harness(count = 100) {
  const h = hooks(), requests = [];
  const rowHeight = 360, viewportHeight = 720, prefix = 300;
  const root = { scrollTop: 0, getBoundingClientRect: () => ({ top: 0, height: viewportHeight }) };
  const targets = Array.from({ length: count }, (_, index) => ({
    dataset: { homeCatalogRow: String(index) },
    getBoundingClientRect: () => ({ top: prefix + index * rowHeight - root.scrollTop, height: rowHeight }),
  }));
  const list = { closest: () => root, children: targets };
  let observe, options, tree, rendered = -1, started = false;
  const publish = () => observe(targets.map(target => {
    const { top, height } = target.getBoundingClientRect();
    return { target, isIntersecting: top + height > -720 && top < viewportHeight + 720 };
  }));
  const { HomeCatalogSectionsLazy } = load('components/home-catalog-sections-lazy.tsx', {
    react: h.react, 'react/jsx-runtime': h.jsx,
    '@/components/media-section': { MediaSection: 'MediaSection' },
    './home-catalog-skeleton.module.css': { placeholder: 'placeholder' },
    '@/components/ui/loading-placeholder': { LoadingPlaceholder: 'LoadingPlaceholder' },
    '@/components/ui/skeleton': { Skeleton: 'Skeleton' }, '@/components/ui/button': { Button: 'button' },
  }, {
    AbortController, AbortSignal, TextDecoder, console: { error() {} },
    IntersectionObserver: class {
      constructor(callback, config) { observe = callback; options = config; }
      observe() {}
      disconnect() {}
    },
    fetch: (url, init) => new Promise(resolve => requests.push({ url, init, entries: JSON.parse(init.body).entries, resolve })),
  });
  const entries = Array.from({ length: count }, (_, i) => ({ key: String(i), sectionName: `Catalog ${i}`, catalogType: 'movie', catalogId: String(i), addonTransportUrl: 'https://addon.test/manifest.json' }));
  const props = { initialSections: [], remainingEntries: entries, batchSize: 2 };
  const nodes = (node, predicate) => !node || typeof node !== 'object' ? [] : Array.isArray(node)
    ? node.flatMap(child => nodes(child, predicate))
    : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
  function render() {
    tree = h.render(HomeCatalogSectionsLazy, props);
    tree.props.ref.current = list;
    rendered = h.updates; h.flush();
  }
  return {
    requests, h,
    async settle() { for (let i = 0; i < 45; i++) { if (rendered !== h.updates) { render(); if (!started) { started = true; publish(); } } await Promise.resolve(); } },
    jump(index, notify = true) { root.scrollTop = prefix + index * rowHeight; if (notify) publish(); },
    publish,
    answer(index, status = 200, sections = []) { requests[index].resolve(Response.json({ sections }, { status })); },
    stream(index) {
      let controller, cancelled = false;
      const body = new ReadableStream({ start(value) { controller = value; }, cancel() { cancelled = true; } });
      requests[index].resolve(new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }));
      return { row(key, section) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ key, result: { status: 'ready', section } }) + '\n')); },
        fail() { controller.error(Error('stream interrupted')); }, get cancelled() { return cancelled; } };
    },
    retry() { nodes(tree, node => node.type === 'button')[0].props.onClick(); },
    focusRow(index) { nodes(tree, node => node.props?.['data-home-catalog-row'] === String(index))[0].props.onFocusCapture(); },
    blurRow(index) { nodes(tree, node => node.props?.['data-home-catalog-row'] === String(index))[0].props.onBlurCapture({ currentTarget: { contains: () => false }, relatedTarget: null }); },
    rowStyle(index) { return nodes(tree, node => node.props?.['data-home-catalog-row'] === String(index))[0].props.style; },
    get rowIndexes() { return nodes(tree, node => node.props?.['data-home-catalog-row'] !== undefined).map(node => Number(node.props['data-home-catalog-row'])); },
    get rowCount() { return nodes(tree, node => node.props?.['data-home-catalog-row'] !== undefined).length; },
    get height() { return this.rowIndexes.reduce((height, index) => height + this.rowStyle(index).minHeight, 0); },
    hasPlaceholder(index) { return nodes(tree, node => node.props?.['data-home-catalog-row'] === String(index))[0].props.children.type.name === 'HomeCatalogSkeleton'; },
    get buttons() { return nodes(tree, node => node.type === 'button'); },
    get sections() { return nodes(tree, node => node.type === 'MediaSection').map(node => node.props.sectionName); },
    get options() { return options; },
  };
}

(async () => {
  const page = harness(); await page.settle();
  assert.equal(page.height, 36000, 'All known catalog positions exist before their data loads');
  assert.equal(page.rowStyle(0).minHeight, 360, 'The first catalog reserves its place below Continue Watching');
  assert.equal(page.rowStyle(1).top, undefined, 'Catalog rows use normal document flow');
  assert.equal(page.rowCount, 100, 'All catalog slots stay in the DOM');
  assert.equal(page.requests.length, 1);
  assert.equal(page.buttons.length, 0, 'There is no Load more button');
  assert.ok(page.options.root, 'The visibility observer uses the actual page scroller');
  const height = page.height;
  page.answer(0, 200, [{ key: '0', sectionName: 'Loaded catalog', mediaItems: [{ id: 'tt123', name: 'Movie', type: 'movie' }] }]); await page.settle();
  assert.ok(page.sections.includes('Loaded catalog'), 'A loaded skeleton becomes the requested catalog');
  assert.equal(page.requests.length, 2, 'Keep filling nearby rows without requiring another gesture');
  page.answer(1); await page.settle();
  assert.equal(page.requests.length, 2, 'Stop when viewport and overscan are loaded, even for empty catalogs');
  assert.equal(page.height, height, 'Empty results do not collapse placeholders or drag the page downward');

  page.focusRow(0); await page.settle();
  page.jump(35, false);
  assert.ok(page.hasPlaceholder(35) && page.hasPlaceholder(36), 'A long jump has placeholders even before the observer reports it');
  page.publish(); await page.settle();
  assert.ok(page.sections.includes('Loaded catalog'), 'Keep an offscreen row mounted while it contains focus');
  page.blurRow(0); await page.settle();
  assert.ok(page.hasPlaceholder(0), 'Removing focus releases the heavy content without collapsing its slot');
  assert.equal(page.requests.length, 3);
  assert.deepEqual(page.requests[2].entries.map(entry => entry.key), ['35', '36'], 'A flick prioritizes its landing viewport');
  for (let i = 2; i < 5; i++) { page.answer(i); await page.settle(); }
  assert.equal(page.requests.length, 5, 'Load only the landing viewport and its nearby rows');
  const landingKeys = page.requests.slice(2).flatMap(request => request.entries.map(entry => Number(entry.key)));
  assert.ok(landingKeys.every(key => key >= 33 && key <= 38), 'Do not fetch all skipped catalogs between the top and the landing row');
  page.jump(0); await page.settle();
  assert.equal(page.requests.length, 5, 'Scrolling back reuses already loaded rows');
  assert.ok(page.sections.includes('Loaded catalog'), 'Previously loaded content survives virtual row unmounts');
  page.jump(98); await page.settle();
  while (page.requests.at(-1).entries.some(entry => Number(entry.key) >= 96) && page.requests.length < 8) {
    const before = page.requests.length; page.answer(before - 1); await page.settle();
    if (page.requests.length === before) break;
  }
  const exhausted = page.requests.length;
  await page.settle(); assert.equal(page.requests.length, exhausted, 'The actual end of the known catalog list stops loading');
  page.h.unmount();

  const flick = harness(); await flick.settle();
  flick.jump(70); await flick.settle();
  assert.equal(flick.requests[0].init.signal.aborted, true, 'Fast scrolling cancels obsolete work');
  assert.deepEqual(flick.requests[1].entries.map(entry => entry.key), ['70', '71']);
  const beforeStale = flick.h.updates;
  flick.answer(0); await flick.settle();
  assert.equal(flick.h.updates, beforeStale, 'An obsolete response cannot alter the landing viewport');
  flick.h.unmount();
  assert.equal(flick.requests[1].init.signal.aborted, true, 'Leaving the page cancels pending data');

  const failed = harness(2); await failed.settle();
  failed.answer(0, 500); await failed.settle();
  assert.equal(failed.requests.length, 1, 'Errors do not retry in a loop');
  assert.equal(failed.buttons[0].props.children, 'Try again', 'Only failed catalogs expose a retry button');
  failed.retry(); failed.retry(); await failed.settle();
  assert.equal(failed.requests.length, 2, 'Rapid Retry clicks cannot overlap');
  assert.equal(failed.requests[1].entries[0].key, '0');
  failed.answer(1); await failed.settle(); failed.h.unmount();

  const progressive = harness(2); await progressive.settle();
  const chunks = progressive.stream(0);
  chunks.row('0', { key: '0', sectionName: 'First ready', mediaItems: [] }); await progressive.settle();
  assert.ok(progressive.sections.includes('First ready'), 'Publish a ready lazy row before its batch completes');
  chunks.fail(); await progressive.settle();
  assert.ok(progressive.sections.includes('First ready'), 'Later stream errors preserve ready rows');
  assert.equal(progressive.buttons.length, 1, 'Only the unfinished row becomes an error');
  progressive.retry(); await progressive.settle();
  assert.deepEqual(progressive.requests[1].entries.map(entry => entry.key), ['1']);
  progressive.h.unmount();

  const streamedFlick = harness(); await streamedFlick.settle();
  const held = streamedFlick.stream(0);
  held.row('0', { key: '0', sectionName: 'Retained row', mediaItems: [] }); await streamedFlick.settle();
  streamedFlick.jump(70); await streamedFlick.settle();
  assert.equal(streamedFlick.requests[0].init.signal.aborted, true);
  assert.equal(held.cancelled, true, 'Flick cancellation reaches the streaming reader');
  assert.deepEqual(streamedFlick.requests[1].entries.map(entry => entry.key), ['70', '71']);
  streamedFlick.jump(0); await streamedFlick.settle();
  assert.ok(streamedFlick.sections.includes('Retained row'), 'Returning to a streamed ready row reuses it');
  streamedFlick.h.unmount();

  // The client cancellation must reach the add-on fetch, not just stop rendering.
  let providerSignal;
  const { POST } = load('app/api/home/catalogs/route.ts', {
    '@/lib/server/auth': { getAuthData: async () => ({ authKey: 'fixture-only' }) },
    '@/lib/server/outbound-fetch': { outboundFetch: 'fixture-fetch' },
    'next/server': { NextResponse: { json: Response.json } },
    '@/app/actions/media': { fetchCatalogItems: async (_type, _id, _url, signal) => { providerSignal = signal; signal.throwIfAborted(); return []; } },
  }, { Response });
  const controller = new AbortController(); controller.abort();
  const response = await POST(new Request('https://navigator.test/api/home/catalogs', { method: 'POST', signal: controller.signal,
    body: JSON.stringify({ entries: [{ key: 'test', sectionName: 'Test', catalogType: 'movie', catalogId: 'test', addonTransportUrl: 'https://addon.test/manifest.json' }] }) }));
  assert.equal(providerSignal, undefined, 'Already aborted batches never start provider work');
  assert.equal(response.status, 499);

  // Check server output before a browser has started observing the rows.
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { HomeCatalogSectionsLazy } = load('components/home-catalog-sections-lazy.tsx', {
    '@/components/media-section': { MediaSection: ({ sectionName }) => React.createElement('section', null, sectionName) },
    './home-catalog-skeleton.module.css': { placeholder: 'placeholder' },
    '@/components/ui/loading-placeholder': { LoadingPlaceholder: ({ children }) => React.createElement('div', null, children) },
    '@/components/ui/skeleton': { Skeleton: () => React.createElement('span', null) },
    '@/components/ui/button': { Button: 'button' },
  });
  const html = renderToStaticMarkup(React.createElement(HomeCatalogSectionsLazy, {
    initialSections: [{ key: 'initial', sectionName: 'Initial catalog', mediaItems: [] }],
    remainingEntries: Array.from({ length: 50 }, (_, i) => ({ key: String(i), sectionName: String(i) })), batchSize: 2,
  }));
  assert.ok(html.includes('Initial catalog'), 'Server-rendered initial catalogs stay visible');
  assert.equal((html.match(/data-home-catalog-row=/g) || []).length, 51, 'SSR emits one slot per known catalog');
  assert.equal((html.match(/data-home-catalog-placeholder=/g) || []).length, 50, 'All unready rows have a placeholder before hydration');
  console.log('PASS: persistent in-flow catalog slots, stable skeleton space, continuous flick loading, destination priority, bounded requests, no Load more button, retry, and cancellation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
