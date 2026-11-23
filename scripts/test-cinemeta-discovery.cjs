const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');

async function main() {
    const poster = 'https://images.metahub.space/poster/small/tt0078748/img';
    const thumbnail = 'https://episodes.metahub.space/tt0903747/1/1/w780.jpg';
    const artwork = load('lib/artwork.ts');
    assert.equal(artwork.publicArtworkUrl(poster), poster);
    assert.equal(artwork.episodeHeroStillUrl(thumbnail), thumbnail);
    for (const invalid of [poster + '?token=private', poster.replace('.space', '.space.example'), poster.replace('tt0078748', '..'), thumbnail.replace('https:', 'http:')]) {
        assert.equal(artwork.publicArtworkUrl(invalid), undefined);
    }
    const calls = [];
    let token, fail = false;
    const cinemeta = load('lib/cinemeta.ts', { 'server-only': {}, '@/lib/artwork': artwork }, {
        fetch: async (url, init) => {
            calls.push(url);
            assert.equal(init.redirect, 'error');
            const type = url.includes('/series/') ? 'series' : 'movie';
            const item = { id: 'tt0078748', type, name: 'Example', poster, releaseInfo: '1979' };
            return fail ? new Response(null, { status: 503 }) : url.includes('/meta/')
                ? Response.json({ meta: item }) : Response.json({ metas: [item, null, { ...item, id: 'untrusted' }] });
        },
    });
    const service = load('lib/discovery.ts', {
        'server-only': {}, '@/lib/cinemeta': cinemeta,
        '@/lib/tmdb-credentials': { getTMDBToken: async () => token },
        '@/lib/tmdb-discovery': { searchTMDBCatalog: async () => ({ results: [], totalPages: 5 }) },
    });
    assert.equal(await service.hasTMDBDiscovery(), false);
    const rows = await Promise.all(service.cinemetaHomeRows().map(row => row.result));
    assert.ok(rows.every(row => row.status === 'ready' && row.section.mediaItems.length === 1));
    assert.equal(await service.discoveryHomeFeed('cinemeta-unknown'), undefined);
    const search = await service.searchDiscovery('Alien / &', undefined, 'movie');
    assert.equal(search.results[0].year, 1979);
    assert.equal(search.results[0].poster, poster);
    assert.equal(calls.at(-1), 'https://v3-cinemeta.strem.io/catalog/movie/top/search=Alien%20%2F%20%26.json');
    assert.equal(Array.from((await service.searchDiscovery('Example')).results, item => item.type).join(','), 'movie,series');
    assert.equal((await service.searchDiscovery('Alien', undefined, 'person')).totalResults, 0);
    assert.equal(await cinemeta.cinemetaMetadata('movie', '../../private'), null);
    assert.equal(await cinemeta.cinemetaMetadata('movie', 'tt1111111'), null, 'Ignore mismatched metadata IDs');
    assert.equal((await cinemeta.cinemetaMetadata('movie', 'tt0078748')).name, 'Example');
    const before = calls.length;
    token = 'configured';
    assert.equal((await service.searchDiscovery('Alien')).provider, 'TMDB');
    assert.equal(calls.length, before, 'Configured searches keep the TMDB ranking');
    fail = true;
    assert.equal((await (await service.discoveryHomeFeed('cinemeta-movie')).result).status, 'error');
    console.log('PASS: no-token provider selection, fixed Cinemeta URLs, guest artwork, metadata identity, and retry failures.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
