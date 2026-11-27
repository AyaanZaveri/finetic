const assert = require('node:assert/strict');
const React = require('react');
const { PassThrough } = require('node:stream');
const { once } = require('node:events');
const { renderToPipeableStream, renderToStaticMarkup } = require('react-dom/server');
const { load } = require('./test-support/react-hooks.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const section = key => ({ key, sectionName: `Catalog ${key}`, mediaItems: [{ id: key, name: 'Title', type: 'movie' }] });
(async () => {
    const addons = deferred(), slow = deferred(), fast = deferred(), failed = deferred();
    const catalogWork = new Map([
        ['slow', slow.promise],
        ['fast', fast.promise],
        ['error', failed.promise],
    ]);
    const { INITIAL_CATALOG_COUNT } = load('lib/home-catalogs.ts');
    const loadingClass = 'fixture-delayed-placeholder';
    const delayedPlaceholder = ({ children }) => React.createElement('div', { className: loadingClass }, children);
    const viewDependencies = {
        '@/components/home-palette-provider': { HomeInitialPalette: () => null },
        '@/components/media-section': { MediaSection: ({ sectionName }) => React.createElement('section', null, sectionName) },
        '@/components/ui/button': { Button: 'button' },
        '@/components/ui/loading-placeholder': { LoadingPlaceholder: delayedPlaceholder },
        './home-catalog-skeleton.module.css': { placeholder: 'placeholder' },
        './media-card.module.css': { card: 'card', skeletonCard: 'skeletonCard', surface: 'surface', frame: 'frame' },
        './media-section.module.css': { viewport: 'viewport', track: 'track', skeletonHeading: 'skeletonHeading', skeletonHeadingText: 'skeletonHeadingText' },
    };
    const { HomeCatalogSectionsLazy } = load('components/home-catalog-sections-lazy.tsx', viewDependencies);
    const { default: Home } = load('app/(main)/page.tsx', {
        ...viewDependencies,
        '@/app/actions/auth': { getUser: async () => ({ _id: 'fixture' }), getInstalledAddons: () => addons.promise },
        '@/app/actions/media': { fetchCatalogItems: (_type, id) => catalogWork.get(id) },
        '@/lib/discovery': { hasTMDBDiscovery: async () => false, cinemetaHomeRows: () => { throw new Error('Expected installed add-on catalogs'); } },
        '@/lib/tmdb-discovery': { getTMDBHomeRows: () => { throw new Error('Expected installed add-on catalogs'); } },
        '@/app/components/auth-error-handler': { AuthErrorHandler: React.Fragment },
        '@/components/home-catalog-sections-lazy': { HomeCatalogSectionsLazy },
        '@/components/home-continue-watching': { ContinueWatchingSection: () => React.createElement('section', null, 'Continue Watching') },
        '@/components/home-hero': { HomeFeatured: () => null, HomeHeroSkeleton: () => null },
        '@/lib/server/home-hero': { loadHomeHeroItems: async () => [] },
        '@/lib/server/metadata-provider': { getMetadataProvider: async () => 'auto' },
        './home-page.module.css': { page: 'page', rows: 'rows' },
        '@/components/ui/loading-placeholder': { LoadingPlaceholder: delayedPlaceholder },
    });
    const output = new PassThrough(); let html = '';
    output.on('data', chunk => { html += chunk; });
    const completed = once(output, 'end');
    const view = renderToPipeableStream(await Home(), {
        onShellReady() { view.pipe(output); },
        onError(error) { throw error; },
    });
    await tick();
    const bootstrap = html;
    assert.ok(bootstrap.includes('Continue Watching'));
    assert.ok(!bootstrap.includes('data-home-catalogs'));
    const placeholderSlots = markup => (markup.match(/aria-hidden="true"[^>]+min-height:360px/g) ?? []).length;
    const assertVisiblePlaceholders = markup => {
        assert.ok(!markup.includes(loadingClass), 'Catalog handoffs cannot restart the hidden placeholder delay');
        assert.match(markup, /data-home-catalog-placeholder=""/);
        assert.doesNotMatch(markup, /animate-pulse/);
    };
    assertVisiblePlaceholders(bootstrap);
    assert.equal(placeholderSlots(bootstrap), INITIAL_CATALOG_COUNT);

    addons.resolve([{ transportUrl: 'https://addon.test/manifest.json', manifest: {
        catalogs: ['slow', 'fast', 'error'].map(id => ({ id, type: 'movie', name: `Catalog ${id}` })),
    } }]);
    await tick(); await tick();
    const streamed = html.slice(bootstrap.length);
    assert.ok(streamed.includes('data-home-catalogs'));
    assertVisiblePlaceholders(streamed);
    assert.equal(placeholderSlots(streamed), catalogWork.size, 'Each pending row keeps a visible placeholder at the same height');
    fast.resolve(section('fast').mediaItems);
    failed.reject(new Error('offline'));
    await tick(); await tick();
    assert.ok(html.includes('Catalog Fast'), 'A healthy row reaches the stream while another provider is still pending');
    assert.ok(!html.includes('Catalog Slow'));
    assert.ok(html.includes('Couldn’t load this catalog'), 'A failed feed stays local to its own row');
    slow.resolve(section('slow').mediaItems); await completed;
    assert.ok(html.includes('Catalog Slow'));
    const saved = section('tmdb-saved');
    const { HomeCatalogsPending } = load('components/home-catalog-placeholder.tsx', {
        ...viewDependencies,
        '@/components/home-snapshot-provider': { useHomeSnapshot: () => ({ catalogs: [{ data: saved }] }) },
    });
    const cached = renderToStaticMarkup(React.createElement(HomeCatalogsPending));
    assert.match(cached, /Catalog tmdb-saved/, 'The live manifest fallback displays the saved Home rows');
    assert.equal(placeholderSlots(cached), 0, 'Cached rows replace the bootstrap skeletons');

    const pending = new Map(), signals = [];
    const { POST } = load('app/api/home/catalogs/route.ts', {
        '@/lib/server/auth': { getAuthData: async () => ({ authKey: 'fixture' }) },
        'next/server': { NextResponse: { json: Response.json } },
        '@/app/actions/media': { fetchCatalogItems: async (_type, id, _url, signal) => {
            const work = deferred(); pending.set(id, work); signals.push(signal);
            signal.addEventListener('abort', () => work.reject(signal.reason), { once: true });
            return work.promise;
        } },
    }, { Request, Response, ReadableStream, TextEncoder });
    const entries = ['slow', 'fast', 'error'].map(key => ({ key, sectionName: key, catalogType: 'movie', catalogId: key, addonTransportUrl: 'https://addon.test/manifest.json' }));
    const response = await POST(new Request('https://app.test/api/home/catalogs', { method: 'POST',
        headers: { Accept: 'application/x-ndjson' }, body: JSON.stringify({ entries }) }));
    assert.match(response.headers.get('Content-Type'), /ndjson/);
    const reader = response.body.getReader(), first = reader.read();
    pending.get('fast').resolve(section('fast').mediaItems);
    assert.equal(JSON.parse(new TextDecoder().decode((await first).value)).key, 'fast', 'Lazy API does not wait for the slowest row');
    pending.get('error').reject(Error('offline'));
    const error = JSON.parse(new TextDecoder().decode((await reader.read()).value));
    assert.equal(error.result.status, 'error');
    await reader.cancel(); assert.ok(signals.every(signal => signal.aborted), 'Reader cancellation aborts unneeded provider requests');

    const { readHomeCatalogRows } = load('lib/home-catalog-stream.ts', {}, { TextDecoder });
    const text = JSON.stringify({ key: 'utf8', result: { status: 'ready', section: { ...section('utf8'), sectionName: 'Café 🎬' } } }) + '\n';
    const bytes = new TextEncoder().encode(text), rows = [];
    await readHomeCatalogRows(new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } })), row => rows.push(row), new AbortController().signal);
    assert.equal(rows[0].result.section.sectionName, 'Café 🎬', 'Incremental decoder preserves split UTF-8');
    const partial = [];
    await assert.rejects(readHomeCatalogRows(new Response(text + 'invalid\n'), row => partial.push(row), new AbortController().signal));
    assert.equal(partial.length, 1, 'Already-delivered rows survive a later malformed/truncated response');
    const retryCalls = [];
    const { retryInitialHomeCatalog } = load('lib/home-catalog-stream.ts', {}, { URLSearchParams,
        fetch: async (url, options) => { retryCalls.push({ url, options }); return Response.json({ sections: [section('retry')] }); },
    });
    const retried = await retryInitialHomeCatalog({ key: 'retry', retry: { catalog: { key: 'retry' } } }, new AbortController().signal);
    assert.equal(retried.status, 'ready');
    assert.equal(JSON.parse(retryCalls[0].options.body).entries.length, 1, 'Initial-row retry never refreshes healthy peers');
    console.log('PASS: real React per-row Suspense streaming, stable slots, isolated errors, progressive lazy rows, upstream abort and split UTF-8');
})().catch(error => { console.error(error); process.exitCode = 1; });
