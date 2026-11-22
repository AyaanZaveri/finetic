const assert = require('node:assert/strict');
const { QueryClient, timeoutManager } = require('@tanstack/react-query');
// Browser cache GC should not keep this Node regression process alive after
// the assertions and explicit session cleanup have completed.
timeoutManager.setTimeoutProvider({
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout,
    setInterval: (fn, ms) => { const timer = setInterval(fn, ms); timer.unref(); return timer; }, clearInterval,
});
const { load } = require('./test-support/react-hooks.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const api = load('lib/media/stream-queries.ts', {
    './fetch-playback-id': { fetchPlaybackId: async () => 'tt123' },
}, { TextEncoder, DOMException, URLSearchParams });
const stores = [];
(async () => {
    const calls = [], pending = new Map();
    const fetch = async (url, { signal }) => {
        const parsed = new URL(url, 'https://app.test'); calls.push(parsed);
        if (parsed.pathname.endsWith('/addons')) return Response.json({ revision: 'opaque-config', addons: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
        const key = parsed.searchParams.get('mediaItemId') + ':' + parsed.searchParams.get('addonId');
        const work = deferred(); pending.set(key, { ...work, signal }); return work.promise;
    };
    const client = new QueryClient();
    const store = api.createStreamQueries('account:session', client, fetch); stores.push(store);
    const target = { id: 'tt123:1:2', type: 'series' };
    const home = store.acquire(target, 'speculative');
    await tick();
    const page = store.acquire(target), player = store.acquire(target);
    assert.equal(home.request, page.request); assert.equal(page.request, player.request, 'Quick Play joins the exact unfinished request');
    home.release(); page.release(); await tick();
    assert.equal(calls.filter(url => url.pathname.endsWith('/addon')).length, 2);
    assert.ok([...pending.values()].every(work => !work.signal.aborted));
    pending.get('tt123:1:2:b').resolve(Response.json({ streams: [{ url: 'https://video.test/b' }] })); await tick();
    assert.equal(player.request.snapshot.streams[0].addonId, 'b'); assert.equal(player.request.snapshot.pending, 1); assert.equal(player.request.snapshot.settledPrefix, 0);
    for (const query of client.getQueryCache().findAll({ queryKey: ['playback', 'account:session', 'streams'] })) {
        if (query.state.data) client.setQueryData(query.queryKey, query.state.data, { updatedAt: Date.now() - 31_000 });
    }
    // Alias lookup races the original unfinished provider query, not another HTTP request.
    const alias = store.acquire({ id: 'tmdb:42:1:2', type: 'series' }); await tick();
    assert.equal(calls.filter(url => url.pathname.endsWith('/addon')).length, 2, 'Canonical aliases share provider queries');
    pending.get('tt123:1:2:a').resolve(Response.json({ streams: [{ infoHash: 'hash', name: 'Torrent' }, { url: 'https://video.test/a' }] }));
    await Promise.all([player.request.promise, alias.request.promise]);
    for (const query of client.getQueryCache().findAll({ queryKey: ['playback', 'account:session', 'streams'] })) {
        if (query.state.data) client.setQueryData(query.queryKey, query.state.data);
    }
    assert.deepEqual(Array.from(player.request.snapshot.streams, stream => stream.addonId), ['a', 'a', 'b']);
    player.release(); alias.release(); await tick();
    const cached = store.peek(target);
    assert.equal(cached.complete, true, 'The stream drawer can read completed results before subscribing');
    assert.deepEqual(Array.from(cached.streams, stream => stream.addonId), ['a', 'a', 'b']);
    assert.equal(store.peek({ ...target, id: 'tt123:1:3' }), undefined, 'Never show the previous episode’s streams');
    const before = calls.length, navigator = store.acquire(target);
    await navigator.request.promise; assert.equal(calls.length, before, 'Fresh Navigator playback reads TanStack data without refetch');
    navigator.release(); await tick();

    const allFailed = store.acquire({ id: 'all-failed', type: 'movie' }); await tick();
    const rejected = assert.rejects(allFailed.request.promise, /Could not load streams/);
    for (const id of ['a', 'b']) pending.get('all-failed:' + id).resolve(new Response('offline', { status: 503 }));
    await rejected; allFailed.release(); await tick();

    const partlyFailed = store.acquire({ id: 'partly-failed', type: 'movie' }); await tick();
    const partlyRejected = assert.rejects(partlyFailed.request.promise, /Could not load streams/);
    pending.get('partly-failed:a').resolve(Response.json({ streams: [] }));
    pending.get('partly-failed:b').resolve(new Response('offline', { status: 503 }));
    await partlyRejected; partlyFailed.release(); await tick();

    const failedTarget = { id: 'failure', type: 'movie' };
    const failed = store.acquire(failedTarget); await tick();
    pending.get('failure:a').resolve(Response.json({ streams: [{ url: 'https://video.test/healthy' }] }));
    pending.get('failure:b').resolve(new Response('offline', { status: 503 })); await failed.request.promise;
    failed.release(); await tick(); const failedCalls = calls.length;
    const retry = store.acquire(failedTarget); await tick();
    assert.equal(calls.length, failedCalls + 1, 'Retry keeps the healthy provider and fetches only the failed provider');
    pending.get('failure:b').resolve(Response.json({ streams: [] })); await retry.request.promise; retry.release(); await tick();

    const resolver = load('lib/media/resolve-playback.ts');
    resolver.invalidatePlaybackWarmup(navigator.request);
    const retryPlayback = resolver.resolvePlayback({ id: 'tt123', type: 'series', mediaSourceId: target.id, name: 'Episode', streamRequest: navigator.request }, {
        fetchStreams: (id, type) => store.create(id, type).promise, getNextEpisodeForSeries: async () => null,
    }, () => {});
    await tick();
    assert.equal(calls.filter(url => url.searchParams.get('mediaItemId') === target.id).length, 4, 'Explicit retry starts one fresh provider attempt');
    for (const id of ['a', 'b']) pending.get('tt123:1:2:' + id).resolve(Response.json({ streams: [{ url: 'https://video.test/new' }] }));
    assert.equal((await retryPlayback).streamUrl, 'https://video.test/new', 'A managed non-speculative prepared request is refreshed on Retry');
    await tick();

    // Expiry is based on query response timestamps, never on cache reads.
    for (const query of client.getQueryCache().findAll({ queryKey: ['playback', 'account:session', 'streams'] })) {
        if (query.queryKey[5] === target.id) client.setQueryData(query.queryKey, query.state.data, { updatedAt: Date.now() - 31_000 });
    }
    const timed = store.acquire(target); await tick();
    assert.equal(calls.filter(url => url.searchParams.get('mediaItemId') === target.id).length, 6);
    for (const id of ['a', 'b']) pending.get('tt123:1:2:' + id).resolve(Response.json({ streams: [{ url: 'https://video.test/timed' }] }));
    await timed.request.promise; timed.release(); await tick();

    // Same-frame cleanup/setup retains the underlying unfinished request.
    const strictTarget = { id: 'strict', type: 'movie' };
    const strictA = store.acquire(strictTarget); await tick(); strictA.release();
    const strictB = store.acquire(strictTarget);
    assert.equal(strictA.request, strictB.request);
    await tick(); assert.equal(pending.get('strict:a').signal.aborted, false);
    const abort = new AbortController();
    const otherOwner = store.acquire(strictTarget, 'required', abort.signal); abort.abort(); await tick();
    assert.equal(pending.get('strict:a').signal.aborted, false, 'One cancelled owner leaves the other owner running');
    otherOwner.release();
    for (const id of ['a', 'b']) pending.get('strict:' + id).resolve(Response.json({ streams: [{ url: 'https://video.test/strict' }] }));
    await strictB.request.promise; strictB.release();
    const active = store.acquire({ id: 'active', type: 'movie' }); await tick();
    store.invalidate(); assert.ok(!pending.get('active:a').signal.aborted, 'Configuration invalidation does not cancel an active consumer');
    for (const id of ['a', 'b']) pending.get('active:' + id).resolve(Response.json({ streams: [] }));
    await active.request.promise; active.release();

    const freshSession = api.createStreamQueries('account:new-session', new QueryClient(), fetch); stores.push(freshSession);
    assert.equal(freshSession.client.getQueryCache().getAll().length, 0, 'Reload/session replacement has an empty cache');
    // Bound real inactive QueryClient data rather than a second response map.
    for (let i = 0; i < 15; i++) client.setQueryData(['playback', 'account:session', 'streams', 'rev', 'movie', 'bulk-' + i, 0], [{ url: 'x'.repeat(800_000) }]);
    store.prune();
    const unused = client.getQueryCache().findAll({ queryKey: ['playback', 'account:session', 'streams'] }).filter(q => !q.getObserversCount());
    assert.ok(unused.length <= 12); assert.ok(unused.reduce((sum, q) => sum + Buffer.byteLength(JSON.stringify(q.state.data)), 0) <= 8 * 1024 * 1024);
    const timers = new Map(); let timerId = 0;
    const controlledApi = load('lib/media/stream-queries.ts', { './fetch-playback-id': { fetchPlaybackId: async () => 'tt123' } }, {
        TextEncoder, DOMException, URLSearchParams,
        setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    });
    const controlled = controlledApi.createStreamQueries('controlled', new QueryClient(), fetch); stores.push(controlled);
    const first = controlled.acquire({ id: 'spec1', type: 'movie' }, 'speculative'); await tick();
    controlled.acquire({ id: 'spec2', type: 'movie' }, 'speculative'); await tick();
    controlled.acquire({ id: 'spec3', type: 'movie' }, 'speculative'); await tick();
    await assert.rejects(first.request.promise);
    assert.equal(pending.get('spec1:a').signal.aborted, true, 'A third speculative target evicts only unclaimed work');
    for (const timer of [...timers.values()]) if (timer.ms === 30_000) timer.fn();
    await tick(); assert.equal(pending.get('spec2:a').signal.aborted, true, 'Unclaimed discovery expires even after its page disappears');
    const cancelled = new AbortController(); cancelled.abort(); const previousCalls = calls.length;
    assert.throws(() => controlled.acquire({ id: 'never-start', type: 'movie' }, 'required', cancelled.signal));
    assert.equal(calls.length, previousCalls);
    const { parseStreamResponse } = load('lib/media/stream-schema.ts');
    assert.equal(parseStreamResponse({ streams: [{ infoHash: 'abc', extra: true }, { url: 42 }, { url: 'https://video.test', behaviorHints: { filename: 'movie.mkv', custom: true } }] }).length, 2);
    assert.throws(() => parseStreamResponse({ streams: 'bad' }));
    console.log('PASS: real TanStack query deduplication, progressive ordering, alias/Play handoff, partial failure retry, invalidation, session reset, bounded memory and Zod validation');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => stores.forEach(store => store.clear()));
