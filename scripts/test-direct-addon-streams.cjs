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
        return streams();
    });
    assert.equal(calls.length, 1); assert.equal(result.length, 2);
    assert.equal(result[0].name, 'Provider'); assert.equal(result[1].infoHash, 'fixture');

    for (const failure of ['network', 'timeout', 401, 403, 405]) {
        calls = [];
        await fresh()(addon, 'tt123', 'movie', signal, async (url, init) => {
            calls.push(url);
            if (calls.length === 1) {
                if (failure === 'network' || failure === 'timeout') throw new TypeError(failure);
                return new Response(null, { status: failure });
            }
            assert.ok(url.startsWith('/api/streams/addon?'));
            assert.equal(init.credentials, 'same-origin');
            assert.equal(new URL(url, 'https://app.example').searchParams.get('addonId'), addon.id);
            return streams();
        });
        assert.equal(calls.length, 2, `${failure} falls back once`);
    }
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
            if (backend && !url.startsWith('/api/')) throw new TypeError('CORS blocked');
            return new Response(null, { status: 429, headers: { 'Retry-After': '120' } });
        };
        await assert.rejects(api.fetchAddonStreams(addon, 'tt123', 'movie', signal, limited), /rate limited/);
        const before = hits;
        now += 90_000;
        await assert.rejects(api.fetchAddonStreams(addon, 'tt456', 'movie', signal, limited), /rate limited/);
        assert.equal(hits, before, 'Respect the provider cooldown across titles');
        now += 31_000;
        await api.fetchAddonStreams(addon, 'tt456', 'movie', signal, async () => streams());
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
                const result = await store.create('tmdb:123:1:2', 'series').promise;
                assert.equal(result[0].addonId, addon.id);
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
    console.log('PASS: direct add-on results, compatibility fallback, cancellation, validation, private targets and rate-limit cooldowns');
})().catch(error => { console.error(error); process.exitCode = 1; });
