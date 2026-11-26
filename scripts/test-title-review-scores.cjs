const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');

async function main() {
    const calls = [];
    const env = {};
    const movie = { id: 'tmdb:123', imdbId: 'tt123', type: 'movie', name: 'Movie', communityRating: 8.1, ratingSource: 'TMDB', voteCount: 200 };
    const show = { ...movie, id: 'tmdb:456', imdbId: 'tt456', type: 'series', name: 'Show' };
    let cinemetaRating = '7.3', cinemetaFails = false, mdbFails = false, mismatched = false, rt = 93;
    const dependencies = {
        'server-only': {},
        '@/lib/mdblist-credentials': { getMDBListKey: async () => env.MDBLIST_API_KEY },
        '@/lib/cinemeta': {
            cinemetaMetadata: async (type, id, signal) => {
                calls.push(['cinemeta', type, id]);
                assert.ok(signal);
                if (cinemetaFails) throw Error('Unavailable');
                return { id, name: 'Fixture', type, imdbRating: cinemetaRating };
            },
        },
    };
    const globals = {
        process: { env }, URLSearchParams, AbortSignal,
        fetch: async (input, init) => {
            const url = new URL(input);
            assert.equal(url.origin, 'https://api.mdblist.com');
            assert.equal(url.searchParams.get('apikey'), 'test-only-key');
            assert.equal(init.redirect, 'error');
            assert.equal(init.next.revalidate, 86400);
            assert.ok(init.signal);
            calls.push(['mdblist', url.pathname]);
            if (mdbFails) return new Response(null, { status: 429 });
            const [, , type, id] = url.pathname.split('/');
            return Response.json({
                ids: { imdb: mismatched ? 'tt999' : id }, type,
                ratings: [
                    { source: 'imdb', value: 7.8 },
                    { source: 'popcorn', value: 90 },
                    { source: 'tomatoes', value: rt },
                ],
            });
        },
    };
    const { enrichTitleReviewScores } = load('lib/server/title-review-scores.ts', dependencies, globals);
    const enriched = await enrichTitleReviewScores(movie);
    assert.equal(enriched.imdbRating, '7.3');
    assert.equal(enriched.communityRating, 8.1);
    assert.equal(enriched.rottenTomatoesRating, undefined);
    assert.deepEqual(calls, [['cinemeta', 'movie', 'tt123']]);
    await enrichTitleReviewScores({ ...movie, imdbRating: '7.1' });
    await enrichTitleReviewScores({ ...movie, imdbId: undefined });
    assert.equal(calls.length, 1, 'No request for a known IMDb rating or a missing IMDb ID');
    cinemetaFails = true;
    assert.equal((await enrichTitleReviewScores(movie)).imdbRating, undefined, 'TMDB remains the fallback when Cinemeta fails');
    cinemetaFails = false;
    cinemetaRating = 'N/A';
    assert.equal((await enrichTitleReviewScores(movie)).imdbRating, undefined, 'Invalid review scores never replace TMDB');

    env.MDBLIST_API_KEY = 'test-only-key';
    cinemetaRating = '7.3';
    const both = await enrichTitleReviewScores(movie);
    assert.equal(both.imdbRating, '7.3');
    assert.equal(both.rottenTomatoesRating, 93);
    assert.ok(calls.some(call => call[1] === '/imdb/movie/tt123'));
    rt = 0;
    cinemetaFails = true;
    const series = await enrichTitleReviewScores(show);
    assert.equal(series.imdbRating, '7.8', 'MDBList can supply IMDb if Cinemeta is unavailable');
    assert.equal(series.rottenTomatoesRating, 0, 'A genuine zero-percent critic score is not missing');
    assert.ok(calls.some(call => call[1] === '/imdb/show/tt456'));
    for (const invalid of [null, '93', -1, 101, 1.5]) {
        rt = invalid;
        assert.equal((await enrichTitleReviewScores(show)).rottenTomatoesRating, undefined);
    }
    rt = 93;
    mismatched = true;
    assert.equal((await enrichTitleReviewScores(show)).rottenTomatoesRating, undefined);
    mismatched = false;
    mdbFails = true;
    assert.equal((await enrichTitleReviewScores(show)).rottenTomatoesRating, undefined);

    const { titleEnvelope, metadataDetails } = load('lib/media/metadata.ts');
    const { projectPlaybackDetails } = load('lib/media/playback-details.ts');
    const roundTrip = metadataDetails(titleEnvelope(both, Date.now()));
    assert.equal(roundTrip.imdbRating, '7.3');
    assert.equal(roundTrip.communityRating, 8.1);
    assert.equal(roundTrip.rottenTomatoesRating, 93);
    assert.equal(projectPlaybackDetails(roundTrip).rottenTomatoesRating, 93);

    const metadataCache = load('lib/server/metadata-cache.ts', { 'server-only': {} }, { Buffer });
    let enrichments = 0;
    const actions = load('app/actions/media.ts', {
        ...dependencies,
        '@/lib/server/metadata-cache': metadataCache,
        '@/lib/server/metadata-identity': { metadataIdentity: async () => ({ scope: 'fixture', revision: 'review-scores', provider: 'tmdb', tmdbConfigured: true }) },
        '@/lib/server/auth': { getAuthData: async () => ({ authKey: 'fixture' }) },
        '@/lib/tmdb-discovery': { tmdbMediaItem: async () => movie },
        '@/lib/server/title-review-scores': { enrichTitleReviewScores: async () => { enrichments++; return both; } },
        '@/lib/server/outbound-fetch': {}, '@/lib/server/catalog-cache': {}, '@/lib/server/media-artwork': {},
        '@/lib/tmdb-artwork': {}, '@/lib/stremio-watched': {}, './tv-shows': {},
        './auth': { getInstalledAddons: async () => [] },
    }, { console: { error() {}, warn() {} } });
    assert.equal((await actions.fetchMediaDetails(movie.id, 'movie')).imdbRating, '7.3');
    assert.equal((await actions.fetchMediaDetails(movie.id, 'movie')).rottenTomatoesRating, 93);
    assert.equal(enrichments, 1, 'Header enrichment is cached');
    assert.equal((await actions.fetchMediaDetails(movie.id, 'movie', undefined, { playback: true })).imdbRating, undefined);
    assert.equal(enrichments, 1, 'Playback startup performs no additional review lookup');
    console.log('PASS: IMDb preferred over TMDB, optional MDBList critic scores, exact ID and type validation, fail-soft lookups and cached title-only enrichment.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
