const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');
const calls = [];
let fail = false;
const result = { results: [{ id: 'tmdb:1', type: 'movie' }], totalPages: 3, totalResults: 51 };
const { GET } = load('app/api/search/results/route.ts', {
    '@/lib/tmdb-discovery': { searchTMDBCatalog: async (query, signal, type, page) => {
        calls.push({ query, signal, type, page });
        if (fail) throw Error('TMDB is unavailable');
        return result;
    } },
}, { URL, Response, Error });
(async () => {
    for (const query of ['q=', 'q=x&type=unknown', 'q=x&page=0', 'q=x&page=501', 'q=x&page=1.5', 'q=x&page=no', `q=${'x'.repeat(301)}`]) {
        assert.equal((await GET(new Request(`https://app/api/search/results?${query}`))).status, 400);
    }
    assert.equal(calls.length, 0, 'Invalid inputs must not reach TMDB');
    for (const [type, expected] of [['all', undefined], ['movie', 'movie'], ['series', 'series'], ['person', 'person']]) {
        const response = await GET(new Request(`https://app/api/search/results?q=%20Example%20&type=${type}&page=2`));
        assert.equal(response.status, 200); assert.deepEqual(await response.json(), result);
        assert.equal(calls.at(-1).query, 'Example'); assert.equal(calls.at(-1).page, 2); assert.equal(calls.at(-1).type, expected);
        assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    }
    const cancelled = new AbortController(); cancelled.abort();
    assert.equal((await GET(new Request('https://app/api/search/results?q=x', { signal: cancelled.signal }))).status, 499);
    fail = true;
    const response = await GET(new Request('https://app/api/search/results?q=x'));
    assert.equal(response.status, 503); assert.equal((await response.json()).error, 'TMDB is unavailable');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    console.log('PASS: public incremental search route, per-type ranking/page, input limits, cancellation and private error responses.');
})().catch(error => { console.error(error); process.exitCode = 1; });
