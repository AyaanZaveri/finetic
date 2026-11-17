const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');
let mode = 'ok', fallbackCalls = 0;
const requests = [];
const reference = index => ({ id: `tmdb:${index}`, type: index % 2 ? 'movie' : 'series', name: `Title ${index}`, runtime: '90 min' });
const credits = Array.from({ length: 8 }, (_, index) => reference(index + 1));
const list = `<div id="known_for_scroller"><ul>${credits.map((item, index) => `<li><a href="/${item.type === 'movie' ? 'movie' : 'tv'}/${index + 1}-title">Poster</a><a href="/${item.type === 'movie' ? 'movie' : 'tv'}/${index + 1}-title">Title</a></li>`).join('')}</ul></div>`;
const fallback = [{ id: 'tmdb:99', type: 'movie', name: 'API fallback' }];
const known = load('lib/tmdb-known-for.ts', {
    'server-only': {}, '@/lib/tmdb-discovery': {
        getTMDBPersonKnownFor: async () => { fallbackCalls++; return fallback; },
        getTMDBTitle: async id => ({ ...reference(Number(id.split(':')[1])), runtime: 90 }),
    },
}, { URL, AbortSignal, fetch: async (url, options) => {
    requests.push({ url, options });
    options.signal.throwIfAborted();
    if (mode === 'throw') throw Error('Network failure');
    if (mode === 'redirect') return new Response(null, { status: 302, headers: { location: 'https://untrusted.test/person/7' } });
    return new Response(mode === 'changed' ? '<html>Different markup</html>' : list, { headers: { 'content-type': 'text/html' } });
} });
(async () => {
    const parsed = known.parseTMDBKnownFor(`<a href="/movie/500-outside">Outside</a>${list}<ul><a href="/movie/600-outside">Outside</a></ul>`);
    assert.equal(parsed.length, 8, 'Read the entire website row, without the three-item API limit');
    assert.deepEqual(Array.from(parsed, item => item.id), credits.map(item => item.id));
    assert.equal(known.parseTMDBKnownFor('<html>No known-for list</html>'), null);
    assert.equal(known.parseTMDBKnownFor('<div id="known_for_scroller"><ul></ul></div>').length, 0);
    const result = await known.getTMDBWebsiteKnownFor(7, 'Person', credits);
    assert.deepEqual(Array.from(result, item => item.id), credits.map(item => item.id));
    assert.equal(result[0], credits[0], 'Reuse the existing API card data without title fan-out');
    assert.equal(fallbackCalls, 0);
    assert.equal(requests[0].options.headers.Authorization, undefined, 'Never send private API credentials to the website');
    const hydrated = await known.getTMDBWebsiteKnownFor(7, 'Person', credits.slice(0, 7));
    assert.equal(hydrated.length, 8, 'A newer website credit is hydrated through the API');
    assert.equal(hydrated[7].runtime, '90 min');
    for (mode of ['changed', 'redirect', 'throw']) assert.equal(await known.getTMDBWebsiteKnownFor(7, 'Person', credits), fallback);
    assert.ok(requests.every(request => request.url.startsWith('https://www.themoviedb.org/person/7')), 'Do not follow redirects to another origin');
    const controller = new AbortController(); controller.abort();
    await assert.rejects(known.getTMDBWebsiteKnownFor(7, 'Person', credits, controller.signal));
    console.log('PASS: complete website Known for order, scoped/deduplicated IDs, API hydration, safe redirects, credential isolation, cancellation, and fallback');
})().catch(error => { console.error(error); process.exitCode = 1; });
