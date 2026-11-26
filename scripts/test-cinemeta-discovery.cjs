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
    let token, fail = false, provider = 'auto';
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
        '@/lib/server/metadata-provider': { getMetadataProvider: async () => provider },
        '@/lib/tmdb-discovery': { searchTMDBCatalog: async () => ({ results: [], totalPages: 5 }) },
    });
    assert.equal(await service.hasTMDBDiscovery(), false);
    const rows = await Promise.all(service.cinemetaHomeRows().map(row => row.result));
    assert.equal(calls[0], "https://cinemeta-catalogs.strem.io/top/catalog/movie/top.json");
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
    provider = 'cinemeta';
    assert.equal(await service.hasTMDBDiscovery(), false, 'Explicit Cinemeta overrides a configured TMDB token');
    assert.equal((await service.searchDiscovery('Alien')).provider, 'Cinemeta');
    provider = 'tmdb';
    assert.equal((await service.searchDiscovery('Alien')).provider, 'TMDB');
    token = undefined;
    assert.equal((await service.searchDiscovery('Alien')).provider, 'Cinemeta', 'Removing the TMDB token keeps discovery usable');
    fail = true;
    assert.equal((await (await service.discoveryHomeFeed('cinemeta-movie')).result).status, 'error');
    console.log('PASS: no-token provider selection, fixed Cinemeta URLs, guest artwork, metadata identity, and retry failures.');

    const seriesId = 'tt9140554';
    const still = 'https://episodes.metahub.space/tt9140554/1/3/w780.jpg';
    const tmdbReads = [];
    const certificationReads = [];
    const core = {
        'server-only': {}, '@/lib/artwork': artwork,
        './auth': { getInstalledAddons: async () => [] },
        '@/lib/server/auth': { getAuthData: async () => ({ authKey: 'fixture' }) },
        '@/lib/server/catalog-cache': {}, '@/lib/server/media-artwork': {},
        '@/lib/server/outbound-fetch': { outboundFetch: async () => { throw new Error('Unexpected add-on request'); } },
        '@/lib/server/metadata-provider': { getMetadataProvider: async () => provider },
        '@/lib/server/metadata-identity': { metadataIdentity: async () => ({ scope: 'account', revision: `${provider}:${Boolean(token)}`, provider, tmdbConfigured: Boolean(token) }) },
        '@/lib/server/metadata-cache': load('lib/server/metadata-cache.ts', { 'server-only': {} }, { Buffer }),
        '@/lib/tmdb-artwork': { getTMDBArtwork: async () => undefined },
        '@/lib/cinemeta': { cinemetaMetadata: async (_type, id) => id === seriesId ? {
            id, type: 'series', name: 'Cinemeta title', moviedb_id: "84958", videos: [
                { id: `${id}:1:2`, name: 'Previous', season: 1, episode: 2 },
                { id: `${id}:1:3`, name: 'Cinemeta episode', season: 1, episode: 3, thumbnail: still },
            ],
        } : null },
        '@/lib/tmdb-discovery': {
            getTMDBContentRating: async (id, type) => {
                certificationReads.push([id, type]);
                return { value: 'TV-14', region: 'US' };
            },
            resolveTMDBPlaybackId: async () => seriesId,
            tmdbMediaItem: async () => { tmdbReads.push('title'); return { id: 'tmdb:84958', imdbId: seriesId, name: 'TMDB title', type: 'series' }; },
            getTMDBSeasons: async () => { tmdbReads.push('seasons'); return [{ number: 1, name: 'Season 1', episodeCount: 6 }]; },
            getTMDBEpisodes: async () => { tmdbReads.push('episodes'); return [{ id: 'tmdb:84958:1:3', title: 'TMDB episode', season: 1, episode: 3 }]; },
            getTMDBEpisode: async () => { tmdbReads.push('episode'); return { name: 'TMDB episode' }; },
        },
    };
    core['./tv-shows'] = {};
    const media = load('app/actions/media.ts', core);
    const tv = load('app/actions/tv-shows.ts', core);
    const episodesRoute = load('app/api/series/episodes/route.ts', { ...core, '@/app/actions/tv-shows': tv }, { URL, Response });

    provider = 'cinemeta';
    assert.equal((await media.fetchMediaDetails(seriesId, 'series')).name, 'Cinemeta title');
    assert.equal((await media.fetchMediaDetails(seriesId, 'series')).contentRating, undefined);
    assert.equal(certificationReads.length, 0, 'Cinemeta needs no TMDB token');
    token = 'configured';
    assert.equal((await media.fetchMediaDetails(seriesId, 'series')).contentRating.value, 'TV-14');
    assert.deepEqual(certificationReads, [['tmdb:84958', 'series']], 'Read only the certificate by Cinemeta’s TMDB ID');
    assert.equal((await media.fetchMediaDetails('tmdb:84958', 'series')).tmdbId, 84958, 'Known legacy routes can switch providers');
    const beforePlayback = certificationReads.length;
    assert.equal((await media.fetchMediaDetails(seriesId, 'series', undefined, { playback: true })).name, 'Cinemeta title');
    assert.equal(certificationReads.length, beforePlayback, 'Do not add certificate lookups to playback startup');
    assert.equal((await tv.fetchSeasons(seriesId))[0].episodeCount, 2);
    assert.equal((await tv.fetchEpisodeDetails(seriesId, 1, 3)).thumbnail, still);
    assert.equal((await tv.getFollowingEpisodeForSeries(seriesId, 1, 2)).title, 'Cinemeta episode');
    const seasonUrl = id => new Request(`https://navigator.test/api/series/episodes?id=${id}&season=1`);
    assert.equal((await (await episodesRoute.GET(seasonUrl('tmdb:84958'))).json())[1].title, 'Cinemeta episode');
    assert.deepEqual(tmdbReads, [], 'Selected Cinemeta still supplies title and episode details');

    provider = 'tmdb';
    assert.equal((await media.fetchMediaDetails(seriesId, 'series')).name, 'TMDB title', 'A provider switch cannot reuse the previous title payload');
    assert.equal((await tv.fetchSeasons(seriesId))[0].episodeCount, 6);
    assert.equal((await tv.fetchEpisodes(seriesId, 1))[0].id, `${seriesId}:1:3`, 'Provider changes preserve IDs used for watch history');
    assert.equal((await tv.fetchEpisodeDetails(seriesId, 1, 3)).title, 'TMDB episode');
    assert.equal((await (await episodesRoute.GET(seasonUrl(seriesId))).json())[0].title, 'TMDB episode');
    console.log('PASS: provider switches cover title headers, playback details, legacy IDs, seasons, episode lists, stills, autoplay and metadata caches.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
