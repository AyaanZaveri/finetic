const assert = require('node:assert/strict');
const React = require('react');
const { PassThrough } = require('node:stream');
const { once } = require('node:events');
const { renderToPipeableStream } = require('react-dom/server');
const { load } = require('./test-support/react-hooks.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const section = key => ({ key, sectionName: `Catalog ${key}`, mediaItems: [{ id: key, name: 'Title', type: 'movie' }] });
(async () => {
    const slow = deferred(), fast = deferred();
    const { HomeCatalogSectionsLazy } = load('components/home-catalog-sections-lazy.tsx', {
        'next/navigation': { useRouter: () => ({ refresh() {} }) },
        '@/components/home-palette-provider': { HomeInitialPalette: () => null },
        '@/components/media-section': { MediaSection: ({ sectionName }) => React.createElement('section', null, sectionName) },
        '@/components/ui/button': { Button: 'button' },
    });
    const output = new PassThrough(); let html = '';
    output.on('data', chunk => { html += chunk; });
    const completed = once(output, 'end');
    const view = renderToPipeableStream(React.createElement(HomeCatalogSectionsLazy, {
        initialSections: [], remainingEntries: [], batchSize: 2,
        initialRows: [
            { key: 'slow', sectionName: 'Slow', result: slow.promise },
            { key: 'fast', sectionName: 'Fast', result: fast.promise },
            { key: 'error', sectionName: 'Failed provider', result: Promise.resolve({ status: 'error' }) },
        ],
    }), { onShellReady() { view.pipe(output); }, onError(error) { throw error; } });
    await tick();
    assert.ok(html.includes('data-home-initial-pending'), 'Each unresolved initial row has its own Suspense fallback');
    assert.match(html, /aria-hidden="true"[^>]+min-height:360px/);
    assert.match(html, /aspect-\[2\/3\] w-full rounded-md bg-accent/);
    assert.doesNotMatch(html, /animate-pulse/);
    fast.resolve({ status: 'ready', section: section('fast') }); await tick(); await tick();
    assert.ok(html.includes('Catalog fast'), 'A healthy row reaches the stream while another provider is still pending');
    assert.ok(!html.includes('Catalog slow'));
    assert.ok(html.includes('Could not load this catalog.'), 'A failed feed stays local to its own row');
    slow.resolve({ status: 'ready', section: section('slow') }); await completed;
    assert.ok(html.includes('Catalog slow'));

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
