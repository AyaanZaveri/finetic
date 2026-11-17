const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

async function main() {
    const ai = await import('ai');
    const zod = await import('zod');
    const modules = new Map();
    const jar = new Map();
    let signedIn = true;
    let status = 200;
    let fetchBody;
    const requests = [];
    const prompts = [];
    let mode = 'web';
    let expectParallel = false, researchStarted = false;
    const env = { TINYFISH_API_KEY: 'server-key', NODE_ENV: 'production', NAVIGATOR_DESKTOP: '1', HOSTNAME: '127.0.0.1' };
    const episodes = [
        ...Array.from({ length: 44 }, (_, index) => ({ id: `tmdb:58957:1:${index + 1}`, title: `Early episode ${index + 1}`, name: `Early episode ${index + 1}`, season: 1, episode: index + 1 })),
        { id: 'tmdb:58957:4:4', name: 'The Anecdote', title: 'The Anecdote', season: 4, episode: 4, overview: 'Nathan hones his storytelling skills.' },
        { id: 'tmdb:58957:4:7', name: 'Finding Frances', title: 'Finding Frances', season: 4, episode: 7, overview: 'A Bill Gates impersonator finds his long-lost love.' },
    ];
    let extraOverview = '';
    const source = { id: 'web:1', title: 'Episode guide', url: 'https://example.com/guide', text: 'S4E5: The Anecdote. Nathan prepares an anecdote for Jimmy Kimmel Live.' };
    let catalogName = 'Nathan for You';
    const titleSearches = [];
    let showCandidates = [{ id: 'tmdb:58957', name: 'Nathan for You' }];
    const overrides = {
        'server-only': {},
        ai: { ...ai, generateText: async options => {
            prompts.push(options.prompt);
            if (options.prompt.startsWith('Resolve a possibly misspelled')) return { output: { title: 'Late Bloomer', sourceId: 'web:1', quote: mode === 'title-repair-invalid' ? 'invented title evidence' : 'Late Bloomer' } };
            if (options.prompt.startsWith('Write one complementary')) return { output: { query: mode === 'bad-refinement' ? '`' : '"Late Bloomer" translated dialogue scene' } };
            const isWeb = options.prompt.includes('web:1');
            if (expectParallel && !isWeb) assert.ok(researchStarted, 'Scene research starts before metadata assessment finishes');
            const eligible = options.prompt.split('Evidence sources:')[0].includes('tmdb:58957:4:4');
            if (mode === 'clue-only' && isWeb) return { output: { status: 'not_found', evidence: [], clueEvidence: [{ passageId: 'web:1:p1' }] } };
            if (mode === 'fake') return { output: { status: 'matched', clueEvidence: [], evidence: [{ episodeId: 'tmdb:58957:4:4', passageId: 'web:1:p999' }] } };
            if (mode === 'wrong-id') return { output: { status: 'matched', clueEvidence: [], evidence: [{ episodeId: 'tmdb:58957:4:5', passageId: 'web:1:p1' }] } };
            if (mode === 'metadata-ambiguous' && !isWeb && eligible) return { output: { status: 'ambiguous', clueEvidence: [], evidence: episodes.slice(-2).map(ep => ({ episodeId: ep.id, passageId: `${ep.id}:p1` })) } };
            if (mode === 'ambiguous' && isWeb) return { output: { status: 'ambiguous', clueEvidence: [], evidence: [
                { episodeId: 'tmdb:58957:4:4', passageId: 'web:1:p1' },
                { episodeId: 'tmdb:58957:4:7', passageId: 'web:1:p1' },
            ] } };
            if (mode === 'late-clue' && eligible) return { output: { status: 'matched', clueEvidence: [], evidence: [{ episodeId: 'tmdb:58957:4:4', passageId: 'tmdb:58957:4:4:p1' }] } };
            return { output: { status: isWeb && eligible && mode !== 'none' ? 'matched' : 'not_found', clueEvidence: [], evidence: isWeb && eligible && mode !== 'none'
                ? [{ episodeId: 'tmdb:58957:4:4', passageId: `${source.id}:p1` }] : [] } };
        } },
        zod,
        'next/headers': { cookies: async () => ({ get: key => jar.get(key), set: (key, value, options) => jar.set(key, { value, options }), delete: key => jar.delete(key) }) },
        '@/app/actions/auth': { getUser: async () => signedIn ? { _id: 'test' } : null },
        '@/lib/server/auth': { getAuthData: async () => { if (!signedIn) throw new Error('Sign in'); return { user: { _id: 'test' } }; } },
        '@/lib/tmdb-discovery': {
            getTMDBTitle: async () => ({ id: 'tmdb:58957', name: catalogName, poster: 'https://image.tmdb.org/t/p/w500/show.jpg', year: 2013, genres: ['Comedy'], communityRating: 8.1 }),
            searchTMDBMedia: async query => { titleSearches.push(query); return { results: query === 'Late Bloomers' ? [] : showCandidates }; },
            getTMDBSeasons: async () => [{ number: 1 }, { number: 4 }],
            getTMDBEpisodes: async (_, season) => episodes.filter(e => e.season === season).map(e => ({ ...e, overview: e.overview + (e.episode === 4 && e.season === 4 ? extraOverview : '') })),
            mapTMDBSeasons: async (seasons, load, signal) => { signal?.throwIfAborted(); return Promise.all(seasons.map(load)); },
        },
    };
    function load(file) {
        const absolute = path.resolve(file);
        if (modules.has(absolute)) return modules.get(absolute).exports;
        const module = { exports: {} }; modules.set(absolute, module);
        const context = { module, exports: module.exports, process: { env }, console, URL, URLSearchParams, AbortSignal, AbortController, setTimeout, clearTimeout,
            fetch: async (url, init) => { requests.push({ url, init }); return new Response(JSON.stringify(typeof fetchBody === 'function' ? await fetchBody(url) : fetchBody || { results: [{ title: 'Guide', url: 'https://example.com/guide' }] }), { status }); },
            require: name => overrides[name] || (name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name)),
        };
        vm.runInNewContext(ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context, { filename: absolute });
        return module.exports;
    }
    const { resolveEpisode } = load('lib/episode-discovery.ts');
    const { refineEpisodeWebQuery, episodeWebQuery } = load('lib/episode-web-plan.ts');
    mode = 'bad-refinement';
    assert.equal(await refineEpisodeWebQuery('Nathan for You', 'a remembered episode clue', [], { modelId: 'mock', provider: 'mock' }), episodeWebQuery('Nathan for You', 'a remembered episode clue'), 'Formatting-only refinements must retain the meaningful original search query');
    mode = 'web';
    const { indexEvidence, resolveEvidencePassage } = load('lib/navigator-evidence.ts');
    const longEvidence = [{ id: 'long:source', title: 'Full source', url: 'https://example.com/full', text: `${'αβγ '.repeat(1400)}TAIL_MARKER` }];
    const indexedLong = indexEvidence(longEvidence);
    assert.equal(indexedLong[0].passages.map(passage => passage.text).join(''), longEvidence[0].text, 'Passage indexing must preserve long evidence, Unicode, and late clues without truncation');
    assert.equal(indexedLong[0].passages.every(passage => passage.text.length <= 1200), true);
    assert.equal(resolveEvidencePassage(longEvidence, indexedLong, 'invented:p1'), null, 'Only server-issued source passage IDs can resolve to quotations');
    const lastPassage = indexedLong[0].passages.at(-1);
    assert.equal(resolveEvidencePassage(longEvidence, indexedLong, lastPassage.id).quote.endsWith('TAIL_MARKER'), true);
    const input = { seriesQuery: 'Nathan for You', episodeQuery: 'where he goes on Jimmy Kimmel' };
    let webCalls = 0;
    const research = async () => { webCalls++; return [source]; };
    const progress = [];
    let result = await resolveEpisode(input, { model: { modelId: 'mock', provider: 'mock' }, research, onProgress: value => progress.push(value) });
    const catalog = progress.find(value => value.stage === 'episodes' && value.state === 'completed').catalog;
    assert.equal(catalog.poster, 'https://image.tmdb.org/t/p/w500/show.jpg', 'The metadata card receives the resolved show poster');
    assert.equal(catalog.year, 2013);
    assert.equal(catalog.communityRating, 8.1);
    assert.equal(catalog.genres[0], 'Comedy');
    assert.equal(result.status, 'matched');
    assert.equal(result.episodes[0].id, 'tmdb:58957:4:4', 'Map identity/title to TMDB, not the external S4E5');
    assert.equal(result.evidence[0].quote, source.text, 'The server reconstructs the original source quotation from a supplied passage ID');
    assert.equal(webCalls, 1);
    assert.ok(prompts.some(prompt => prompt.includes('Early episode 44')), 'Episodes beyond the first 40 must be assessed');
    assert.ok(!result.episodes.some(ep => ep.id.endsWith(':4:7')), 'Finding Frances must never be a filler candidate');
    result = await resolveEpisode(input, { model: { modelId: 'mock', provider: 'mock' } });
    assert.equal(result.success, false);
    assert.equal(result.episodes.length, 0, 'No-score ties must not return the earliest ten episodes');
    assert.match(result.message, /Settings/);
    extraOverview = 'x'.repeat(350) + ' Jimmy Kimmel appears in this episode.';
    mode = 'late-clue';
    result = await resolveEpisode(input, { model: { modelId: 'mock', provider: 'mock' }, research });
    assert.equal(result.status, 'matched');
    assert.equal(webCalls, 1, 'A supported metadata match must not search the web');
    extraOverview = '';
    for (mode of ['fake', 'wrong-id', 'none']) {
        result = await resolveEpisode(input, { model: { modelId: 'mock', provider: 'mock' }, research });
        assert.equal(result.success, false, `Reject ${mode} evidence`);
    }
    mode = 'ambiguous';
    result = await resolveEpisode(input, { model: { modelId: 'mock', provider: 'mock' }, research });
    assert.equal(result.status, 'ambiguous'); assert.equal(result.success, false);
    mode = 'metadata-ambiguous';
    result = await resolveEpisode(input, { model: { modelId: 'mock', provider: 'mock' }, research });
    assert.equal(result.status, 'matched', 'Use web evidence to resolve weak metadata ambiguity');
    assert.equal(result.episodes[0].id, 'tmdb:58957:4:4');
    const calls = webCalls;
    expectParallel = true;
    researchStarted = false;
    const scenePromptStart = prompts.length;
    await resolveEpisode(input, { model: { modelId: 'mock', provider: 'mock' }, prefetchResearch: true, research: async () => { researchStarted = true; return [source]; } });
    expectParallel = false;
    assert.equal(researchStarted, true);
    const sceneAssessments = prompts.slice(scenePromptStart).filter(prompt => prompt.startsWith('Identify the episode'));
    assert.ok(sceneAssessments.length > 0 && sceneAssessments.every(prompt => prompt.includes('web:1')), 'Scene lookup verifies web evidence instead of accepting a metadata-only teaser');
    result = await resolveEpisode({ ...input, episodeQuery: 'The Anecdote', seasonNumber: 4 }, { research });
    assert.equal(result.status, 'matched'); assert.equal(webCalls, calls, 'Exact titles need no model or web search');
    showCandidates = [{ id: 'tmdb:58957', name: 'Nathan for You', voteCount: 5000 }, { id: 'tmdb:999', name: 'Nathan for You', voteCount: 3 }];
    result = await resolveEpisode({ ...input, episodeQuery: 'The Anecdote' });
    assert.equal(result.success, true, 'Obscure namesakes must not block a dominant TV title');
    showCandidates[1].voteCount = 3000;
    result = await resolveEpisode({ ...input, episodeQuery: 'The Anecdote' });
    assert.equal(result.status, 'ambiguous', 'Two substantial same-named shows still need clarification');
    showCandidates = [{ id: 'tmdb:58957', name: 'Nathan for You' }];
    result = await resolveEpisode({ ...input, episodeQuery: 'The Anecdote', seasonNumber: 99 });
    assert.equal(result.status, 'not_found');
    assert.match(result.error, /Season 99.*Nathan for You/, 'Identify the invalid restriction instead of claiming the show has no episodes');
    mode = 'clue-only';
    result = await resolveEpisode({ ...input, episodeQuery: 'where she says "a remembered line"' }, { model: { modelId: 'mock', provider: 'mock' }, research });
    assert.equal(result.success, false, 'Finding the clue is not proof of an episode');
    assert.ok(result.clueEvidence.length > 0, 'Keep useful verified scene sources even without an episode');
    assert.match(result.message, /found a source matching/);
    mode = 'title-repair';
    catalogName = 'Late Bloomer';
    showCandidates = [{ id: 'tmdb:58957', name: 'Late Bloomer' }];
    const savedText = source.text;
    source.title = 'Late Bloomer (TV series)';
    source.text = 'The Anecdote contains the quoted dialogue.';
    const beforeRepair = webCalls;
    const beforePrompts = prompts.length;
    result = await resolveEpisode({ seriesQuery: 'Late Bloomers', episodeQuery: 'where she says "a remembered quote"' }, { model: { modelId: 'mock', provider: 'mock' }, research });
    assert.equal(result.success, true, 'Recover a title typo through web evidence before asking the user');
    assert.equal(result.seriesName, 'Late Bloomer');
    assert.deepEqual(titleSearches.slice(-2), ['Late Bloomers', 'Late Bloomer']);
    assert.equal(webCalls, beforeRepair + 2, 'Use separate title-repair and dialogue queries without refetching either during verification');
    assert.ok(prompts.slice(beforePrompts).filter(p => p.startsWith('Identify the episode')).every(p => p.includes('web:1')), 'Quoted dialogue goes straight to web evidence instead of a wasted metadata-model pass');
    mode = 'title-repair-invalid';
    result = await resolveEpisode({ seriesQuery: 'Late Bloomers', episodeQuery: 'where she says "a remembered quote"' }, { model: { modelId: 'mock', provider: 'mock' }, research });
    assert.equal(result.success, false, 'A correction needs a real verbatim source, not model memory');
    source.text = savedText;
    const controller = new AbortController(); controller.abort();
    await assert.rejects(resolveEpisode(input, { signal: controller.signal }), /abort/i);

    const tinyfish = load('lib/tinyfish.ts');
    const settings = load('app/actions/web-search-settings.ts');
    const credentials = load('lib/tinyfish-credentials.ts');
    assert.equal((await settings.getWebSearchSettings()).configured, true);
    assert.ok(!JSON.stringify(await settings.getWebSearchSettings()).includes('server-key'));
    assert.equal((await settings.saveWebSearchKey('bad\r\nheader')).success, false);
    assert.equal(requests.length, 0);
    assert.equal((await settings.saveWebSearchKey(' personal-key ')).success, true);
    assert.equal((await credentials.getTinyfishConfig()).apiKey, 'personal-key');
    assert.equal(jar.get(credentials.TINYFISH_KEY_COOKIE).options.httpOnly, true);
    assert.equal(jar.get(credentials.TINYFISH_KEY_COOKIE).options.secure, false);
    assert.equal(requests[0].init.headers['X-API-Key'], 'personal-key');
    assert.ok(!requests[0].url.includes('personal-key'));
    assert.ok(new URL(requests[0].url).searchParams.get('purpose'));
    status = 401;
    assert.equal((await settings.saveWebSearchKey('rejected')).success, false);
    assert.equal((await credentials.getTinyfishConfig()).apiKey, 'personal-key', 'Failed replacement retains working key');
    status = 200;
    await settings.setWebSearchEnabled(false);
    assert.equal((await credentials.getTinyfishConfig()).enabled, false);
    await settings.removeWebSearchKey();
    assert.equal((await credentials.getTinyfishConfig()).apiKey, 'server-key');
    signedIn = false;
    assert.equal((await settings.saveWebSearchKey('no')).success, false);
    assert.equal((await settings.setWebSearchEnabled(true)).success, false);
    await assert.rejects(settings.getWebSearchSettings(), /Sign in/);
    signedIn = true;
    fetchBody = { results: [{ title: 'Private', url: 'https://127.0.0.1/private' }, { title: 'Guide', url: 'https://example.com/guide' }] };
    const search = await tinyfish.searchTinyfish('query', 'purpose', 'key');
    assert.equal(search.length, 1);
    fetchBody = url => url.includes('api.search.') ? { results: [{ title: 'Good', url: 'https://example.com/good' }, { title: 'Bad', url: 'https://example.com/bad' }] }
        : { results: [{ url: 'https://example.com/good', title: 'Guide', text: 'The Anecdote features Jimmy Kimmel.' }], errors: [{ url: 'https://example.com/bad', error: 'timeout', status: 504 }] };
    const partial = await tinyfish.researchMediaWeb('Jimmy Kimmel', 'Find the episode', 'key');
    assert.equal(partial.length, 1, 'Successful source survives a sibling failure');
    const fetchRequest = requests.findLast(request => request.url === 'https://api.fetch.tinyfish.ai/');
    assert.equal(JSON.parse(fetchRequest.init.body).urls.length, 2);
    assert.equal(JSON.parse(fetchRequest.init.body).highlights, undefined, 'No account-gated highlights dependency');
    fetchBody = url => url.includes('api.search.') ? { results: [{ title: 'Bad', url: 'https://example.com/bad' }] }
        : { results: [], errors: [{ url: 'https://example.com/bad', error: 'blocked' }] };
    await assert.rejects(tinyfish.researchMediaWeb('Jimmy Kimmel', 'Find the episode', 'key'), /could not read/);
    let finishRead;
    let readStarted;
    const reading = new Promise(resolve => { readStarted = resolve; });
    const tenResults = Array.from({ length: 10 }, (_, i) => ({ title: `Result ${i + 1}`, position: i + 1, snippet: 'TV series', url: `https://example.com/${i}` }));
    fetchBody = async url => {
        if (url.includes('api.search.')) return { results: tenResults };
        readStarted();
        return new Promise(resolve => { finishRead = resolve; });
    };
    let visibleResults;
    const pendingResearch = tinyfish.researchMediaWeb('TV series', 'Find evidence', 'key', undefined, results => { visibleResults = results; });
    await reading;
    assert.equal(visibleResults.length, 10, 'Publish all ten search hits before waiting for page reads');
    finishRead({ results: [{ url: 'https://example.com/0', title: 'Page', text: 'Evidence' }] });
    await pendingResearch;
    const beforeDirectSearch = requests.length;
    const directResults = await tinyfish.searchTinyfish('TV series', 'Find results only', 'key');
    assert.equal(directResults.length, 10);
    assert.equal(requests.length, beforeDirectSearch + 1, 'Fast search makes exactly one request and never fetches pages');
    assert.equal(requests.at(-1).init.method, 'GET');
    const searchUrl = new URL(requests.at(-1).url);
    assert.equal(searchUrl.origin, 'https://api.search.tinyfish.ai');
    assert.equal(searchUrl.searchParams.get('purpose'), 'Find results only');
    const ranked = tinyfish.rankMediaSources([
        { title: 'Late Bloomer episode guide', url: 'https://en.wikipedia.org/guide', snippet: 'All seasons and episode titles.' },
        { title: 'Scene clip: Main bahar ja rahi hoon bitch', url: 'https://www.instagram.com/reel/clip', snippet: 'Late Bloomer dialogue.' },
    ], '"Late Bloomer" main bahar ja rahi hoon bitch episode');
    assert.match(ranked[0].url, /instagram/, 'Dialogue relevance outranks a generic reference page; social clips are not penalized');
    const longText = 'Unrelated introduction.\n'.repeat(1000) + 'The Anecdote: Jimmy Kimmel Live is the key clue.';
    assert.ok(tinyfish.webPassages(longText, 'Jimmy Kimmel').includes('The Anecdote: Jimmy Kimmel'));
    assert.ok(tinyfish.webPassages(longText, 'Jimmy Kimmel').length < longText.length);
    console.log('PASS: evidence-backed episode identity, full catalogs/overviews, ambiguity/no-match, cancellation, TinyFish credentials and optional search.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
