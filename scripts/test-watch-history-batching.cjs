const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const bits = load('lib/stremio-watched.ts', { 'server-only': {} });
const calls = [], pending = new Map();
let active = 0, peak = 0, reads = 0;
const ids = ['tmdb:1', 'tmdb:2', 'tmdb:3'];
const history = load('app/actions/watch-history.ts', {
    '@/lib/server/auth': { getAuthData: async () => ({ authKey: 'fixture' }) },
    '@/lib/stremio-watched': bits,
    './tv-shows': { fetchEpisodes: async (id, season, _signal, includeArtwork) => {
        assert.equal(includeArtwork, false, "Watched badges must not resolve episode thumbnails");
        calls.push({ id, season });
        if (season === 0) return [{ id: `${id}:0:1`, season: 0, episode: 1 }];
        active++; peak = Math.max(peak, active);
        const work = deferred(); pending.set(id, work);
        await work.promise; active--;
        return [{ id: `${id}:1:1`, season: 1, episode: 1 }];
    } },
}, { fetch: async (_url, options) => {
    reads++;
    assert.equal(new Set(JSON.parse(options.body).ids).size, 4);
    return { ok: true, json: async () => ({ result: [
        ...ids.map(id => ({ _id: id, type: 'series', state: { watchedEpisodes: [1, 1] } })),
        { _id: 'movie', type: 'movie', state: { flaggedWatched: 1 } },
    ] }) };
} });
(async () => {
    const response = history.fetchWatchedItems([
        { id: ids[0], type: 'series' }, { id: ids[0], type: 'series' },
        { id: ids[1], type: 'series' }, { id: 'movie', type: 'movie' }, { id: ids[2], type: 'series' },
    ]);
    await tick();
    assert.equal(pending.size, 2, 'Independent series metadata starts concurrently within the title budget');
    assert.equal(reads, 1, 'Retain one batched datastore read');
    pending.get(ids[1]).resolve(); await tick();
    assert.ok(pending.has(ids[2]), 'A slow first title cannot stall the metadata worker queue');
    pending.get(ids[2]).resolve(); pending.get(ids[0]).resolve();
    const result = await response;
    assert.equal(peak, 2, 'Never fan out all visible series at once');
    assert.equal(calls.filter(call => call.id === ids[0] && call.season === undefined).length, 1, 'Duplicate cards reuse one title decode');
    for (const id of ids) assert.deepEqual([...result[`series:${id}`].watchedEpisodeIds], [`${id}:0:1`, `${id}:1:1`], 'Match Stremio season ordering, including specials');
    assert.equal(result['movie:movie'].movieWatched, true);
    console.log('PASS: one datastore batch, two title workers, no serial head-of-line blocking, duplicate title reuse and specials compatibility');
})().catch(error => { console.error(error); process.exitCode = 1; });
