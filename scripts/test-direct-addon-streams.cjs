const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');
const globals = { URL, URLSearchParams, Response, Date };
const addon = { id: 'fixture', name: 'Provider', transportUrl: 'https://addon.example/config/manifest.json?token=fixture' };
const signal = new AbortController().signal;
const fresh = () => load('lib/media/fetch-addon-streams.ts', {}, globals).fetchAddonStreams;
const streams = () => Response.json({ streams: [{ url: 'https://video.example/movie.mkv' }, { infoHash: 'fixture' }, { url: 123 }] });

(async () => {
    let calls = [];
    const fetchDirect = fresh();
    const result = await fetchDirect(addon, 'tt123:1:2', 'series', signal, async (url, init) => {
        calls.push(url);
        const parsed = new URL(url);
        assert.equal(parsed.pathname, '/config/stream/series/tt123%3A1%3A2.json');
        assert.equal(parsed.searchParams.get('token'), 'fixture');
        assert.equal(init.credentials, 'omit'); assert.equal(init.mode, 'cors');
        assert.equal(init.referrerPolicy, 'no-referrer'); assert.equal(init.headers, undefined);
        assert.equal(init.cache, 'default', 'Use normal provider-controlled HTTP caching');
        return streams();
    });
    assert.equal(calls.length, 1); assert.equal(result.length, 2);
    assert.equal(result[0].name, 'Provider'); assert.equal(result[1].infoHash, 'fixture');

    for (const failure of ['network', 'timeout', 401, 403, 405]) {
        calls = [];
        await assert.rejects(fresh()(addon, 'tt123', 'movie', signal, async url => {
            calls.push(url);
            if (failure === 'network' || failure === 'timeout') throw new TypeError(failure);
            return new Response(null, { status: failure });
        }), failure === 'network' || failure === 'timeout' ? /browser could not connect/i : /rejected|Could not load streams/i);
        assert.equal(calls.length, 1, `${failure} must not cause a second provider request`);
    }
    calls = [];
    await fresh()({ id: addon.id, name: addon.name }, 'tt123', 'movie', signal, async (url, init) => {
        calls.push(url);
        assert.ok(url.startsWith('/api/streams/addon?'));
        assert.equal(init.credentials, 'same-origin');
        assert.equal(init.cache, 'no-store');
        return streams();
    });
    assert.equal(calls.length, 1, 'Legacy targets without a direct URL use the backend');
    for (const status of [404, 429, 500, 503]) {
        calls = [];
        await assert.rejects(fresh()(addon, 'tt123', 'movie', signal, async url => {
            calls.push(url); return new Response(null, { status });
        }), status === 429 ? /rate limited/ : /Could not load streams/);
        assert.equal(calls.length, 1, `${status} cannot trigger a second provider request`);
    }
    const abort = new AbortController();
    calls = [];
    await assert.rejects(fresh()(addon, 'tt123', 'movie', abort.signal, async url => {
        calls.push(url); abort.abort(); throw abort.signal.reason;
    }));
    assert.equal(calls.length, 1, 'Consumer cancellation does not fall back');
    await assert.rejects(fresh()(addon, 'tt123', 'movie', abort.signal, async () => assert.fail('Already aborted')));
    calls = [];
    await fresh()(addon, 'tt123', 'movie', signal, async url => { calls.push(url); return Response.json({ streams: [] }); });
    assert.equal(calls.length, 1, 'An empty result is successful');
    calls = [];
    await assert.rejects(fresh()(addon, 'tt123', 'movie', signal, async url => { calls.push(url); return Response.json({ invalid: [] }); }));
    assert.equal(calls.length, 1, 'Invalid provider data does not cause another request');

    // Exercise Retry-After across different titles, both direct and fallback.
    for (const backend of [false, true]) {
        let now = Date.now(), hits = 0;
        const api = load('lib/media/fetch-addon-streams.ts', {}, { ...globals, Date: class extends Date { static now() { return now; } } });
        const limited = async url => {
            hits++;
            if (backend) assert.ok(url.startsWith('/api/'));
            else assert.ok(url.startsWith('https://addon.example/'));
            return new Response(null, { status: 429, headers: { 'Retry-After': '120' } });
        };
        const target = backend ? { id: addon.id, name: addon.name } : addon;
        await assert.rejects(api.fetchAddonStreams(target, 'tt123', 'movie', signal, limited), /rate limited/);
        const before = hits;
        now += 90_000;
        await assert.rejects(api.fetchAddonStreams(target, 'tt456', 'movie', signal, limited), /rate limited/);
        assert.equal(hits, before, 'Respect the provider cooldown across titles');
        now += 31_000;
        await api.fetchAddonStreams(target, 'tt456', 'movie', signal, async () => streams());
    }

    const dependencies = {
        'next/server': { NextResponse: Response },
        '@/app/actions/auth': { getInstalledAddons: async () => [{ ...addon, manifest: { id: addon.id, name: addon.name, resources: ['stream'] } }] },
        '@/lib/server/outbound-fetch': { outboundFetch: async () => new Response(null, { status: 429, headers: { 'Retry-After': '120' } }) },
    };
    const listing = load('app/api/streams/addons/route.ts', dependencies, globals);
    const targetsResponse = await listing.GET(new Request('https://app.example/api/streams/addons'));
    const targets = await targetsResponse.json();
    assert.equal(targets.addons[0].transportUrl, addon.transportUrl);
    assert.match(targetsResponse.headers.get('Cache-Control'), /private.*no-store/);
    const route = load('app/api/streams/addon/route.ts', dependencies, globals);
    const limited = await route.GET(new Request('https://app.example/api/streams/addon?mediaItemId=tt123&addonId=fixture'));
    assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '120');

    // Both client entry points must preserve the rate-limit reason and honor
    // the same cooldown on a different title rather than starting another request.
    for (const shared of [false, true]) {
        let providerHits = 0;
        const browserFetch = async url => {
            if (url.startsWith('/api/streams/addons?')) return Response.json({ revision: 'fixture', addons: [addon] });
            assert.ok(url.startsWith('https://addon.example/'));
            providerHits++;
            return new Response(null, { status: 429, headers: { 'Retry-After': '120' } });
        };
        const env = { ...globals, TextEncoder, DOMException, fetch: browserFetch };
        if (shared) {
            const { createStreamQueries } = load('lib/media/stream-queries.ts', {}, env);
            const store = createStreamQueries('rate-limit-test');
            try {
                await assert.rejects(store.create('tt123', 'movie').promise, /rate limited/);
                await assert.rejects(store.create('tt456', 'movie').promise, /rate limited/);
            } finally { store.clear(); }
        } else {
            const { createPlaybackStreamRequest } = load('lib/media/fetch-playback-streams.ts', {}, env);
            await assert.rejects(createPlaybackStreamRequest('tt123', 'movie').promise, /rate limited/);
            await assert.rejects(createPlaybackStreamRequest('tt456', 'movie').promise, /rate limited/);
        }
        assert.equal(providerHits, 1, 'No provider request during the cooldown');
    }

    // Both public client entry points must use direct requests, including
    // canonical episode IDs and the shared query cache used by prefetch.
    for (const shared of [false, true]) {
        const requests = [];
        const browserFetch = async url => {
            requests.push(url);
            if (url.startsWith('/api/streams/addons?')) return Response.json({ revision: 'fixture', addons: [addon] });
            assert.ok(url.startsWith('https://addon.example/config/stream/series/tt123%3A1%3A2.json'));
            return streams();
        };
        const deps = { './fetch-playback-id': { fetchPlaybackId: async () => 'tt123' } };
        const env = { ...globals, TextEncoder, DOMException, fetch: browserFetch };
        if (shared) {
            const { createStreamQueries } = load('lib/media/stream-queries.ts', deps, env);
            const store = createStreamQueries('direct-test');
            try {
                const prefetch = store.speculate('tmdb:123:1:2', 'series');
                const page = store.create('tt123:1:2', 'series');
                const [result, pageResult] = await Promise.all([prefetch.promise, page.promise]);
                assert.equal(result[0].addonId, addon.id);
                assert.equal(pageResult[0].addonId, addon.id);
                await store.create('tt123:1:2', 'series').promise;
                assert.equal(requests.length, 2, 'Canonical aliases reuse direct results');
            } finally { store.clear(); }
        } else {
            const { createPlaybackStreamRequest } = load('lib/media/fetch-playback-streams.ts', deps, env);
            const result = await createPlaybackStreamRequest('tmdb:123:1:2', 'series').promise;
            assert.equal(result[0].addonId, addon.id);
            assert.equal(requests.length, 2);
        }
    }
    console.log('PASS: normal HTTP caching, direct add-on deduplication, legacy compatibility, fail-closed access errors, cancellation, validation and rate-limit cooldowns');
})().catch(error => { console.error(error); process.exitCode = 1; });
