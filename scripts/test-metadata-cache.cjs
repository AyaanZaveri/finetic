const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');
const api = load('lib/server/metadata-cache.ts', { 'server-only': {} }, { Buffer });
const deferred = () => { let resolve; return { promise: new Promise(yes => resolve = yes), resolve }; };
async function checkCatalogCache() {
    let account = 'first', token = 'first-token', fetches = 0, artwork = 0;
    let authenticated = true;
    const cache = new Map();
    const { readCatalog } = load('lib/server/catalog-cache.ts', {
        'server-only': {},
        'next/cache': { unstable_cache: (read, key, { revalidate }) => async () => {
            assert.equal(revalidate, 60);
            assert.match(key[1], /^[a-f0-9]{64}$/);
            if (!cache.has(key[1])) cache.set(key[1], await read());
            return cache.get(key[1]);
        } },
        '@/lib/server/auth': { getAuthData: async () => {
            if (!authenticated) throw Error('Not authenticated');
            return { user: { _id: account }, issuedAt: 1, authKey: 'fixture' };
        } },
        '@/lib/tmdb-credentials': { getTMDBToken: async () => token },
        '@/lib/tmdb-artwork': { getTMDBArtworkWithToken: async (credential, id) => {
            artwork++;
            assert.equal(credential, token);
            return `https://image.tmdb.org/t/p/w500/${id}.jpg`;
        } },
        '@/lib/server/outbound-fetch': { outboundFetch: async () => {
            fetches++;
            return { ok: true, json: async () => ({ metas: [
                { id: 'tt1', type: 'movie' }, { id: 'tt2', type: 'movie' },
            ] }) };
        } },
    });
    const read = (maxItems = 1, signal) => readCatalog('https://addon.test/manifest.json', 'movie', 'top', item => item, signal, maxItems);
    const cold = await read();
    assert.equal(cold[0].poster, 'https://image.tmdb.org/t/p/w500/tt1.jpg');
    assert.equal(cold.length, 1);
    assert.equal(await read(), cold);
    assert.equal(fetches, 1);
    assert.equal(artwork, 1, 'A warm catalog read skips poster resolution');
    assert.equal((await read(2)).length, 2);
    account = 'second';
    assert.notEqual(await read(), cold);
    token = 'second-token';
    await read();
    assert.equal(fetches, 4, 'The row size, account and TMDB credential scope results');
    assert.equal(artwork, 5);
    authenticated = false;
    await assert.rejects(read(), /Not authenticated/);
    authenticated = true;
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(read(1, controller.signal), { name: 'AbortError' });
    assert.equal(fetches, 4);
}
(async () => {
    let clock = 1000, reads = 0;
    const cache = api.createMetadataCache(() => clock);
    const pending = deferred(); let upstream;
    const fetch = async signal => { reads++; upstream = signal; return pending.promise; };
    const abort = new AbortController();
    const left = cache.read('session:revision:title', fetch, abort.signal).catch(() => null);
    const right = cache.read('session:revision:title', fetch);
    abort.abort(); assert.equal(upstream.aborted, false);
    clock = 1100; const data = { name: 'Title' }; pending.resolve(data);
    assert.equal(await left, null); assert.equal(await right, data); assert.equal(reads, 1);
    assert.equal(cache.fetchedAt(data), 1100);
    clock = 1200; await cache.read('session:revision:title', fetch); assert.equal(cache.fetchedAt(data), 1100, 'A hit preserves source freshness');
    clock = 301101;
    await cache.read('session:revision:title', async () => { reads++; return { name: 'New' }; }); assert.equal(reads, 2);
    let failures = 0;
    for (let i = 0; i < 2; i++) await cache.read('failure', async () => { failures++; throw Error('offline'); }).catch(() => {});
    assert.equal(failures, 2, 'Failures cannot poison future reads');
    for (let i = 0; i < 65; i++) await cache.read('title:' + i, async () => ({ id: i }));
    let rereads = 0;
    await cache.read('title:0', async () => { rereads++; return { id: 0 }; }); assert.equal(rereads, 1, 'Global LRU is bounded at 64');
    const enormous = { name: 'x'.repeat(17 * 1024 * 1024) }; let hugeReads = 0;
    for (let i = 0; i < 2; i++) await cache.read('huge', async () => { hugeReads++; return enormous; });
    assert.equal(hugeReads, 2, 'Oversized successes are usable but not retained');
    const key = api.opaqueMetadataIdentity(['session', 'https://provider.test/secret', 'token']);
    assert.match(key, /^[a-f0-9]{64}$/); assert.ok(!key.includes('secret'));
    await checkCatalogCache();
    console.log('Hydrated catalog cache and server parsed-success single-flight, cancellation isolation, source timestamps, failure eviction, opaque identity and bounds passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
