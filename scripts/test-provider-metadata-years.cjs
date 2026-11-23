const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');
const cache = load('lib/server/metadata-cache.ts', { 'server-only': {} }, { Buffer });
const artwork = load('lib/artwork.ts', {}, { URLSearchParams });
let response;
const actions = load('app/actions/media.ts', {
    'server-only': {},
    '@/lib/server/auth': { getAuthData: async () => ({ authKey: 'fixture' }) },
    '@/lib/server/metadata-cache': cache,
    '@/lib/server/metadata-identity': { metadataIdentity: async () => ({ scope: 'fixture', revision: 'year-regression' }) },
    '@/lib/server/outbound-fetch': { outboundFetch: async () => Response.json({ meta: response }) },
    '@/lib/artwork': artwork, '@/lib/tmdb-artwork': { getTMDBArtwork: async () => undefined }, '@/lib/stremio-watched': {}, './tv-shows': {},
    '@/lib/tmdb-discovery': {},
    '@/lib/media-description': { completeMediaDescription: async item => item },
    './auth': { getInstalledAddons: async () => [{ transportUrl: 'https://provider.test/manifest.json', manifest: { resources: ['meta'] } }] },
}, { URLSearchParams, console: { error() {}, warn() {} } });
(async () => {
    // Cinemeta's actual shape: running shows have a string range, movies a string year.
    for (const [id, type, year, releaseInfo, expected] of [
        ['tt7587890', 'series', '2018–', '2018–', 2018],
        ['tt1442437', 'series', '2009–2020', '2009–2020', 2009],
        ['tt0816692', 'movie', '2014', '2014', 2014],
        ['numeric', 'movie', 2020, '2020', 2020],
        ['missing', 'series', undefined, '2017–', 2017],
        ['invalid', 'movie', 'unknown', undefined, undefined],
    ]) {
        response = { id, type, name: type === 'series' ? 'The Rookie' : 'Movie', year, releaseInfo, runtime: '44 min', cast: ['Actor'], imdbRating: '8.0' };
        const item = await actions.fetchMediaDetails(id, type);
        assert.equal(item.year, expected, `Header handles provider year ${year}`);
        assert.equal(item.releaseInfo, releaseInfo, 'Original release information is preserved');
    }
    console.log('PASS: real metadata readers accept provider string years, series ranges, numeric years and missing/invalid years before schema validation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
