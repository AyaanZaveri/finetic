const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function loader(globals, dependencies) {
    const modules = new Map();
    return function load(file) {
        if (modules.has(file)) return modules.get(file);
        const context = { exports: {}, ...globals, require: name => {
            if (dependencies[name]) return dependencies[name];
            if (name === 'server-only') return {};
            if (name.startsWith('node:')) return require(name);
            if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
            throw new Error(`Unexpected dependency ${name}`);
        } };
        vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
        }).outputText, context, { filename: file });
        modules.set(file, context.exports);
        return context.exports;
    };
}

async function main() {
    const live = process.argv.includes('--live');
    if (live) { try { process.loadEnvFile('.env'); } catch {} }
    let token = live ? process.env.TMDB_API_READ_ACCESS_TOKEN : 'private-test-token';
    if (live && !token) { console.log('SKIP: no TMDB token available for live checks.'); return; }
    const requests = [];
    let status = 200;
    let block = false;
    let getUser = async () => ({ _id: 'test' });
    const movie = { id: 123, media_type: 'movie', title: 'Example Film', release_date: '2020-01-02', overview: 'Movie overview', vote_average: 8, vote_count: 10, popularity: 100, poster_path: '/poster.jpg' };
    const show = { id: 20, media_type: 'tv', name: 'Example Show', first_air_date: '2021-01-01', overview: 'TV overview', vote_average: 7.65, vote_count: 1234, poster_path: null };
    const person = { id: 7, name: 'Example Person', profile_path: '/person.jpg', known_for_department: 'Directing', known_for: [movie] };
    const fixtures = {
        'search/multi': { page: 2, total_pages: 3, total_results: 50, results: [movie, show, { id: 7, media_type: 'person', name: 'Person' }] },
        'search/movie': { page: 1, total_pages: 1, total_results: 1, results: [movie] },
        'search/tv': { page: 1, total_pages: 1, total_results: 1, results: [show] },
        'search/person': { page: 1, total_pages: 1, total_results: 1, results: [person] },
        'movie/30': { id: 30, title: 'No IMDb mapping', external_ids: { imdb_id: null } },
        'tv/20/season/0': { episodes: [{ id: 99, name: 'Special', season_number: 0, episode_number: 1, air_date: '2021-01-01' }] },
        'movie/123/external_ids': { imdb_id: 'tt123' },
        'movie/30/external_ids': { imdb_id: null },
        'tv/20/external_ids': { imdb_id: 'tt20' },
        'tv/20/images': { logos: [{ file_path: '/show-logo.png', iso_639_1: 'en' }] },
        'movie/123/images': { logos: [{ file_path: '/movie-logo.png', iso_639_1: 'en' }] },
        'movie/30/images': { logos: [] },
        'find/tt123': { movie_results: [movie], tv_results: [] },
        'find/tt20': { movie_results: [], tv_results: [show] },
        'movie/123': { ...movie, runtime: 120, external_ids: { imdb_id: 'tt123' }, genres: [{ id: 1, name: 'Drama' }], credits: { cast: [{ ...person, character: 'Lead' }], crew: [{ ...person, job: 'Director' }] } },
        'tv/20': { ...show, external_ids: { imdb_id: 'tt20' }, seasons: [
            { id: 10, season_number: 0, name: 'Specials', episode_count: 1 },
            { id: 11, season_number: 1, name: 'Season 1', episode_count: 45 },
        ] },
        'tv/20/season/1': { episodes: Array.from({ length: 45 }, (_, i) => ({ id: 100 + i, name: `Episode ${i + 1}`, episode_number: i + 1, season_number: 1, overview: i === 1 ? 'The train arrives' : 'Ordinary episode', air_date: '2021-01-01', still_path: '/still.jpg' })) },
        'person/7': { ...person, biography: 'A documented biography.', birthday: '1970-01-01', also_known_as: ['Alias'], external_ids: { imdb_id: 'nm0000007' } },
        'person/7/combined_credits': {
            cast: [{ ...movie, character: 'Lead' }, { ...show, character: 'Guest' }],
            crew: [{ ...movie, job: 'Director' }, { ...movie, job: 'Writer' }, { ...show, job: 'Executive Producer' }],
        },
    };
    const globals = {
        Error, TypeError, SyntaxError, AbortSignal, AbortController, URL, URLSearchParams, Response, Request,
        setTimeout, clearTimeout, console: { log() {}, error() {}, warn() {} },
        fetch: live ? fetch : async (input, init) => {
            const url = new URL(input);
            assert.equal(url.origin, 'https://api.themoviedb.org');
            assert.equal(init.headers.Authorization, `Bearer ${token}`);
            assert.ok(init.signal);
            assert.equal(url.searchParams.has('api_key'), false, 'Credentials must never enter URLs');
            requests.push({ url, init });
            if (block) return await new Promise((_resolve, reject) => {
                if (init.signal.aborted) reject(init.signal.reason);
                else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
            });
            const key = url.pathname.replace('/3/', '');
            assert.ok(fixtures[key], `Unexpected TMDB endpoint: ${key}`);
            return new Response(JSON.stringify(fixtures[key]), { status });
        },
    };
    const streamCalls = [];
    const load = loader(globals, {
        ai: await import('ai'), zod: await import('zod'), react: require('react'),
        'next/cache': { unstable_cache: fn => fn },
        'node:fs': { promises: { readFile: async () => { throw new Error('No test cache'); }, writeFile: async () => {} } },
        '@/app/actions/media': {
            getStreamAddonTargets: async () => [{ id: 'test-addon', name: 'Test', transportUrl: 'https://addon.test/manifest.json' }],
            fetchStreamsFromAddon: async (...args) => { streamCalls.push(args); return [
                { url: 'https://stream.test/uncached.mp4', name: '[RD download] 1080p', title: '1080p H264 AAC WEB-DL' },
                { url: 'https://stream.test/unknown.mp4', name: '1080p', title: '1080p H264 AAC' },
                { url: 'https://stream.test/example.mp4', name: '[RD+] 720p' },
            ]; },
            fetchMediaDetails: async () => { throw new Error('Add-on metadata is forbidden for Ask Navigator'); },
        },
        '@/app/actions/search': { searchItems: async () => { throw new Error('Add-on search is forbidden'); } },
        '@/lib/tmdb-credentials': { getTMDBToken: async () => token },
        '@/lib/server/metadata-provider': { getMetadataProvider: async () => 'auto' },
        '@/lib/server/metadata-identity': { metadataIdentity: async () => ({ scope: 'fixture', revision: 'tmdb' }) },
        '@/lib/server/auth': { getAuthData: async () => ({ authKey: 'fixture' }) },
        '@/lib/server/outbound-fetch': { outboundFetch: async () => { throw new Error('Unexpected add-on metadata request'); } },
        './auth': { getInstalledAddons: async () => [] },
        '@/app/actions/auth': { getUser: () => getUser() },
    });
    const tmdb = load('lib/tmdb-discovery.ts');
    if (live) {
        const started = Date.now();
        const films = await tmdb.searchTMDBMedia('Interstellar', undefined, 'movie');
        const movieMs = Date.now() - started;
        assert.ok(films.results.length);
        const people = await tmdb.searchTMDBPeople('Christopher Nolan');
        assert.ok(people.results.length);
        const credits = await tmdb.getTMDBFilmography(people.results[0].id, { role: 'directing', mediaType: 'movie' });
        assert.ok(credits.results.length);
        const id = await tmdb.resolveTMDBPlaybackId(films.results[0].id, 'movie');
        assert.match(id, /^tt\d+$|^tmdb:\d+$/);
        console.log(`PASS: live TMDB movie search (${movieMs}ms), people search, directing credits, and playback ID resolution.`);
        return;
    }
    const clone = value => JSON.parse(JSON.stringify(value));
    const mixed = await tmdb.searchTMDBMedia('A&B / 日本語', undefined, undefined, 2);
    assert.equal(requests.length, 1, 'Search uses one TMDB request and no per-result lookups');
    assert.equal(requests[0].url.searchParams.get('query'), 'A&B / 日本語');
    assert.equal(requests[0].url.searchParams.get('include_adult'), 'false');
    assert.equal(requests[0].url.searchParams.get('page'), '2');
    assert.deepEqual(clone(mixed.results.map(item => item.type)), ['movie', 'series']);
    assert.equal(mixed.results[0].id, 'tmdb:123');
    assert.equal(mixed.results[0].ratingSource, 'TMDB');
    assert.equal(mixed.totalPages, 3);
    assert.equal((await tmdb.getTMDBTitle('tt123', 'movie')).people[0].id, 7);
    assert.equal(await tmdb.resolveTMDBPlaybackId('tmdb:123', 'movie'), 'tt123');
    assert.equal(await tmdb.resolveAddonMediaId('tmdb:20:1:2', 'series'), 'tt20:1:2', 'Translate only the selected episode and preserve its coordinates');
    assert.equal(await tmdb.resolveAddonMediaId('tmdb:123', 'movie'), 'tt123');
    assert.equal(await tmdb.resolveTMDBPlaybackId('tmdb:30', 'movie'), 'tmdb:30', 'Titles without IMDb IDs must not invent a mapping');
    fixtures['movie/123'].belongs_to_collection = { id: 42 };
    fixtures['collection/42'] = { name: 'Example Collection', parts: [
        movie, { id: 125, title: 'Later Film', release_date: '2024-01-01' },
        { id: 124, title: 'Earlier Film', release_date: '2019-01-01', backdrop_path: '/plain.jpg' },
    ] };
    fixtures['movie/124/images'] = { backdrops: [
        { file_path: '/plain.jpg', iso_639_1: null, vote_average: 10 },
        { file_path: '/english-low.jpg', iso_639_1: 'en', vote_average: 4 },
        { file_path: '/english.jpg', iso_639_1: 'en', vote_average: 8 },
    ] };
    fixtures['movie/125/images'] = { backdrops: [] };
    const collection = await tmdb.getTMDBMovieCollection('tt123');
    assert.equal(collection.name, 'Example Collection');
    assert.deepEqual(clone(collection.parts.map(part => part.item.id)), ['tmdb:124', 'tmdb:125']);
    assert.equal(collection.parts[0].backdrop, 'https://image.tmdb.org/t/p/w780/english.jpg');
    assert.equal(collection.parts[0].item.background, 'https://image.tmdb.org/t/p/w1280/plain.jpg');
    assert.equal(collection.parts[1].backdrop, undefined);
    assert.equal(await tmdb.getTMDBMovieCollection('tmdb:30'), null);
    status = 503;
    assert.equal(await tmdb.getTMDBMovieCollection('tmdb:123'), null);
    status = 200;
    fixtures['movie/123'].production_companies = [
        { id: 420, name: 'Marvel Studios', logo_path: '/marvel.png' },
        { id: 5, name: 'Columbia Pictures', logo_path: null },
        { id: -1, name: 'Invalid' },
    ];
    assert.deepEqual(clone(await tmdb.getTMDBProductionCompanies('tt123', 'movie')), [
        { id: 420, name: 'Marvel Studios', logo: 'https://image.tmdb.org/t/p/w300/marvel.png' },
        { id: 5, name: 'Columbia Pictures' },
    ]);
    assert.equal((await tmdb.getTMDBProductionCompanies('tmdb:30', 'movie')).length, 0);
    fixtures['tv/20'].production_companies = [
        { id: 11073, name: 'Sony Pictures Television', logo_path: '/sony.png' },
        { id: 33742, name: 'High Bridge Productions', logo_path: null },
    ];
    const tvCompanies = [
        { id: 11073, name: 'Sony Pictures Television', logo: 'https://image.tmdb.org/t/p/w300/sony.png' },
        { id: 33742, name: 'High Bridge Productions' },
    ];
    assert.deepEqual(clone(await tmdb.getTMDBProductionCompanies('tt20', 'series')), tvCompanies);
    assert.deepEqual(clone(await tmdb.getTMDBProductionCompanies('tmdb:20:1:2', 'series')), tvCompanies);
    assert.equal(requests.at(-1).url.pathname, '/3/tv/20', 'Episode routes use the parent series companies');
    status = 503;
    assert.equal((await tmdb.getTMDBProductionCompanies('tmdb:20', 'series')).length, 0);
    status = 200;
    const beforeIMDb = requests.length;
    assert.equal(await tmdb.resolveTMDBPlaybackId('tt123', 'movie'), 'tt123');
    assert.equal(requests.length, beforeIMDb, 'Known playback IDs need no further lookup');
    assert.equal((await tmdb.tmdbMediaItem('tmdb:30', 'movie')).name, 'No IMDb mapping');
    const ratedMovie = await tmdb.tmdbMediaItem('tmdb:123', 'movie');
    assert.equal(ratedMovie.communityRating, 8, 'Public title adapter must preserve TMDB ratings');
    assert.equal(ratedMovie.ratingSource, 'TMDB');
    assert.equal(ratedMovie.voteCount, 10);
    assert.equal(ratedMovie.imdbRating, undefined, 'TMDB scores must never be relabeled as IMDb');
    assert.equal((await tmdb.tmdbMediaItem('tmdb:30', 'movie')).communityRating, undefined, 'Unrated titles have no score');
    const beforeOverview = requests.length;
    const nativeShow = await tmdb.tmdbMediaItem('tmdb:20', 'series');
    assert.equal(nativeShow.communityRating, 7.65, 'Public series retain their TMDB rating');
    assert.equal(nativeShow.voteCount, 1234);
    assert.equal(nativeShow.videos, undefined, 'Title metadata cannot wait for every season');
    assert.equal(nativeShow.seasons.length, 2);
    assert.equal(nativeShow.seasons[0].number, 0);
    assert.equal(requests.length - beforeOverview, 2, 'Opening a TMDB show fetches its title and direct logo artwork');
    assert.equal(nativeShow.logo, 'https://image.tmdb.org/t/p/original/show-logo.png');
    const seasons = await tmdb.getTMDBSeasons('tmdb:20');
    assert.equal(seasons[1].id, 'tmdb:20:1');
    const episodes = await tmdb.getTMDBEpisodes('tmdb:20', 1);
    assert.equal(episodes[1].id, 'tmdb:20:1:2');
    assert.equal(episodes[1].title, 'Episode 2');
    assert.equal((await tmdb.searchTMDBPeople('Person')).results[0].knownFor[0].id, 'tmdb:123');
    const multi = await tmdb.searchTMDBCatalog('Person');
    assert.deepEqual(clone(multi.results.map(item => item.type)), ['movie', 'series', 'person'], 'Mixed results retain TMDB relevance including people');
    assert.equal(multi.results[2].id, '7');
    const peoplePage = await tmdb.searchTMDBCatalog('Person', undefined, 'person', 2);
    assert.equal(peoplePage.results[0].type, 'person');
    assert.equal(requests.at(-1).url.searchParams.get('page'), '2');
    fixtures['search/person'].results = [{ ...person, id: 99, known_for: [show] }, { ...person, known_for: [show, movie] }];
    const knownFor = await tmdb.getTMDBPersonKnownFor(7, 'Example Person');
    assert.deepEqual(clone(knownFor.map(item => item.id)), ['tmdb:20', 'tmdb:123'], 'Known for matches the person ID and preserves TMDB order instead of title popularity');
    assert.equal((await tmdb.getTMDBPersonKnownFor(8, 'Example Person')).length, 0, 'Do not borrow titles from a different person');
    fixtures['search/person'].results = [person];
    assert.match((await tmdb.getTMDBPerson(7)).biography, /documented/);
    const profile = await tmdb.getTMDBPerson(7);
    assert.equal(profile.imdbUrl, 'https://www.imdb.com/name/nm0000007/');
    assert.equal(profile.poster, 'https://image.tmdb.org/t/p/h632/person.jpg');
    assert.equal(requests.at(-1).url.searchParams.get('append_to_response'), 'external_ids');
    fixtures['person/7'].external_ids.imdb_id = 'javascript:alert(1)';
    assert.equal((await tmdb.getTMDBPerson(7)).imdbUrl, undefined, 'Only IMDb person IDs produce an external link');
    delete fixtures['person/7'].external_ids;
    assert.equal((await tmdb.getTMDBPerson(7)).imdbUrl, undefined, 'Missing external IDs preserve the profile');
    const credits = await tmdb.getTMDBFilmography(7);
    assert.equal(credits.totalResults, 2, 'Cast and crew credits deduplicate the same title');
    assert.equal(credits.results[0].type, 'series', 'Newest sorts by release or first-air date');
    assert.equal((await tmdb.getTMDBFilmography(7, { sort: 'popular' })).results[0].type, 'movie', 'Popularity sort can differ from release order');
    const showsOnly = await tmdb.getTMDBFilmography(7, { mediaType: 'series' });
    assert.equal(showsOnly.totalResults, 1);
    assert.equal(showsOnly.results[0].type, 'series');
    assert.deepEqual(clone(credits.results.find(item => item.type === 'movie').roles), ['Acting', 'Director', 'Writer']);
    const directors = await tmdb.getTMDBFilmography(7, { mediaType: 'movie', role: 'directing', limit: 1 });
    assert.equal(directors.totalResults, 1);
    assert.deepEqual(clone(directors.results[0].roles), ['Director']);
    const paged = await tmdb.getTMDBFilmography(7, { page: 2, limit: 1 });
    assert.equal(paged.results.length, 1);
    assert.equal(paged.totalPages, 2);
    assert.equal((await tmdb.getTMDBFilmography(7, { page: 3, limit: 1 })).results.length, 0);
    const savedCredits = fixtures['person/7/combined_credits'];
    fixtures['person/7/combined_credits'] = { crew: [{ ...movie, job: 'Director' }, { ...movie, id: -1 }, { ...show, adult: true }] };
    assert.equal((await tmdb.getTMDBFilmography(7)).totalResults, 1, 'Crew-only profiles work and invalid or adult titles are excluded');
    fixtures['person/7/combined_credits'] = {};
    assert.equal((await tmdb.getTMDBFilmography(7)).totalResults, 0, 'Empty credits produce an empty filmography');
    fixtures['person/7/combined_credits'] = savedCredits;
    const options = { toolCallId: 'test-tool', messages: [], abortSignal: new AbortController().signal };
    const peopleTools = load('app/tools/people.ts');
    assert.equal((await peopleTools.searchPeople.execute({ query: 'Person' }, options)).results[0].name, 'Example Person');
    assert.match((await peopleTools.getPersonDetails.execute({ personId: 7 }, options)).person.biography, /documented/);
    assert.equal((await peopleTools.getFilmography.execute({ personId: 7, role: 'directing', mediaType: 'Movie' }, options)).count, 1);
    const tvTools = load('app/tools/tv-shows.ts');
    const pageTwo = await tvTools.getEpisodes.execute({ seasonId: 'tmdb:20:1', page: 2 }, options);
    assert.equal(pageTwo.episodes.length, 5);
    assert.equal(pageTwo.episodes[0].episodeNumber, 41);
    assert.equal(pageTwo.totalPages, 2);
    const mediaTools = load('app/tools/media.ts');
    const matched = await mediaTools.findEpisodeByTitle.execute({ seriesQuery: 'Example Show', episodeTitle: 'train', seasonNumber: 1, limit: 3 }, options);
    assert.equal(matched.episodes[0].id, 'tmdb:20:1:2');
    const navigation = await mediaTools.navigateToMedia.execute({ mediaId: 'tmdb:20', seriesId: 'tmdb:20', seasonNumber: 1, episodeNumber: 2, mediaType: 'Episode' }, options);
    assert.equal(navigation.url, '/series/tt20/1/2');
    const streams = await mediaTools.getMediaStreams.execute({ mediaId: 'tmdb:20:1:2', mediaType: 'Episode' }, options);
    assert.equal(streams.mediaId, 'tt20:1:2');
    assert.equal(streams.streamCount, 3, 'Explicit stream choices retain add-on results instead of guessing debrid cache status');
    const selectedStream = streams.streams.find(stream => stream.name === '[RD+] 720p');
    assert.ok(selectedStream?.streamId);
    assert.equal(streamCalls[0][0], 'tt20:1:2', 'Stream add-ons must receive the selected episode playback ID');
    const play = await mediaTools.playMedia.execute({ mediaId: 'tmdb:20:1:2', mediaType: 'Episode', mediaName: 'Episode 2', streamId: selectedStream.streamId }, options);
    assert.equal(play.seriesId, 'tt20');
    assert.equal(play.mediaSourceId, 'tt20:1:2');
    assert.equal(play.streamUrl, 'https://stream.test/example.mp4');
    const metadata = await mediaTools.getMediaDetails.execute({ mediaId: 'tmdb:123', mediaType: 'Movie' }, options);
    assert.equal(metadata.details.source, 'TMDB');
    assert.equal(metadata.details.cast[0], 'Example Person');
    const titlePath = load('lib/navigator-title-path.ts').navigatorTitlePath;
    assert.match(titlePath('tmdb:20:1:2', 'episode'), /id=tmdb%3A20.*season=1.*episode=2/);
    assert.equal(titlePath('tt20:1:2', 'episode'), '/series/tt20/1/2');
    assert.equal(titlePath('tt20:0:2', 'episode'), '/series/tt20/0/2', 'Specials preserve season zero');
    assert.match(titlePath('tmdb:20:0:2', 'episode'), /season=0/);
    assert.equal(titlePath('7', 'person'), undefined, 'People must never become movie links');
    const { GET } = load('app/api/navigator/title/route.ts');
    const opened = await GET(new Request('http://localhost/api/navigator/title?id=tmdb:20&type=series&season=1&episode=2'));
    assert.equal(opened.headers.get('location'), 'http://localhost/series/tt20/1/2');
    assert.equal((await GET(new Request('http://localhost/api/navigator/title?id=tmdb:30&type=movie'))).headers.get('location'), 'http://localhost/movie/tmdb%3A30');
    assert.equal((await GET(new Request('http://localhost/api/navigator/title?id=https://evil.test&type=movie'))).status, 400);
    getUser = async () => null;
    assert.equal((await GET(new Request('http://localhost/api/navigator/title?id=tmdb:20&type=series'))).status, 401);
    token = '';
    const beforeMissing = requests.length;
    await assert.rejects(tmdb.searchTMDBMedia('Example'), /TMDB read access token/);
    assert.equal(requests.length, beforeMissing, 'Missing credentials must not fall back to add-ons');
    token = 'private-test-token'; status = 429;
    await assert.rejects(tmdb.searchTMDBMedia('Example'), /request limit/);
    status = 401;
    await assert.rejects(tmdb.searchTMDBMedia('Example'), /rejected the access token/);
    status = 200; block = true;
    const controller = new AbortController();
    const pending = tmdb.searchTMDBMedia('Example', controller.signal);
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    await assert.rejects(pending, /abort/i);
    let running = 0, peak = 0;
    await tmdb.mapTMDBSeasons([1, 2, 3, 4, 5, 6], async number => {
        running += 1; peak = Math.max(peak, running);
        await new Promise(resolve => setTimeout(resolve, 1)); running -= 1; return number;
    });
    assert.equal(peak, 4, 'Episode-title search must bound concurrent season requests');
    console.log('PASS: TMDB-only discovery, IDs, metadata, people, filmography roles and pagination, episode coordinates, selected-card redirects, token/rate-limit errors, cancellation, and bounded season fan-out.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
