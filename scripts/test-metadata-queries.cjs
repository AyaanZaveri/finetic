const assert = require('node:assert/strict');
const { QueryClient, dehydrate, hydrate } = require('@tanstack/react-query');
const { load } = require('./test-support/react-hooks.cjs');
const globals = { TextEncoder, URLSearchParams, DOMException, fetch };
const api = load('lib/media/metadata-queries.ts', {}, globals);
const schema = load('lib/media/metadata.ts', {}, globals);
const streamApi = load('lib/media/stream-queries.ts', { './fetch-playback-id': { fetchPlaybackId: async () => 'tt123' } }, globals);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; return { promise: new Promise(yes => resolve = yes), resolve }; };
const revision = 'a'.repeat(64);
const media = { id: 'tt123', type: 'series', name: 'Show', mediaSourceId: 'tt123:1:3', seasonNumber: 1, episodeNumber: 3 };
const title = () => schema.titleEnvelope({ id: 'tt123', type: 'series', name: 'Show', releaseInfo: '2001-09-05', runtime: '45 min',
    imdbRating: '8.2', communityRating: 7.8, ratingSource: 'TMDB', voteCount: 321, logo: '/logo.png' }, Date.now());
const episode = (n = 3) => schema.episodeEnvelope({ id: `tt123:1:${n}`, season: 1, episode: n, title: `Real name ${n}`,
    released: '2026-10-10', runtime: '42 min', communityRating: 9, ratingSource: 'TMDB', voteCount: 50, thumbnail: '/still.png' }, 'tt123', Date.now());
(async () => {
    const client = new QueryClient();
    const streams = streamApi.createStreamQueries('account:session', client);
    const calls = [], work = new Map();
    const fetch = async (url, options) => {
        const parsed = new URL(url, 'https://app.test'); calls.push(parsed);
        if (parsed.pathname.endsWith('/config')) return Response.json({ revision });
        const key = parsed.pathname + ':' + (parsed.searchParams.get('episode') || 'title');
        const pending = deferred(); work.set(key, { ...pending, signal: options.signal }); return pending.promise;
    };
    const queries = api.createMetadataQueries(streams, fetch);
    const controller = new AbortController();
    const home = queries.prepare(media, 'speculative', controller.signal); await tick();
    const page = queries.details(media), play = queries.episodeDetails('tt123', 1, 3);
    const navigator = queries.prepare(media, 'required');
    controller.abort(); await tick();
    assert.equal(calls.length, 3, 'Home, page, quick Play and Navigator share config/title/episode requests');
    assert.ok([...work.values()].every(item => !item.signal.aborted), 'Canceling speculation cannot abort required consumers');
    work.get('/api/playback/details:title').resolve(Response.json({ metadata: title() }));
    work.get('/api/playback/episode:3').resolve(Response.json({ metadata: episode() }));
    await Promise.all([home, page, play, navigator]);
    const enriched = queries.enrich(media);
    assert.equal(enriched.episodeTitle, 'Real name 3'); assert.equal(enriched.details.runtime, '42 min');
    assert.equal(enriched.details.releaseInfo, '2001-09-05'); assert.equal(queries.peek(media).episode.data.airDate, '2026-10-10');
    assert.equal(enriched.details.imdbRating, '8.2'); assert.equal(enriched.details.communityRating, 7.8);
    assert.equal(queries.peek(media).episode.data.ratings[0].scope, 'episode');
    let played;
    const actions = load('contexts/MediaPlayerContext.tsx', {
        react: { useCallback: callback => callback },
        jotai: { useSetAtom: atom => value => { if (atom === 'play') played = value; } },
        '@/lib/atoms': { playMediaAtom: 'play' },
        '@/contexts/account-context': { useAccountAccess: () => ({ authenticated: true }) },
        '@/components/stream-query-provider': { useMetadataQueries: () => queries },
    }, globals);
    actions.usePlaybackActions().playMedia(media);
    assert.equal(played.episodeTitle, 'Real name 3', 'Actual Play command publishes a warm episode name synchronously');
    await queries.prepare(media, 'required'); assert.equal(calls.length, 3, 'Fresh records are reused');
    await queries.prepare({ ...media, id: 'tmdb:42' }, 'required'); assert.equal(calls.length, 3, 'TMDB/IMDb title aliases reuse queries');
    const next = queries.episodeDetails('tt123', 1, 4); await tick();
    assert.equal(queries.enrich({ ...media, seasonNumber: 1, episodeNumber: 4 }).episodeTitle, undefined, 'No episode title leakage');
    work.get('/api/playback/episode:4').resolve(Response.json({ metadata: episode(4) })); await next;
    assert.equal(calls.filter(c => c.pathname.endsWith('/details')).length, 1, 'Episodes share their show');

    const configurationKey = ['metadata', 'account:session', 'config'];
    client.setQueryData(configurationKey, { revision }, { updatedAt: Date.now() - 31_000 });
    assert.equal(queries.enrich(media).episodeTitle, 'Real name 3', 'An old configuration check must not hide fresh metadata synchronously');
    const original = queries.peek(media).title;
    const preview = schema.titleEnvelope({ id: 'tt123', type: 'series', name: 'Sparse' }, Date.now() + 100, 'preview');
    assert.equal(api.mergeMetadata(original, preview).data.name, 'Show');
    const partial = title(); partial.data.cast = ['New cast']; partial.data.name = undefined; partial.data.artwork.logo = undefined;
    assert.equal(api.mergeMetadata(original, partial).data.name, 'Show');
    assert.equal(api.mergeMetadata(original, partial).data.artwork.logo, '/logo.png');
    partial.data.ratings = partial.data.ratings.filter(rating => rating.source === 'TMDB');
    assert.ok(api.mergeMetadata(original, partial).data.ratings.some(rating => rating.source === 'IMDb'), 'Partial ratings preserve other sources');
    assert.equal(schema.episodeEnvelope({ id: 'x', title: 'Episode 3', season: 1, episode: 3 }, 'tt123', Date.now()).data.name, undefined);

    // Only metadata is hydrated; older server seeds cannot replace newer data.
    const server = new QueryClient();
    const key = schema.metadataKey('account:session', revision, 'series', 'tt123');
    const older = title(); older.data.name = 'Old'; older.fetchedAt -= 1000;
    server.setQueryData(key, older, { updatedAt: older.fetchedAt });
    hydrate(client, dehydrate(server)); assert.equal(queries.peek(media).title.data.name, 'Show'); server.clear();
    const updatedAt = client.getQueryState(key).dataUpdatedAt;
    await queries.title(media); assert.equal(client.getQueryState(key).dataUpdatedAt, updatedAt, 'Reads never extend freshness');
    client.setQueryData(key, original, { updatedAt: Date.now() - 900_001 });
    assert.equal(queries.peek(media).title, undefined, 'Expired data is not a warm playback candidate');
    const expired = queries.title(media); await tick();
    assert.equal(calls.filter(c => c.pathname.endsWith('/details')).length, 2);
    work.get('/api/playback/details:title').resolve(Response.json({ metadata: title() })); await expired;
    queries.invalidate(); assert.equal(Object.keys(queries.peek(media)).length, 0, 'Configuration invalidation immediately excludes incompatible records');
    const partialFailure = queries.prepare(media, 'required'); await tick();
    work.get('/api/playback/details:title').resolve(Response.json({ metadata: title() }));
    work.get('/api/playback/episode:3').resolve(new Response(null, { status: 503 }));
    await partialFailure;
    assert.ok(queries.peek(media).title, 'Healthy title survives an episode lookup failure');
    assert.equal(queries.peek(media).episode, undefined);
    const retryCalls = calls.length, retryEpisode = queries.episodeDetails('tt123', 1, 3); await tick();
    assert.equal(calls.length, retryCalls + 1, 'Failed episode is retryable without another show request');
    const unavailable = episode(); unavailable.data.name = undefined; unavailable.data.still = undefined; unavailable.data.ratings = [];
    work.get('/api/playback/episode:3').resolve(Response.json({ metadata: unavailable })); await retryEpisode;
    assert.equal(queries.peek(media).episode.data.still, undefined, 'Missing artwork is a valid unavailable value');
    // Fresh browser/session starts empty; providers retain the same client through navigation.
    const fresh = api.createMetadataQueries(streamApi.createStreamQueries('other', new QueryClient()), fetch);
    assert.equal(Object.keys(fresh.peek(media)).length, 0); fresh.dispose(); fresh.client.clear();
    queries.dispose(); streams.clear();

    // A cold TMDB search result navigates to the original TMDB route.
    // Playback identity resolution may still use IMDb for cache deduplication.
    const searchClient = new QueryClient();
    const searchStreams = streamApi.createStreamQueries('search', searchClient);
    const searchRequests = [];
    const searchQueries = api.createMetadataQueries(searchStreams, async url => {
        const parsed = new URL(url, 'https://app.test');
        if (parsed.pathname.endsWith('/config')) return Response.json({ revision });
        searchRequests.push(parsed.searchParams.get('id'));
        return Response.json({ metadata: title() });
    });
    const suggestion = { id: 'tmdb:42', type: 'series', name: 'Show' };
    try {
        await searchQueries.title(suggestion, 'speculative');
        assert.deepEqual(searchRequests, ['tmdb:42'], 'Warm the same server title cache key as the search destination');
        assert.ok(searchQueries.peek(suggestion).title);
        await searchQueries.title({ ...suggestion, id: 'tt123' });
        assert.equal(searchRequests.length, 1, 'Preserve canonical client metadata deduplication');
    } finally {
        searchQueries.dispose(); searchStreams.clear();
    }

    // Retention caps cover all unused records and serialized payload bytes.
    const capped = api.createMetadataQueries(streamApi.createStreamQueries('bounded', new QueryClient()), fetch);
    for (let i = 0; i < 70; i++) capped.client.setQueryData(schema.metadataKey('bounded', revision, 'movie', 'id' + i), title());
    for (let i = 0; i < 140; i++) capped.client.setQueryData(schema.metadataKey('bounded', revision, 'series', 'id', 1, i + 1), episode(i + 1));
    capped.prune();
    const protectedKey = schema.metadataKey('bounded', revision, 'movie', 'protected');
    capped.client.setQueryData(['metadata', 'bounded', 'config'], { revision });
    capped.client.setQueryData(protectedKey, title());
    const releaseActive = capped.observe({ id: 'protected', type: 'movie', name: '' }, () => {});
    for (let i = 70; i < 140; i++) capped.client.setQueryData(schema.metadataKey('bounded', revision, 'movie', 'id' + i), title());
    capped.prune(); assert.ok(capped.client.getQueryData(protectedKey), 'A mounted header is protected from inactive LRU eviction');
    releaseActive(); capped.prune();
    assert.equal(capped.client.getQueryCache().findAll().filter(q => q.queryKey[3] === 'title').length, 64);
    assert.equal(capped.client.getQueryCache().findAll().filter(q => q.queryKey[3] === 'episode').length, 128);
    const large = title(); large.data.synopsis = 'x'.repeat(9 * 1024 * 1024);
    capped.client.setQueryData(schema.metadataKey('bounded', revision, 'movie', 'huge'), large); capped.prune();
    assert.ok(!capped.client.getQueryData(schema.metadataKey('bounded', revision, 'movie', 'huge')));
    capped.dispose(); capped.client.clear();
    console.log('Shared metadata queries, quick Play, aliases, cancellation, dates/ratings, seeding and bounds passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
