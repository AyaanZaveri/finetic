const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

async function main() {
  const zod = await import('zod');
  const ai = await import('ai');
  const modules = new Map();
  let webSearches = 0, pageReads = 0, assessments = 0;
  let fakePassage = false;
  const episodes = [
    { id: 'tmdb:58957:2:5', title: 'Dumb Starbucks', season: 2, episode: 5, overview: 'Nathan opens a parody coffee shop.' },
    { id: 'tmdb:58957:4:4', title: 'The Anecdote', season: 4, episode: 4, overview: 'Nathan prepares a story.' },
  ];
  const overrides = {
    'server-only': {}, zod,
    '@/lib/discovery': { hasTMDBDiscovery: async () => true },
    '@/app/actions/tv-shows': { fetchEpisodeDetails: async (_id, season, episode) =>
      episodes.find(item => item.season === season && item.episode === episode) },
    ai: { ...ai, generateText: async options => {
      assessments++;
      const sources = JSON.parse(options.prompt.split('Evidence sources: ')[1]);
      return { output: { status: 'matched', clueEvidence: [], evidence: [{ episodeId: episodes[0].id, passageId: fakePassage ? 'invented:p1' : sources[0].passages[0].id }] } };
    } },
    '@/lib/tmdb-discovery': {
      getTMDBTitle: async () => ({ id: 'tmdb:58957', name: 'Nathan for You', seasons: [{ number: 2 }, { number: 4 }] }),
      getTMDBSeasons: async () => [{ number: 2 }, { number: 4 }],
      getTMDBEpisodes: async (_, season) => episodes.filter(ep => ep.season === season),
      mapTMDBSeasons: async (seasons, load) => Promise.all(seasons.map(load)),
    },
    '@/lib/tinyfish-credentials': { getTinyfishConfig: async () => ({ enabled: true, apiKey: 'fixture-key' }) },
    '@/lib/tinyfish': {
      searchTinyfish: async query => { webSearches++; return [{ title: 'Discussion', url: 'https://example.com/scene', snippet: query }]; },
      fetchMediaWebSources: async urls => { pageReads += urls.length; return urls.map((url, i) => ({ id: `web:${i + 1}`, url, title: 'Dumb Starbucks discussion', text: 'In Dumb Starbucks, Nathan snatches the paper from the lawyer.' })); },
      researchMediaWeb: async () => { throw new Error('Agent research must not call an opaque search plan'); },
    },
  };
  function load(file) {
    const absolute = path.resolve(file);
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const module = { exports: {} }; modules.set(absolute, module);
    const requireLocal = name => overrides[name] || (name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name));
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
      { module, exports: module.exports, require: requireLocal, console, process: { env: {} }, AbortSignal, AbortController, URL, crypto, setTimeout, clearTimeout }, { filename: absolute });
    return module.exports;
  }
  const { createEpisodeResearch } = load('lib/episode-research.ts');
  const model = { provider: 'mock', modelId: 'mock' };
  const request = 'Go to the peisode of Nathan for u where he takes the paper frlm the laywer';
  const session = createEpisodeResearch(model, request);
  const catalog = await session.catalog('tmdb:58957');
  assert.equal(catalog.episodes.length, 2, 'The agent can inspect every season without an opaque plot matcher');
  assert.equal(webSearches, 0); assert.equal(assessments, 0);
  await session.search('Nathan for You lawyer paper', 'Find the episode');
  assert.equal(webSearches, 1);
  const first = await session.read(['https://example.com/scene'], 'Find the paper scene');
  const second = await session.read(['https://example.com/recap'], 'Corroborate the episode');
  assert.notEqual(first[0].id, second[0].id, 'Source IDs stay unique across independent fetch batches');
  const cached = await session.read(['https://example.com/scene'], 'Read again');
  assert.equal(cached[0].id, first[0].id); assert.equal(pageReads, 2, 'Reading a known page reuses request-scoped evidence');
  const before = assessments;
  const invented = await session.verify({ seriesId: 'tmdb:58957', episodeId: episodes[0].id, episodeQuery: 'paper', sourceIds: ['invented'] });
  assert.equal(invented.success, false); assert.equal(assessments, before, 'Unfetched sources cannot reach the verifier');
  const verified = await session.verify({ seriesId: 'tmdb:58957', episodeId: episodes[0].id, episodeQuery: 'paper', sourceIds: [first[0].id, second[0].id] });
  assert.equal(verified.success, true); assert.equal(verified.episodes[0].id, episodes[0].id);
  assert.equal(verified.evidence[0].quote, first[0].text, 'Evidence is reconstructed from an actual page passage');
  assert.equal(session.verified(episodes[0].id), verified);
  assert.equal(session.verified(episodes[1].id), undefined, 'A verified episode cannot authorize another one');
  fakePassage = true;
  const fresh = createEpisodeResearch(model, request);
  const page = await fresh.read(['https://example.com/scene'], 'Find the scene');
  const fake = await fresh.verify({ seriesId: 'tmdb:58957', episodeId: episodes[0].id, episodeQuery: 'paper', sourceIds: [page[0].id] });
  assert.equal(fake.success, false); assert.equal(fresh.verified(episodes[0].id), undefined, 'Invented model citations cannot prepare an action');
  fakePassage = false;
  const unknownEpisode = await fresh.verify({ seriesId: 'tmdb:58957', episodeId: 'tmdb:58957:99:99', episodeQuery: 'paper', sourceIds: [page[0].id] });
  assert.equal(unknownEpisode.success, false, 'The selected ID must exist in the real catalog');
  const isolated = createEpisodeResearch(model, request);
  assert.equal(isolated.verified(episodes[0].id), undefined, 'Proofs and page caches never leak between requests');
  for (let i = 0; i < 4; i++) await isolated.search(`query ${i}`, 'Find an episode');
  await assert.rejects(isolated.search('one too many', 'Find an episode'), /budget/i);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(isolated.catalog('tmdb:58957', cancelled.signal), /abort/i);
  let navigations = 0;
  overrides['./media'] = {
    navigateToMedia: { execute: async input => { navigations++; return { success: true, mediaId: input.mediaId }; } },
    navigateToEpisode: {}, playMedia: {}, playMediaInputSchema: zod.z.object({}),
  };
  const tools = load('app/tools/episodes.ts').createEpisodeTools(model, request);
  const toolOptions = { toolCallId: 'proof-test', messages: [] };
  const fetched = await tools.readMediaWebSources.execute({ urls: ['https://example.com/scene'], question: 'paper scene' }, toolOptions);
  const proof = await tools.verifyEpisode.execute({ seriesId: 'tmdb:58957', episodeId: episodes[0].id, episodeQuery: 'paper scene', sourceIds: [fetched.sources[0].id] }, toolOptions);
  assert.equal(proof.success, true);
  const opened = await tools.navigateToEpisode.execute({ verifiedEpisodeId: episodes[0].id, seriesId: 'tmdb:58957' }, toolOptions);
  assert.equal(opened.success, true, 'Redundant matching series metadata must not cost an extra model correction turn');
  assert.equal(navigations, 1);
  const withCoordinates = await tools.navigateToEpisode.execute({ verifiedEpisodeId: episodes[0].id,
    seriesQuery: 'Nathan for You', episodeQuery: 'Dumb Starbucks', seasonNumber: 2, episodeNumber: 5 }, toolOptions);
  assert.equal(withCoordinates.success, true, 'Matching extra fields cannot change the evidence-backed target');
  assert.equal(withCoordinates.mediaId, episodes[0].id);
  for (const conflict of [{ seriesId: 'tmdb:999' }, { seasonNumber: 4 }, { episodeNumber: 4 }, { seriesQuery: 'Another show' }, { episodeQuery: 'Another episode' }]) {
    const denied = await tools.navigateToEpisode.execute({ verifiedEpisodeId: episodes[0].id, ...conflict }, toolOptions);
    assert.equal(denied.success, false, 'Conflicting metadata cannot change a verified selection');
  }
  assert.equal(navigations, 2, 'Rejected conflicts never prepare actions');
  console.log('PASS: agent-controlled catalog/search/fetch, stable evidence IDs, request-scoped verified selections, budgets and cancellation.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
