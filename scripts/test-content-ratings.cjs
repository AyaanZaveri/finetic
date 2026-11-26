const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');

const movieDates = { results: [
    { iso_3166_1: 'GB', release_dates: [{ type: 3, certification: '15' }] },
    { iso_3166_1: 'US', release_dates: [
        { type: 4, certification: 'R' },
        { type: 3, certification: '' },
        { type: 3, certification: ' PG-13 ' },
    ] },
] };
const tvRatings = { results: [
    { iso_3166_1: 'GB', rating: '18' },
    { iso_3166_1: 'US', rating: '' },
    { iso_3166_1: 'US', rating: 'TV-MA' },
] };

async function main() {
    const calls = [];
    let token = 'fixture-token', failing = false;
    const fixtures = {
        'movie/123': { id: 123, title: 'Movie', release_dates: movieDates, vote_average: 8, vote_count: 5 },
        'tv/456': { id: 456, name: 'Show', content_ratings: tvRatings },
        'movie/123/release_dates': movieDates,
        'tv/456/content_ratings': tvRatings,
        'find/tt456': { tv_results: [{ id: 456 }] },
    };
    const tmdb = load('lib/tmdb-discovery.ts', {
        'server-only': {},
        '@/lib/tmdb-credentials': { getTMDBToken: async () => token },
        '@/lib/tmdb-artwork': { getTMDBArtwork: async () => undefined },
    }, {
        URLSearchParams, AbortSignal, Error,
        fetch: async (input, init) => {
            const url = new URL(input);
            assert.equal(url.origin, 'https://api.themoviedb.org');
            assert.equal(init.headers.Authorization, `Bearer ${token}`);
            assert.equal(init.next.revalidate, 86400);
            calls.push(url);
            const path = url.pathname.slice(3);
            assert.ok(fixtures[path], path);
            return failing ? new Response(null, { status: 503 }) : Response.json(fixtures[path]);
        },
    });
    const movie = await tmdb.tmdbMediaItem('tmdb:123', 'movie');
    assert.equal(movie.contentRating.value, 'PG-13');
    assert.equal(movie.contentRating.region, 'US');
    assert.equal(movie.communityRating, 8);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].searchParams.get('append_to_response'), 'external_ids,credits,release_dates');
    const show = await tmdb.tmdbMediaItem('tmdb:456', 'series');
    assert.equal(show.contentRating.value, 'TV-MA');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].searchParams.get('append_to_response'), 'external_ids,credits,content_ratings');

    assert.equal((await tmdb.getTMDBContentRating('tmdb:123', 'movie')).value, 'PG-13');
    assert.equal(calls.at(-1).pathname, '/3/movie/123/release_dates');
    assert.equal((await tmdb.getTMDBContentRating('tt456', 'series')).value, 'TV-MA');
    assert.equal(calls.at(-2).pathname, '/3/find/tt456');
    assert.equal(calls.at(-1).pathname, '/3/tv/456/content_ratings');
    failing = true;
    assert.equal(await tmdb.getTMDBContentRating('tmdb:123', 'movie'), undefined, 'An unavailable service is optional');
    token = undefined;
    const before = calls.length;
    assert.equal(await tmdb.getTMDBContentRating('tmdb:123', 'movie'), undefined);
    assert.equal(calls.length, before, 'No credential means no API requests');

    const { tmdbContentRating } = load('lib/media/content-rating.ts');
    for (const data of [
        {}, { release_dates: { results: null } },
        { release_dates: { results: [{ iso_3166_1: 'GB', release_dates: [{ certification: '15' }] }] } },
        { release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'NR' }] }] } },
    ]) assert.equal(tmdbContentRating(data, 'movie'), undefined);
    assert.equal(tmdbContentRating({ content_ratings: { results: [{ iso_3166_1: 'US', rating: 'N/A' }] } }, 'series'), undefined);

    const { titleEnvelope, metadataDetails } = load('lib/media/metadata.ts');
    const { projectPlaybackDetails } = load('lib/media/playback-details.ts');
    const roundTrip = metadataDetails(titleEnvelope(movie, Date.now()));
    assert.equal(roundTrip.contentRating.value, 'PG-13');
    assert.equal(roundTrip.communityRating, 8);
    assert.equal(projectPlaybackDetails(roundTrip).contentRating.value, 'PG-13');
    assert.equal(metadataDetails(titleEnvelope({ id: 'tt123', type: 'movie', name: 'Old title' }, Date.now())).contentRating, undefined);

    const h = hooks();
    const { ContentRatingBadge } = load('components/media-page/content-rating-badge.tsx', {
        'react/jsx-runtime': h.jsx, '@/components/ui/badge': { Badge: 'badge' },
    });
    assert.equal(ContentRatingBadge({}), null);
    assert.equal(ContentRatingBadge({ rating: movie.contentRating }).props.children, 'PG-13');
    assert.equal(ContentRatingBadge({ rating: show.contentRating, series: true }).props['aria-label'], 'US series age rating: TV-MA');
    console.log('PASS: movie and series certifications, no extra native TMDB lookups, optional enrichment, region, cache metadata and accessible badges.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
