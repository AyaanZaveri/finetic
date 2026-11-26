const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');

async function main() {
    const today = new Date().toISOString().slice(0, 10);
    const calls = [];
    let useTMDB = true;
    let failMovie = false, failSeries = false, empty = false;
    const records = (type) => {
        const dateKey = type === 'movie' ? 'release_date' : 'first_air_date';
        const title = (id, date, votes = 100, extra = {}) => ({
            id, title: `Title ${id}`, [dateKey]: date, vote_count: votes,
            vote_average: 8, backdrop_path: '/backdrop.jpg', ...extra,
        });
        return empty ? [] : [
            title(1, '9999-01-01'), title(2, undefined), title(3, '2020-02-31'),
            title(4, '2020-01-01', 2), title(5, '2020-01-01', 100, { adult: true }),
            title(6, '2020-01-01', 100, { backdrop_path: null }),
            title(7, today), title(8, '2020-01-01'), title(9, '2020-01-01'), title(10, '2020-01-01'),
        ];
    };
    const discovery = load('lib/tmdb-discovery.ts', {
        'server-only': {}, '@/lib/tmdb-artwork': {},
        '@/lib/tmdb-credentials': { getTMDBToken: async () => 'test-token' },
    }, {
        process: { env: { TMDB_WATCH_REGION: 'ca' } }, URLSearchParams, Error,
        fetch: async input => {
            const url = new URL(input);
            calls.push(url);
            const movie = url.pathname.endsWith('/movie');
            if (movie ? failMovie : failSeries) return new Response(null, { status: 503 });
            return Response.json({ results: records(movie ? 'movie' : 'tv') });
        },
    });
    const fallbackCalls = [];
    const cinemeta = load('lib/cinemeta.ts', { 'server-only': {}, react: { cache: fn => fn } }, {
        fetch: async input => {
            const type = input.includes('/movie/') ? 'movie' : 'series';
            fallbackCalls.push(type);
            const title = (id, released, rating = '8.2') => ({
                id: `tt${id}`, type, name: `Title ${id}`, released, releaseInfo: '2020', imdbRating: rating,
                background: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
            });
            return Response.json({ metas: [title(101, '9999-01-01T00:00:00.000Z'), title(102, null),
                title(103, '2020-01-01T00:00:00.000Z', ''), title(104, '2020-01-01T00:00:00.000Z'),
                title(105, '2020-01-01T00:00:00.000Z'), title(106, '2020-01-01T00:00:00.000Z')] });
        },
    });
    const { loadHomeHeroItems } = load('lib/server/home-hero.ts', {
        'server-only': {}, '@/lib/discovery': { hasTMDBDiscovery: async () => useTMDB },
        '@/lib/tmdb-discovery': discovery, '@/lib/cinemeta': cinemeta,
        '@/lib/tmdb-artwork': { getTMDBArtwork: async () => undefined },
    });
    const keys = items => Array.from(items, item => `${item.type}:${item.id}`);
    assert.deepEqual(keys(await loadHomeHeroItems()), [
        'movie:tmdb:7', 'series:tmdb:7', 'movie:tmdb:8', 'series:tmdb:8', 'movie:tmdb:9', 'series:tmdb:9',
    ], 'Hero excludes upcoming, undated, invalid, low-vote, adult and artless titles while keeping ranked results');
    assert.deepEqual(calls.map(url => url.pathname), ['/3/discover/movie', '/3/discover/tv']);
    for (const url of calls) {
        assert.equal(url.searchParams.get('watch_region'), 'CA');
        assert.equal(url.searchParams.get('with_watch_monetization_types'), 'flatrate|free|ads');
        assert.equal(url.searchParams.get('sort_by'), 'popularity.desc');
        assert.equal(url.searchParams.get('vote_count.gte'), '30');
        assert.equal(url.searchParams.get(url.pathname.endsWith('/movie') ? 'primary_release_date.lte' : 'first_air_date.lte'), today);
        assert.equal(url.searchParams.has('with_watch_providers'), false, 'Not tied to a single provider');
    }
    failMovie = true;
    assert.ok((await loadHomeHeroItems()).every(item => item.type === 'series'), 'One failed feed does not hide the other');
    failSeries = true;
    assert.equal(await loadHomeHeroItems(), null, 'A failed refresh preserves the valid cached hero');
    failMovie = failSeries = false;
    empty = true;
    assert.equal((await loadHomeHeroItems()).length, 0, 'An empty successful feed clears cached items');
    useTMDB = false;
    assert.deepEqual(keys(await loadHomeHeroItems()), [
        'movie:tt104', 'series:tt104', 'movie:tt105', 'series:tt105', 'movie:tt106', 'series:tt106',
    ], 'Cinemeta fallback excludes future, unknown-date and unrated items');
    assert.deepEqual(fallbackCalls, ['movie', 'series']);
    console.log('PASS: dedicated regional streaming hero, release checks, Cinemeta fallback, feed failure and six-title mix');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
