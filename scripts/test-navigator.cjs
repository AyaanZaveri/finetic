const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

async function main() {
  const ai = await import('ai');
  const { MockLanguageModelV4 } = await import('ai/test');
  const zod = await import('zod');
  let activeModel;
  const compatibleSettings = [];
  const anthropicSettings = [];
  const ollamaSettings = [];
  let authenticated = true;
  let subtitleTracks = [];
  let subtitleTracksForId;
  let subtitleContent = "";
  let subtitleTrackLookups = 0;
  let subtitleUserId = "test-user";
  const subtitleDownloads = [];
  const brokenSubtitleUrls = new Set();
  let tmdbToken = 'tmdb-test-token';
  let tmdbStatus = 200;
  const tmdbRequests = [];
  let subtitleTransportFetch;
  let tmdbSearchFixtures;
  let streamLookups = 0;
  let episodeMetadataUnavailable = false;
  const movieFixture = { id: 123, title: 'Example', overview: 'A TMDB synopsis.', release_date: '2020-01-02', vote_average: 8, vote_count: 10, poster_path: '/poster.jpg', media_type: 'movie' };
  async function tmdbFetch(input, init) {
    if (subtitleTransportFetch) return subtitleTransportFetch(input, init);
    const url = new URL(input);
    if (url.hostname === 'v3-cinemeta.strem.io' && url.pathname.includes('/search=')) {
      const metas = url.pathname.startsWith('/catalog/movie/')
        ? [{ id: 'tt123', name: 'Example', type: 'movie' }]
        : [];
      return Response.json({ metas });
    }
    assert.equal(url.hostname, 'api.themoviedb.org', 'Discovery must never fetch a Stremio add-on');
    tmdbRequests.push({ url, init });
    const endpoint = url.pathname.replace('/3/', '');
    let data;
    if (endpoint.startsWith('search/')) data = { page: 1, total_pages: 1, total_results: 1, results: tmdbSearchFixtures || [movieFixture] };
    else if (endpoint === 'person/42') data = { id: 42, name: 'Example Director', known_for_department: 'Directing', biography: 'Full biography', profile_path: '/director.jpg' };
    else if (endpoint.startsWith('find/')) data = { movie_results: [movieFixture], tv_results: [] };
    else if (endpoint === 'movie/123/external_ids') data = { imdb_id: 'tt123' };
    else if (endpoint === 'movie/123') data = { ...movieFixture, title: 'Viewed title', external_ids: { imdb_id: 'tt123' }, genres: [], credits: { cast: [], crew: [] } };
    else if (endpoint === 'tv/114294/external_ids') data = { imdb_id: 'tt13623608' };
    else if (endpoint === 'tv/114294') data = { id: 114294, name: 'The Curse', seasons: [{ season_number: 1, name: 'Season 1', episode_count: 10, poster_path: '/season.jpg' }] };
    else if (endpoint === 'tv/114294/season/1') data = { episodes: [{ id: 1, name: 'Land of Enchantment', season_number: 1, episode_number: 1, still_path: '/episode.jpg' }] };
    else if (endpoint === 'tv/114294/season/1/episode/1') data = { id: 1, name: 'Land of Enchantment', season_number: 1, episode_number: 1, still_path: '/episode.jpg' };
    else throw new Error('Unexpected TMDB endpoint: ' + endpoint);
    return new Response(JSON.stringify(data), { status: episodeMetadataUnavailable && endpoint.includes('/episode/') ? 404 : tmdbStatus, headers: { 'content-type': 'application/json' } });
  }
  const selectedModelIds = [];
  const defaultModels = { openai: 'gpt-6-luna', anthropic: 'claude-haiku-5-5', gemini: 'gemini-3.5-flash-lite' };
  const provider = modelId => { selectedModelIds.push(modelId); return activeModel; };
  provider.responses = provider;
  const modules = new Map();
  const overrides = {
    ai, zod,
    '@/lib/server/outbound-fetch': { outboundFetch: (...args) => tmdbFetch(...args), providerFetch: (...args) => tmdbFetch(...args), outboundUrl: value => new URL(value) },
    '@/lib/server/auth': { getAuthData: async () => {
      if (!authenticated) throw new Error('Not authenticated');
      return { user: { _id: subtitleUserId } };
    } },
    '@/lib/server/default-ai-model': { resolveLatestSmallModel: async (provider, apiKey) => {
      assert.ok(apiKey, 'Automatic discovery uses the selected provider key');
      return defaultModels[provider];
    } },
    "server-only": {},
    "@/lib/server/auth": { getAuthData: async () => { if (!authenticated) throw Error("Not authenticated"); return { user: { _id: subtitleUserId } }; } },
    "@/lib/server/outbound-fetch": { outboundUrl: value => new URL(value), OutboundRequestError: class extends Error {}, providerFetch: fetch, outboundFetch: (...args) => tmdbFetch(...args) },
    "@/lib/tmdb-credentials": { getTMDBToken: async () => tmdbToken },
    '@ai-sdk/google': { google: provider, createGoogle: () => provider },
    '@ai-sdk/anthropic': { createAnthropic: settings => { anthropicSettings.push(settings); return provider; } },
    '@ai-sdk/openai': { openai: provider, createOpenAI: () => provider },
    '@ai-sdk/groq': { groq: provider, createGroq: () => provider },
    '@ai-sdk/cerebras': { cerebras: provider, createCerebras: () => provider },
    '@ai-sdk/openai-compatible': { createOpenAICompatible: settings => { compatibleSettings.push(settings); return provider; } },
    '@openrouter/ai-sdk-provider': { openrouter: provider, createOpenRouter: () => provider },
    'ai-sdk-ollama': { createOllama: settings => { ollamaSettings.push(settings); return provider; } },
    'next/headers': { cookies: async () => ({ get: () => authenticated ? { value: JSON.stringify({ user: { _id: subtitleUserId } }) } : undefined }) },
    '@/app/actions/search': { searchItems: async () => { throw new Error('Add-on search is forbidden'); } },
    '@/app/actions/media': {
      fetchMediaDetails: async () => { throw new Error('Add-on metadata is forbidden'); },
      getStreamAddonTargets: async () => { streamLookups++; return []; }, fetchStreamsFromAddon: async () => [],
    },
    './auth': { getInstalledAddons: async () => [] },
    '@/lib/server/metadata-identity': { metadataIdentity: async () => ({
      scope: subtitleUserId, revision: episodeMetadataUnavailable ? 'episode-unavailable' : 'tmdb', provider: 'auto',
    }) },
    '@/app/actions/subtitles': { fetchSubtitleFileContent: async url => { subtitleDownloads.push(url); return brokenSubtitleUrls.has(url) ? { success: false, error: 'Subtitle download failed (404)' } : ({ success: true, content: subtitleContent }); } },
    '@/app/actions/utils': { getSubtitleTracks: async (id, _type, options = {}) => {
      const raw = sourceId => { subtitleTrackLookups++; return subtitleTracksForId ? subtitleTracksForId(sourceId) : subtitleTracks; };
      return load('lib/media/subtitle-episode-identity.ts').matchEpisodeSubtitleTracks(id, options.episodeTitle, raw(id), async sourceId => raw(sourceId), options.signal);
    } },
  };
  function load(file) {
    const absolute = path.resolve(file);
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const module = { exports: {} };
    modules.set(absolute, module);
    const localRequire = name => {
      if (overrides[name]) return overrides[name];
      if (name.startsWith('@/') || name.startsWith('.')) {
        const resolved = name.startsWith('@/') ? path.resolve(name.slice(2)) : path.resolve(path.dirname(absolute), name);
        const match = [resolved, `${resolved}.ts`, `${resolved}/index.ts`].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (!match) throw new Error(`Cannot resolve ${name} from ${file}`);
        return load(match);
      }
      return require(name);
    };
    const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, {
      module, exports: module.exports, require: localRequire, console: { log() {}, warn() {}, error() {} },
      process: { env: {} }, setTimeout, clearTimeout, AbortController, AbortSignal, Event, CustomEvent, Error, TypeError, SyntaxError,
      fetch: tmdbFetch, Request, Response, ReadableStream, TextEncoder, TextDecoder, URL, URLSearchParams, Buffer, crypto: globalThis.crypto,
    }, { filename: absolute });
    return module.exports;
  }
  const chat = load('lib/navigator-chat.ts');
  const subtitles = load('lib/navigator-subtitles.ts');
  const sceneMatcher = load('lib/navigator-scene-matcher.ts');
  const sceneMatch = (startCue = 'C1', evidence = [startCue]) => ({ status: 'matched', candidates: [{ startCue, evidence }] });
  const missingScene = { status: 'no_match', candidates: [] };
  const semanticLines = Array.from({ length: 2111 }, (_, index) => ({ timestamp: index * 3, timestampFormatted: String(index), text: `dialogue-${index}` }));
  semanticLines[2083].text = 'I saw the napkin he burned.';
  semanticLines[2084].text = 'I saw him grab the gun.';
  semanticLines[2085].text = 'I saw him driving away that night.';
  semanticLines[0].text = '<i>Earlier recap dialogue</i>';
  const transcript = sceneMatcher.chronologicalTranscript(semanticLines);
  assert.match(transcript, /C1\|\[italic\] Earlier recap dialogue/, 'Preserve per-cue formatting evidence that can distinguish recap dialogue');
  assert.match(transcript, /C2085\|I saw him grab the gun\./, 'Semantic admissions cannot disappear between timeline samples');
  assert.equal(transcript.split('\n').filter(line => /^C\d+\|/.test(line)).length, semanticLines.length, 'Retain every original cue');
  assert.equal(sceneMatcher.matchedSceneMoment(semanticLines, sceneMatch('C2085')).timestamp, semanticLines[2084].timestamp);
  const { subtitleAddonBaseUrl } = load('lib/subtitle-provider.ts');
  assert.equal(subtitleAddonBaseUrl('https://opensubtitles.strem.io/manifest.json', 'org.stremio.opensubtitles'), 'https://opensubtitles-v3.strem.io');
  assert.equal(subtitleAddonBaseUrl('https://opensubtitles.strem.io/stremio/v1', 'org.stremio.opensubtitles'), 'https://opensubtitles-v3.strem.io');
  assert.equal(subtitleAddonBaseUrl('https://custom.test/manifest.json', 'org.stremio.opensubtitles'), 'https://custom.test');
  assert.equal(subtitleAddonBaseUrl('https://opensubtitles.strem.io/config/manifest.json', 'org.stremio.opensubtitles'), 'https://opensubtitles.strem.io/config');
  assert.equal(subtitleAddonBaseUrl('https://opensubtitles.strem.io/manifest.json', 'custom-provider'), 'https://opensubtitles.strem.io');

  const ack = load('lib/navigator-playback-ack.ts');
  const { createAllTools } = load('app/tools/index.ts');
  const { POST } = load('app/api/chat/route.ts');
  const { navigatorRoutingSettings } = load('lib/navigator-model-settings.ts');
  const { createOpenAI: actualOpenAI } = await import('@ai-sdk/openai');
  let reasoningRequest;
  const museTransport = actualOpenAI({ name: 'opencode-responses', apiKey: 'fixture-key', fetch: async (_url, init) => {
    reasoningRequest = JSON.parse(init.body);
    throw new Error('Captured transport');
  } }).responses('muse-spark-1.3-contributor');
  await assert.rejects(museTransport.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'Choose a tool' }] }],
    ...navigatorRoutingSettings(museTransport) }), /Captured transport/);
  assert.equal(navigatorRoutingSettings(museTransport).providerOptions.openai.reasoningEffort, 'minimal', 'Simple routing uses the shortest supported reasoning level');
  assert.equal(reasoningRequest.reasoning.effort, 'minimal', 'The actual SDK must send minimal reasoning for the custom Muse model ID');
  assert.equal(navigatorRoutingSettings({ modelId: 'gpt-6-luna', provider: 'opencode-responses.responses' }).providerOptions, undefined, 'Do not override other models');
  const { createOpenAICompatible: actualCompatible } = await import('@ai-sdk/openai-compatible');
  let compatibleReasoningRequest;
  const deepseekTransport = actualCompatible({ name: 'opencode', apiKey: 'fixture-key', baseURL: 'https://provider.test/v1', fetch: async (_url, init) => {
    compatibleReasoningRequest = JSON.parse(init.body);
    throw new Error('Captured compatible transport');
  } })('deepseek-v4.1-flash');
  await assert.rejects(deepseekTransport.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'Select evidence' }] }],
    ...navigatorRoutingSettings(deepseekTransport) }), /Captured compatible transport/);
  assert.equal(compatibleReasoningRequest.reasoning_effort, 'none', 'OpenCode DeepSeek extraction requests actually disable thinking rather than merely lowering its effort');
  assert.equal(navigatorRoutingSettings(deepseekTransport, 'minimal', 'tools').providerOptions.opencode.reasoningEffort, 'low', 'Native streaming tool calls retain their independently tested provider setting');

  const clone = value => JSON.parse(JSON.stringify(value));
  const user = (id, text) => ({ id, role: 'user', parts: [{ type: 'text', text }] });
  const latestQuestion = 'Requirements with a crucial constraint at the end. '.repeat(150);
  const history = Array.from({ length: 50 }, (_, i) => user(`u${i}`, 'earlier question'));
  history[0] = { id: 'old', role: 'assistant', parts: [{ type: 'tool-searchMedia', state: 'output-available', toolCallId: 'old-search', input: {}, output: { success: true, results: [{ id: 'remember-this', name: 'Chosen title', type: 'movie' }] } }] };
  history.push(user('latest', latestQuestion));
  const compacted = chat.compactNavigatorMessages(history);
  const { sceneRequestContext } = load('lib/navigator-scene-context.ts');
  const originalSceneRequest = 'play that one episode in nathan for you where he goes on jimmy kimmel, and skip to the scene where he goes on';
  const sceneHistory = [
    { id: 'earlier-title', role: 'assistant', parts: [{ type: 'tool-playMedia', state: 'output-available', toolCallId: 'old-play', input: {}, output: { success: true, mediaId: 'tt2297757:4:4', mediaName: 'Nathan for You', episodeTitle: 'The Anecdote', streamUrl: 'SIGNED_SECRET', authKey: 'AUTH_SECRET' } }] },
    ...Array.from({ length: 30 }, (_, index) => user(`context-${index}`, 'Older conversation')),
    user('prior-reference', 'By "goes on" I mean his appearance on Jimmy Kimmel, not planning it.'),
    user('verbatim-request', `${originalSceneRequest}\n${'more context '.repeat(500)}Keep this final constraint: “the actual interview”.`),
  ];
  const historyBeforeContext = clone(sceneHistory);
  const sceneContext = sceneRequestContext(sceneHistory);
  assert.equal(sceneContext.originalRequest, sceneHistory.at(-1).parts[0].text, 'The original request survives verbatim, including a long tail and Unicode');
  assert.match(JSON.stringify(sceneContext.conversation), /Jimmy Kimmel/, 'Retain earlier dialogue resolving references');
  assert.match(JSON.stringify(sceneContext.titleReferences), /The Anecdote/, 'Keep older selected episode identities beyond the recent-text window');
  assert.doesNotMatch(JSON.stringify(sceneContext), /SIGNED_SECRET|AUTH_SECRET/, 'Do not forward private tool transport fields');
  assert.ok(sceneContext.conversation.length <= 12);
  assert.deepEqual(sceneHistory, historyBeforeContext, 'Context collection never mutates saved history');
  assert.equal(compacted.at(-1).parts[0].text, latestQuestion, 'Latest question must never be silently truncated');
  assert.match(compacted[0].parts[0].text, /remember-this/, 'Older selected title IDs survive compaction');
  assert.equal(history.length, 51, 'Compaction must not mutate the saved transcript');
  assert.equal(chat.readNavigatorHistory('{broken').length, 0);
  assert.equal(chat.readNavigatorHistory(JSON.stringify(history)).length, 51);
  assert.deepEqual(clone(chat.pageTargetFromPath('/series/show%3A123/1/2')), { id: 'show:123', type: 'series', season: 1, episode: 2 });
  assert.equal(chat.pageTargetFromPath('/settings'), null);
  assert.equal(chat.pageTargetFromPath('/movie/%E0%A4%A'), null);
  assert.deepEqual(clone(chat.pageTargetFromPath('/person/42')), { id: 42, type: 'person' });
  for (const path of ['/person/0', '/person/01', '/person/9007199254740992', '/person/42/credits', '/person/42?x=1']) {
    assert.equal(chat.pageTargetFromPath(path), null);
  }
  const entries = [
    { timestamp: 5, endTimestamp: 8, timestampFormatted: '00:05', text: 'Earlier evidence' },
    { timestamp: 9, endTimestamp: 15, timestampFormatted: '00:09', text: 'A sentence still being spoken' },
    { timestamp: 20, endTimestamp: 23, timestampFormatted: '00:20', text: 'Future reveal' },
  ];
  assert.deepEqual(clone(subtitles.sceneSubtitles(entries, 10, 30)), [entries[0]], 'Spoiler protection excludes future and unfinished dialogue');
  assert.equal(subtitles.sceneSubtitles(entries, 10, 30, true).length, 3);
  assert.equal(sceneMatcher.matchedSceneMoment(entries, { status: 'ambiguous', candidates: sceneMatch().candidates }), null);
  assert.equal(sceneMatcher.matchedSceneMoment(entries, sceneMatch('C99')), null);
  assert.equal(sceneMatcher.matchedSceneMoment(entries, missingScene), null);
  assert.equal(sceneMatcher.matchedSceneMoment(entries, { status: 'insufficient_evidence', candidates: sceneMatch().candidates }), null);
  assert.equal(sceneMatcher.matchedSceneMoment(entries, { status: 'matched', candidates: [...sceneMatch('C99').candidates, ...sceneMatch().candidates] }), null, 'Do not silently substitute a lower-ranked candidate after invalid evidence');
  assert.equal(sceneMatcher.matchedSceneMoment(entries, sceneMatch()).timestamp, 5);
  assert.equal(sceneMatcher.matchedSceneMoment(entries, sceneMatch('C2', ['C1', 'C2'])).timestamp, 9, 'Earlier context must not change the seek');

  // Playback acknowledgements must represent the player, including native playback events.
  const target = new EventTarget();
  const event = (actionId, state, message) => target.dispatchEvent(new CustomEvent(ack.NAVIGATOR_PLAYBACK_EVENT, { detail: { actionId, state, message } }));
  const playing = ack.acknowledgePlayback(target, 'new', () => { event('old', 'error', 'stale'); event('new', 'playing'); }, new AbortController().signal, 100);
  assert.equal((await playing).status, 'completed');
  assert.equal((await ack.acknowledgePlayback(target, 'bad', () => event('bad', 'error', 'Unsupported stream'), new AbortController().signal, 100)).message, 'Unsupported stream');
  assert.equal((await ack.acknowledgePlayback(target, 'slow', () => {}, new AbortController().signal, 1)).status, 'requested');
  const controller = new AbortController();
  const cancelled = ack.acknowledgePlayback(target, 'cancel', () => {}, controller.signal, 100);
  controller.abort();
  assert.equal((await cancelled).status, 'cancelled');

  const usage = { inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
  const stream = (parts, reason = 'stop') => ({ stream: ai.simulateReadableStream({ chunks: [
    { type: 'stream-start', warnings: [] }, ...parts,
    { type: 'finish', finishReason: { unified: reason, raw: reason }, usage },
  ], chunkDelayInMs: null }) });
  let calls = 0;
  const modelPrompts = [];
  activeModel = new MockLanguageModelV4({ doStream: async options => {
    modelPrompts.push(options);
    calls += 1;
    if (calls === 1) return stream([{ type: 'tool-call', toolCallId: 'prepare-1', toolName: 'navigateToMediaByQuery', input: JSON.stringify({ mediaQuery: 'Example' }) }], 'tool-calls');
    if (options.toolChoice?.type === 'tool') throw new ai.APICallError({
      message: 'Forced tool choice is not supported', url: 'https://example.test', requestBodyValues: {}, statusCode: 400,
    });
    assert.notEqual(options.toolChoice?.toolName, 'completeAction', 'Browser action dispatch must not require a model-generated follow-up tool call');
    return stream([{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'Opening your selection.' }, { type: 'text-end', id: 't' }]);
  } });
  const payload = { messages: [user('request-1', 'Open Example')], openaiApiKey: 'test-key', pathname: '/movie/tt123' };
  const request = body => new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  async function readResponse(response) {
    assert.equal(response.status, 200, await response.clone().text());
    const chunks = [];
    for (const line of (await response.text()).split('\n')) if (line.startsWith('data: ') && line !== 'data: [DONE]') chunks.push(JSON.parse(line.slice(6)));
    assert.equal(chunks.some(chunk => chunk.type === 'error'), false, JSON.stringify(chunks));
    let message;
    for await (const next of ai.readUIMessageStream({ stream: ai.simulateReadableStream({ chunks, chunkDelayInMs: null }) })) message = next;
    return message;
  }
  const first = await readResponse(await POST(request(payload)));
  assert.equal(calls, 1, 'Server must hand the prepared action to the browser before another model call');
  const prepared = first.parts.find(part => part.type === 'tool-navigateToMediaByQuery');
  assert.equal(prepared.output.preparedToolCallId, 'prepare-1');
  assert.equal(chat.findPreparedAction([...payload.messages, first], 'prepare-1').url, '/movie/tt123');
  assert.equal(chat.findPreparedAction([...payload.messages, first, user('new-turn', 'Different task')], 'prepare-1'), null, 'Old turns must never replay actions');
  prepared.output = { ...prepared.output, execution: 'completed', success: true, status: 'requested', message: 'Navigation requested.' };
  const second = await readResponse(await POST(request({ ...payload, messages: [...payload.messages, first] })));
  assert.match(JSON.stringify(second), /Opening your selection/);
  assert.equal(calls, 2);
  assert.match(JSON.stringify(modelPrompts[0].prompt), /Viewed title/);
  assert.ok(modelPrompts[0].tools.some(tool => tool.name === 'skipToSubtitleContent'), 'The live route must expose scene playback with no current media');
  assert.ok(!modelPrompts[0].tools.some(tool => tool.name === 'explainScene'), 'Current-scene explanation still requires playback');
  // Exercise the actual browser transport and Chat implementation, including automatic continuation.
  const { Chat } = await import('@ai-sdk/react');
  calls = 0;
  const sentBodies = [];
  let client;
  let resolveClientFinished;
  const clientFinished = new Promise(resolve => { resolveClientFinished = resolve; });
  client = new Chat({
    transport: new ai.DefaultChatTransport({
      api: 'http://localhost/api/chat',
      body: () => ({ openaiApiKey: 'test-key', pathname: '/movie/tt123' }),
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body);
        sentBodies.push(body);
        return POST(request(body));
      },
    }),
    sendAutomaticallyWhen: ({ messages }) => chat.shouldContinueAfterNavigatorAction(messages) && ai.lastAssistantMessageIsCompleteWithToolCalls({ messages }),
    onFinish: ({ messages }) => {
      if (messages.at(-1)?.parts.some(part => part.type === "text" && part.text.includes("Opening your selection"))) resolveClientFinished();
      setTimeout(() => { for (const action of chat.preparedNavigatorActions(messages)) {
        assert.equal(action.output.url, '/movie/tt123');
        void client.addToolOutput({ tool: action.toolName, toolCallId: action.toolCallId, output: {
          ...action.output, execution: 'completed', success: true, status: 'requested', message: 'Navigation requested.',
        } });
      } }, 0);
    },
  });
  await client.sendMessage({ text: 'Open Example' });
  let completionTimeout;
  await Promise.race([clientFinished, new Promise((_resolve, reject) => { completionTimeout = setTimeout(() => reject(new Error('Client continuation timed out')), 5000); })]);
  clearTimeout(completionTimeout);
  assert.equal(client.error, undefined);
  assert.equal(calls, 2, 'Client acknowledgement should continue directly to the final response');
  assert.equal(sentBodies.length, 2);
  assert.equal(sentBodies.every(body => body.openaiApiKey === 'test-key' && body.pathname === '/movie/tt123'), true, 'Continuation must retain provider and page context');
  assert.match(JSON.stringify(client.messages.at(-1)), /Opening your selection/);
  const beforeParallelModel = activeModel;
  activeModel = new MockLanguageModelV4({ doStream: async () => stream([
    { type: 'tool-call', toolCallId: 'theme-parallel-1', toolName: 'themeToggle', input: JSON.stringify({ action: 'light' }) },
    { type: 'tool-call', toolCallId: 'theme-parallel-2', toolName: 'themeToggle', input: JSON.stringify({ action: 'light' }) },
  ], 'tool-calls') });
  const themeUser = user('theme-parallel', 'Switch to light mode');
  const parallelTheme = await readResponse(await POST(request({ ...payload, messages: [themeUser] })));
  const preparedThemes = parallelTheme.parts.filter(part => part.type === 'tool-themeToggle' && part.output?.execution === 'prepared');
  assert.equal(preparedThemes.length, 1, 'Two native action calls in the same step must prepare only one action');
  preparedThemes[0].output = { ...preparedThemes[0].output, execution: 'completed', success: true };
  activeModel = new MockLanguageModelV4({ doStream: async options => {
    assert.notEqual(options.toolChoice?.type, 'required', 'Acknowledgement must release forced initial tool choice');
    assert.equal(options.tools.some(tool => tool.name === 'themeToggle'), false, 'Acknowledged action must not be advertised again');
    return stream([{ type: 'text-start', id: 'theme-done' }, { type: 'text-delta', id: 'theme-done', delta: 'Theme changed.' }, { type: 'text-end', id: 'theme-done' }]);
  } });
  const finishedTheme = await readResponse(await POST(request({ ...payload, messages: [themeUser, parallelTheme] })));
  assert.match(JSON.stringify(finishedTheme), /Theme changed/);
  activeModel = beforeParallelModel;
  const tools = createAllTools(null, 0, activeModel);
  const beforeSearch = tmdbRequests.length;
  const search = await tools.searchMedia.execute({ query: 'Example' }, { toolCallId: 'search-tmdb', messages: [], abortSignal: new AbortController().signal });
  assert.equal(search.results[0].id, 'tmdb:123');
  assert.equal(search.results[0].source, 'TMDB');
  assert.equal(tmdbRequests.length - beforeSearch, 1, 'Search must not enrich every title with extra IMDb requests');
  const playOptions = { toolCallId: 'first-episode', messages: [] };
  const seasons = await tools.getSeasons.execute({ tvShowId: 'tmdb:114294' }, playOptions);
  assert.match(seasons.seasons[0].poster || '', /\/season.jpg$/, 'Season artwork must survive the tool result');
  const episodes = await tools.getEpisodes.execute({ seasonId: 'tmdb:114294:1' }, playOptions);
  assert.match(episodes.episodes[0].thumbnail, /\/episode.jpg$/);
  const beforePlay = tmdbRequests.length;
  const play = await tools.playMedia.execute({ mediaId: 'tmdb:114294', mediaName: 'The Curse', mediaType: 'Episode', seasonNumber: 1, episodeNumber: 1 }, playOptions);
  assert.equal(play.mediaId, 'tt13623608:1:1', 'Play accepts a known series ID and explicit episode coordinates without a separate seriesId');
  assert.equal(play.seriesId, 'tt13623608');
  assert.equal(play.seasonNumber, 1);
  assert.equal(play.episodeNumber, 1);
  assert.equal(play.episodeTitle, 'Land of Enchantment', 'Playback cards receive the real episode title');
  assert.equal(play.showName, 'The Curse');
  assert.match(play.thumbnail, /\/episode.jpg$/);
  assert.equal(play.streamUrl, undefined, 'Ordinary playback lets the player discover streams');
  assert.equal(streamLookups, 0, 'playMedia must not enumerate streams');
  assert.deepEqual(tmdbRequests.slice(beforePlay).map(call => call.url.pathname).sort(), ['/3/tv/114294/external_ids', '/3/tv/114294/season/1/episode/1'], 'Fetch only the requested episode metadata, never season/episode lists');
  const phases = [], playerCalls = [];
  const { resolvePlayback } = load('lib/media/resolve-playback.ts');
  await resolvePlayback({ id: play.seriesId, name: play.mediaName, type: 'series', mediaSourceId: play.mediaSourceId,
    seriesId: play.seriesId, seasonNumber: play.seasonNumber, episodeNumber: play.episodeNumber }, {
    fetchStreams: async (id, type) => { playerCalls.push([id, type]); return [{ url: 'https://example.test/first.mp4' }]; },
    getNextEpisodeForSeries: async () => { throw new Error('Explicit first episode must bypass season/episode enumeration'); },
  }, phase => phases.push(phase));
  assert.deepEqual(playerCalls, [['tt13623608:1:1', 'series']]);
  assert.deepEqual(phases, ['fetching-streams', 'loading-stream']);
  const encodedEpisode = await tools.playMedia.execute({ mediaId: 'tmdb:114294:1:1', mediaName: 'The Curse', mediaType: 'Episode' }, playOptions);
  assert.equal(encodedEpisode.seasonNumber, 1, 'Episode IDs also populate player coordinates');
  assert.equal(encodedEpisode.episodeNumber, 1);
  const numericEpisode = await tools.playMedia.execute({ mediaId: '114294', mediaName: 'The Curse', mediaType: 'Series', seasonNumber: 1, episodeNumber: 1 }, playOptions);
  assert.equal(numericEpisode.mediaId, 'tt13623608:1:1', 'A numeric TMDB ID from a prior result is valid when the media type is supplied');
  assert.equal(numericEpisode.mediaType, 'Episode');
  episodeMetadataUnavailable = true;
  const withoutMetadata = await tools.playMedia.execute({ mediaId: 'tmdb:114294', mediaName: 'The Curse', mediaType: 'Episode', seasonNumber: 1, episodeNumber: 1 }, playOptions);
  assert.equal(withoutMetadata.mediaId, 'tt13623608:1:1', 'Display metadata failures must not prevent playback');
  assert.equal(withoutMetadata.success, true);
  episodeMetadataUnavailable = false;
  tmdbToken = '';
  const missingToken = await tools.searchMedia.execute({ query: 'Example' }, { toolCallId: 'missing-token', messages: [] });
  assert.equal(missingToken.success, true, 'Title search falls back to Cinemeta without a TMDB token');
  assert.equal(missingToken.results[0].id, 'tt123');
  assert.equal(missingToken.results[0].source, 'Cinemeta');
  tmdbToken = 'tmdb-test-token';
  tmdbStatus = 429;
  const limitedSearch = await tools.searchMedia.execute({ query: 'Example' }, { toolCallId: 'limited', messages: [] });
  assert.match(limitedSearch.error, /request limit/);
  tmdbStatus = 200;
  const validated = await ai.validateUIMessages({ messages: [...payload.messages, first], tools });
  const converted = await ai.convertToModelMessages(validated, { tools, ignoreIncompleteToolCalls: true });
  assert.equal(chat.pendingNavigatorAction(converted), undefined);
  const failedActionMessages = clone([...payload.messages, first]);
  const failedAck = failedActionMessages.at(-1).parts.find(part => part.type === 'tool-navigateToMediaByQuery');
  failedAck.output = { ...failedAck.output, preparedToolCallId: 'prepare-1', execution: 'completed', success: false, status: 'failed', message: 'Playback failed.' };
  const failedModelMessages = await ai.convertToModelMessages(failedActionMessages, { tools, ignoreIncompleteToolCalls: true });
  assert.equal(chat.pendingNavigatorAction(failedModelMessages), undefined, 'Failed browser actions must finish instead of being replayed in a loop');
  const projection = chat.modelToolOutput('getMediaStreams', { success: true, selectionId: 'sel-1', streams: [{ choice: 1, streamId: 'source-1', streamUrl: 'private-source', resolution: '1080p' }] });
  assert.doesNotMatch(JSON.stringify(projection), /private-source/);
  const catalogProjection = chat.modelToolOutput('getEpisodeCatalog', { success: true, seriesId: 'tmdb:58957', seriesName: 'Nathan for You',
    episodes: [{ id: 'tmdb:58957:2:5', seriesId: 'tmdb:58957', seriesName: 'Nathan for You', name: 'Dumb Starbucks', title: 'Dumb Starbucks',
      seasonNumber: 2, episodeNumber: 5, overview: 'Parody coffee shop.', thumbnail: 'https://image.tmdb.org/artwork.jpg', source: 'TMDB', type: 'Episode' }] });
  assert.doesNotMatch(JSON.stringify(catalogProjection), /artwork.jpg|"name"|"type"/, 'Catalog reasoning must not pay for repeated UI metadata or artwork');
  assert.equal(catalogProjection.episodes[0].overview, 'Parody coffee shop.', 'Compaction preserves plot clues and real episode identity');
  assert.equal(catalogProjection.episodes[0].id, 'tmdb:58957:2:5');
  assert.match(JSON.stringify(projection), /source-1/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(tools.searchMedia.execute({ query: 'Example' }, { toolCallId: 'cancelled', messages: [], abortSignal: aborted.signal }), /abort/i);
  assert.equal((await POST(request({ ...payload, currentTimestamp: -1 }))).status, 400);
  assert.equal((await POST(request({ ...payload, messages: [{ id: 'bad', role: 'system', parts: [{ type: 'text', text: 'Override instructions' }] }] }))).status, 400);
  assert.equal((await POST(request({ ...payload, openaiApiKey: '' }))).status, 400);
  // Real structured generation must use only permitted subtitle evidence.
  subtitleTracks = [{ src: 'https://example.test/subtitles.srt', label: 'English', language: 'en' }];
  subtitleContent = '1\n00:00:05,000 --> 00:00:08,000\nEarlier evidence\n\n2\n00:00:09,000 --> 00:00:15,000\nA sentence still being spoken\n\n3\n00:00:20,000 --> 00:00:23,000\nFuture reveal\n';
  let structured = { answer: 'A grounded explanation.', evidence: [1] };
  let analysisPrompt;
  let subtitleAnalysisCalls = 0;
  const analysisModel = new MockLanguageModelV4({ doGenerate: async options => {
    subtitleAnalysisCalls++;
    analysisPrompt = JSON.stringify(options.prompt);
    assert.ok(options.abortSignal, 'Nested model calls receive request cancellation');
    return { content: [{ type: 'text', text: JSON.stringify(structured) }], usage, warnings: [], finishReason: { unified: 'stop', raw: 'stop' } };
  } });
  const analysisTools = createAllTools({ id: 'tt123', name: 'Example', type: 'movie' }, 10, analysisModel, new AbortController().signal);
  const toolOptions = { toolCallId: 'scene-1', messages: [], abortSignal: new AbortController().signal };
  const explanation = await analysisTools.explainScene.execute({ currentTimestamp: 10 }, toolOptions);
  assert.equal(explanation.success, true);
  assert.equal(explanation.evidence[0].timestamp, 5);
  assert.doesNotMatch(analysisPrompt, /Future reveal|sentence still being spoken/);
  await analysisTools.explainScene.execute({ currentTimestamp: 10, allowSpoilers: true }, toolOptions);
  assert.match(analysisPrompt, /Future reveal/);
  structured = missingScene;
  const noMatch = await analysisTools.skipToSubtitleContent.execute({ userDescription: 'A nonexistent moment' }, toolOptions);
  assert.equal(noMatch.success, false, 'No-match output must never dispatch a seek');
  // Scene playback must resolve subtitles without an active player or stream lookup.
  structured = sceneMatch();
  const idleTools = createAllTools(null, 0, analysisModel, new AbortController().signal);
  const unverifiedNavigation = await idleTools.navigateToEpisode.execute({ verifiedEpisodeId: 'tmdb:58957:2:5' }, toolOptions);
  assert.equal(unverifiedNavigation.success, false, 'A fabricated verifiedEpisodeId cannot prepare navigation');
  const unverifiedPlayback = await idleTools.playMedia.execute({ verifiedEpisodeId: 'tmdb:58957:2:5', mediaId: 'tmdb:58957', mediaName: 'Nathan for You', mediaType: 'Episode' }, toolOptions);
  assert.equal(unverifiedPlayback.success, false, 'A fabricated verifiedEpisodeId cannot prepare playback');
  const tinyfishToolsModule = load('lib/tinyfish.ts');
  const oldSearch = tinyfishToolsModule.searchTinyfish, oldRead = tinyfishToolsModule.fetchMediaWebSources;
  let selectedReads = 0;
  tinyfishToolsModule.searchTinyfish = async () => Array.from({ length: 10 }, (_, index) => ({ title: `Source ${index}`, url: `https://example.com/${index}`, snippet: 'Discovery result' }));
  tinyfishToolsModule.fetchMediaWebSources = async urls => { selectedReads++; return urls.map(url => ({ id: 'web:1', title: 'Read source', url, text: 'Verified page content' })); };
  const fastSearch = await idleTools.searchMediaWeb.execute({ query: 'test', question: 'Search only' }, toolOptions);
  assert.equal(fastSearch.results.length, 10);
  assert.equal(fastSearch.evidenceLevel, 'search-results');
  assert.equal(selectedReads, 0, 'The actual search tool must not call Fetch');
  const selectedPages = await idleTools.readMediaWebSources.execute({ urls: ['https://example.com/0'], question: 'Verify this source' }, toolOptions);
  assert.equal(selectedReads, 1, 'Page reading is a separate explicit tool');
  assert.equal(selectedPages.evidenceLevel, 'page-content');
  let searchSteps = 0;
  const priorFastModel = activeModel;
  activeModel = new MockLanguageModelV4({ provider: 'opencode-responses.responses', modelId: 'gpt-6-luna',
    doStream: async () => { searchSteps++; return searchSteps === 1
      ? stream([{ type: 'tool-call', toolCallId: 'fast-search-once', toolName: 'searchMediaWeb', input: JSON.stringify({ query: 'Example', question: 'Search results and links only' }) }], 'tool-calls')
      : stream([{ type: 'text-start', id: 'links-answer' }, { type: 'text-delta', id: 'links-answer', delta: '[Source 0](https://example.com/0)' }, { type: 'text-end', id: 'links-answer' }], 'stop'); },
  });
  await readResponse(await POST(request({ ...payload, pathname: '/', currentMedia: null,
    messages: [user('links-only', 'Search the web for Example, links only; do not fetch pages')] })));
  assert.equal(searchSteps, 2, 'The agent sees search results and chooses to answer, with no regex-forced stop');
  assert.equal(selectedReads, 1, 'The links-only turn does not fetch any additional pages');
  activeModel = priorFastModel;
  tinyfishToolsModule.searchTinyfish = oldSearch;
  tinyfishToolsModule.fetchMediaWebSources = oldRead;
  const sceneInput = { userDescription: 'Earlier evidence', mediaId: 'tmdb:123', mediaName: 'Example', mediaType: 'Movie' };
  const idleScene = await idleTools.skipToSubtitleContent.execute(sceneInput, toolOptions);
  assert.equal(idleScene.success, true, 'Idle scene requests must not require playback');
  assert.equal(idleScene.action, 'play');
  assert.equal(idleScene.mediaId, 'tt123', 'Resolve the TMDB ID before requesting subtitles');
  assert.equal(idleScene.resumePositionTicks, 5, 'Open playback directly at the evidence timestamp');
  assert.equal(idleScene.execution, 'prepared');
  tmdbSearchFixtures = [{ id: 114294, name: 'The Curse', media_type: 'tv' }];
  let compoundMatchPrompt;
  const descriptiveEpisodeScene = await idleTools.skipToSubtitleContent.execute({
    mediaQuery: 'The Curse', episodeQuery: 'Land of Enchantment', userDescription: 'Earlier evidence',
  }, toolOptions);
  assert.equal(descriptiveEpisodeScene.success, true, 'Resolve a described episode before seeking its scene, without asking the user for coordinates');
  assert.equal(descriptiveEpisodeScene.mediaId, 'tt13623608:1:1');
  assert.equal(descriptiveEpisodeScene.resumePositionTicks, 5);
  assert.match(analysisPrompt, /Verified episode-identification context for this exact episode/, 'Internally resolved episode evidence also reaches the scene matcher');
  assert.match(analysisPrompt, /Land of Enchantment/, 'Retain the canonical episode title in the evidence');
  const lookupsBeforeUnresolvedEpisode = subtitleTrackLookups;
  const unresolvedEpisodeScene = await idleTools.skipToSubtitleContent.execute({
    mediaQuery: 'The Curse', episodeQuery: 'an unsupported episode description', userDescription: 'Earlier evidence',
  }, toolOptions);
  assert.equal(unresolvedEpisodeScene.success, false, 'Unsupported episode evidence must not fall back to a guessed episode');
  assert.equal(unresolvedEpisodeScene.action, undefined);
  assert.equal(subtitleTrackLookups, lookupsBeforeUnresolvedEpisode, 'Resolve the episode before requesting its subtitles');
  const implicitEpisodeScene = await idleTools.skipToSubtitleContent.execute({ mediaQuery: 'The Curse', userDescription: 'Land of Enchantment' }, toolOptions);
  assert.equal(implicitEpisodeScene.success, true, 'The scene itself identifies an episode when coordinates are absent');
  const knownShowScene = await idleTools.skipToSubtitleContent.execute({ mediaId: 'tmdb:114294', mediaName: 'The Curse', mediaType: 'Episode', userDescription: 'Land of Enchantment' }, toolOptions);
  assert.equal(knownShowScene.success, true, 'A known show ID also resolves the episode from the scene clue');
  const movieWithEpisodeClue = await idleTools.skipToSubtitleContent.execute({ ...sceneInput, episodeQuery: 'confession' }, toolOptions);
  assert.equal(movieWithEpisodeClue.success, true, 'A stray episode clue must not reject a known movie scene');
  tmdbSearchFixtures = undefined;
  const episodeScene = await idleTools.skipToSubtitleContent.execute({ userDescription: 'Earlier evidence', mediaId: 'tmdb:114294', mediaName: 'The Curse', mediaType: 'Episode', seasonNumber: 1, episodeNumber: 1 }, toolOptions);
  assert.equal(episodeScene.success, true);
  assert.equal(episodeScene.mediaSourceId, 'tt13623608:1:1');
  assert.equal(episodeScene.resumePositionTicks, 5);
  subtitleTracksForId = id => [{ language: 'en', label: 'English',
    src: id === 'tt13623608:1:2' ? 'https://example.test/right-episode.srt' : 'https://example.test/wrong-episode.srt',
    filename: id === 'tt13623608:1:2' ? 'The.Curse.S01E02.Land.of.Enchantment.srt' : 'The.Curse.S01E01.Other.Episode.srt' }];
  const shiftedSubtitlesScene = await idleTools.skipToSubtitleContent.execute({ userDescription: 'Earlier evidence',
    mediaId: 'tmdb:114294', mediaName: 'The Curse', mediaType: 'Episode', seasonNumber: 1, episodeNumber: 1 }, toolOptions);
  assert.equal(shiftedSubtitlesScene.success, true);
  assert.equal(subtitleDownloads.at(-1), 'https://example.test/right-episode.srt', 'Use episode-title evidence when the subtitle provider has shifted numbering');
  assert.equal(shiftedSubtitlesScene.mediaSourceId, 'tt13623608:1:1', 'Subtitle provider numbering must not change the video playback target');
  subtitleTracksForId = undefined;
  const sceneCardsProgress = [];
  const queryScene = await idleTools.skipToSubtitleContent.execute({ userDescription: 'Earlier evidence', mediaQuery: 'Example' },
    { ...toolOptions, context: { onSceneProgress: progress => sceneCardsProgress.push(progress) } });
  const titleProgress = sceneCardsProgress.find(progress => progress.stage === 'title' && progress.state === 'completed');
  assert.equal(titleProgress.media.name, 'Example');
  assert.equal(titleProgress.media.year, 2020);
  assert.equal(titleProgress.media.poster, 'https://image.tmdb.org/t/p/w500/poster.jpg');
  const currentEpisodeProgress = [];
  const still = 'https://image.tmdb.org/t/p/w300/episode.jpg';
  const poster = 'https://image.tmdb.org/t/p/w500/series.jpg';
  const episodeTools = createAllTools({ id: 'tt13623608', seriesId: 'tt13623608', mediaSourceId: 'tt13623608:1:1',
    type: 'series', name: 'Land of Enchantment', showName: 'The Curse', episodeTitle: 'Land of Enchantment',
    seasonNumber: 1, episodeNumber: 1, thumbnail: still, poster }, 10, analysisModel);
  const seek = await episodeTools.skipToSubtitleContent.execute({ userDescription: 'Earlier evidence' },
    { ...toolOptions, context: { onSceneProgress: progress => currentEpisodeProgress.push(progress) } });
  assert.equal(seek.success, true);
  const currentTitle = currentEpisodeProgress.find(progress => progress.stage === 'title' && progress.state === 'completed').media;
  assert.equal(currentTitle.thumbnail, still, 'Seeking within the current episode preserves its still');
  assert.equal(currentTitle.poster, poster, 'The show poster is available as a fallback');
  const trackProgress = sceneCardsProgress.find(progress => progress.stage === 'subtitles' && progress.state === 'completed');
  assert.equal(trackProgress.subtitles.language, 'en');
  assert.equal(trackProgress.subtitles.lineCount, 3);
  assert.equal(trackProgress.subtitles.index, 0);
  assert.equal(trackProgress.subtitles.src, undefined, 'Progress never sends signed subtitle download URLs');
  const foundSceneProgress = sceneCardsProgress.find(progress => progress.stage === 'scene' && progress.state === 'completed');
  assert.equal(foundSceneProgress.scene.text, queryScene.text);
  assert.equal(foundSceneProgress.scene.timestamp, queryScene.timestamp);
  assert.equal(queryScene.success, true, 'A scene tool must resolve a title query internally without another model turn');
  assert.equal(queryScene.mediaId, 'tt123');
  const inPlace = await analysisTools.skipToSubtitleContent.execute(sceneInput, toolOptions);
  assert.equal(inPlace.action, 'skipTo', 'A named scene in the currently playing title should seek instead of refetching streams');
  const queryInPlace = await analysisTools.skipToSubtitleContent.execute({ mediaQuery: 'Example', mediaType: 'Movie', userDescription: 'Earlier evidence' }, toolOptions);
  assert.equal(queryInPlace.action, 'skipTo');
  tmdbSearchFixtures = [movieFixture, { ...movieFixture, id: 124, release_date: '2021-01-01' }];
  const ambiguousScene = await idleTools.skipToSubtitleContent.execute({ mediaQuery: 'Example', userDescription: 'Earlier evidence' }, toolOptions);
  assert.equal(ambiguousScene.success, false, 'Compound scene lookup must not silently pick an ambiguous remake');
  assert.equal(ambiguousScene.action, undefined);
  const yearScene = await idleTools.skipToSubtitleContent.execute({ mediaQuery: 'Example (2020)', userDescription: 'Earlier evidence' }, toolOptions);
  assert.equal(yearScene.success, true, 'A specific year disambiguates remakes within the same tool call');
  assert.equal(yearScene.mediaId, 'tt123');
  tmdbSearchFixtures = [
    { ...movieFixture, vote_count: 15000, popularity: 30 },
    { ...movieFixture, id: 124, release_date: '2016-01-01', vote_count: 80, popularity: 1 },
    { ...movieFixture, id: 125, release_date: '2024-01-01', vote_count: 0, popularity: 0.1 },
  ];
  const dominantScene = await idleTools.skipToSubtitleContent.execute({ mediaQuery: 'Example', userDescription: 'Earlier evidence' }, toolOptions);
  assert.equal(dominantScene.success, true, 'A clearly dominant exact title should not be blocked by obscure namesakes');
  assert.equal(dominantScene.mediaId, 'tt123');
  tmdbSearchFixtures = [{ ...movieFixture, vote_count: 15000, release_date: '2019-01-01' }];
  const wrongYear = await idleTools.skipToSubtitleContent.execute({ mediaQuery: 'Example (2016)', userDescription: 'Earlier evidence' }, toolOptions);
  assert.equal(wrongYear.success, false, 'An explicit year must never fall back to the only result from a different year');
  tmdbSearchFixtures = undefined;
  const lookupsAfterScene = subtitleTrackLookups;
  const analysisAfterScene = subtitleAnalysisCalls;
  await idleTools.skipToSubtitleContent.execute(sceneInput, toolOptions);
  assert.equal(subtitleTrackLookups, lookupsAfterScene + 1, 'Every scene request discovers current subtitle tracks');
  assert.equal(subtitleAnalysisCalls, analysisAfterScene + 1, 'Repeated scene requests freshly select the scene in one semantic pass');
  assert.equal(streamLookups, 0, 'Finding a scene must not wait for stream enumeration');
  subtitleUserId = 'another-user';
  await idleTools.skipToSubtitleContent.execute(sceneInput, toolOptions);
  assert.equal(subtitleTrackLookups, lookupsAfterScene + 2, 'Switching accounts always discovers current subtitle tracks');
  subtitleUserId = 'test-user';
  const releaseTools = createAllTools({ id: 'tt123', name: 'Example', type: 'movie', subtitleFilename: 'different-release.mkv' }, 10, analysisModel, new AbortController().signal);
  await releaseTools.skipToSubtitleContent.execute({ userDescription: 'Earlier evidence' }, toolOptions);
  assert.equal(subtitleTrackLookups, lookupsAfterScene + 3, 'Different release hints require fresh subtitles');

  structured = missingScene;
  const idleNoMatch = await idleTools.skipToSubtitleContent.execute({ ...sceneInput, userDescription: "A nonexistent moment" }, toolOptions);
  assert.equal(idleNoMatch.success, false);
  assert.equal(idleNoMatch.action, undefined, 'A missing scene must never start playback at zero');
  const partialTarget = await idleTools.skipToSubtitleContent.execute({ userDescription: 'a scene', mediaId: 'tt123' }, toolOptions);
  assert.equal(partialTarget.success, false, 'Incomplete title coordinates must not seek the current movie');
  structured = sceneMatch();
  subtitleTracks = [
    { src: 'https://example.test/broken.srt', label: 'English', language: 'eng' },
    { src: 'https://example.test/working.srt', label: 'English', language: 'eng' },
  ];
  brokenSubtitleUrls.add(subtitleTracks[0].src);
  const fallbackTools = createAllTools({ id: 'tt-fallback', name: 'Fallback', type: 'movie' }, 10, analysisModel, new AbortController().signal);
  const fallbackScene = await fallbackTools.skipToSubtitleContent.execute({ userDescription: 'Earlier evidence' }, toolOptions);
  assert.equal(fallbackScene.success, true, 'A broken preferred subtitle track must fall back to another track');
  assert.equal(fallbackScene.action, 'skipTo', 'Active playback still seeks in place');
  subtitleTracks = [
    { src: 'https://official.test/en.srt', id: '1234', label: 'English', language: 'en' },
    { src: 'https://broken.test/eng.srt', id: 'release_eng', label: 'eng', language: 'eng' },
  ];
  const priorityStart = subtitleDownloads.length;
  const priorityTools = createAllTools({ id: 'tt-priority', name: 'Priority', type: 'movie' }, 10, analysisModel, new AbortController().signal);
  await priorityTools.skipToSubtitleContent.execute({ userDescription: 'Earlier evidence' }, toolOptions);
  assert.equal(subtitleDownloads[priorityStart], 'https://official.test/en.srt', 'English filenames must not outrank explicit en language metadata');
  subtitleContent = Array.from({ length: 1000 }, (_, index) => {
    const start = new Date(index * 10_000).toISOString().slice(11, 23).replace('.', ',');
    const end = new Date(index * 10_000 + 2000).toISOString().slice(11, 23).replace('.', ',');
    return `${index + 1}\n${start} --> ${end}\n${index === 1 ? 'UNIQUE_JOINED_WORD_EVIDENCE black hole' : index < 700 ? 'Discussion of black hole theory' : 'SEMANTIC_LATE_CONTEXT: approaching Gargantua'}\n`;
  }).join('\n');
  const timelineTools = createAllTools({ id: 'tt-timeline', name: 'Timeline', type: 'movie' }, 10, analysisModel, new AbortController().signal);
  await timelineTools.skipToSubtitleContent.execute({ userDescription: 'black hole scene' }, toolOptions);
  assert.match(analysisPrompt, /SEMANTIC_LATE_CONTEXT/, 'Keyword matches must not exclude later semantic scenes from the model context');
  await timelineTools.skipToSubtitleContent.execute({ userDescription: 'blackhole scene' }, toolOptions);
  assert.match(analysisPrompt, /UNIQUE_JOINED_WORD_EVIDENCE/, 'Joined query words must retrieve matching spaced dialogue rather than falling back to sparse sampling');

  const museAttempts = [];
  const adaptiveMuse = new MockLanguageModelV4({ provider: 'opencode-responses.responses', modelId: 'muse-spark-1.3-contributor', doGenerate: async options => {
    museAttempts.push(options.providerOptions.openai.reasoningEffort);
    return { content: [{ type: 'text', text: JSON.stringify(sceneMatch()) }], usage, warnings: [], finishReason: { unified: 'stop', raw: 'stop' } };
  } });
  const adaptiveTools = createAllTools({ id: 'tt-adaptive', name: 'Adaptive', type: 'movie' }, 0, adaptiveMuse, new AbortController().signal);
  const adaptiveMatch = await adaptiveTools.skipToSubtitleContent.execute({ userDescription: 'blackhole scene' }, toolOptions);
  assert.equal(adaptiveMatch.success, true);
  assert.deepEqual(museAttempts, ['low'], 'Muse gets one evidence-selection pass with low reasoning');
  assert.equal(adaptiveMatch.timings.matchPasses, 1);
  const missingMuse = new MockLanguageModelV4({ provider: 'opencode-responses.responses', modelId: 'muse-spark-1.3-contributor', doGenerate: async () => ({
    content: [{ type: 'text', text: JSON.stringify(missingScene) }], usage, warnings: [], finishReason: { unified: 'stop', raw: 'stop' },
  }) });
  const missingTools = createAllTools({ id: 'tt-no-scene', name: 'No scene', type: 'movie' }, 0, missingMuse, new AbortController().signal);
  const stillMissing = await missingTools.skipToSubtitleContent.execute({ userDescription: 'A nonexistent scene' }, toolOptions);
  assert.equal(stillMissing.success, false);
  assert.equal(stillMissing.action, undefined, 'An unsupported scene must never prepare playback');
  assert.equal(missingMuse.doGenerateCalls.length, 1, 'Definite no-match must not repeat the same full subtitle analysis');
  assert.equal(stillMissing.timings.matchReasoningTokens, 0);

  const beforeVerificationFixture = subtitleContent;
  subtitleContent = '1\n00:00:05,000 --> 00:00:08,000\nI am going to tell him the truth tomorrow.\n\n2\n00:00:20,000 --> 00:00:23,000\nI lied to you. I was the one who took it.\n\n3\n00:00:30,000 --> 00:00:33,000\nDid you take it?\n';
  let selectionCalls = 0;
  const narrativeVerifier = new MockLanguageModelV4({ doGenerate: async options => {
    selectionCalls++;
    const prompt = JSON.stringify(options.prompt);
    assert.match(prompt, /not planning, discussion, recap/);
    assert.match(prompt, /C2\|I lied to you/);
    return { content: [{ type: 'text', text: JSON.stringify(sceneMatch('C2', ['C2'])) }], usage, warnings: [], finishReason: { unified: 'stop', raw: 'stop' } };
  } });
  const verifiedScene = await createAllTools({ id: 'tt-verification', name: 'Narrative fixture', type: 'movie' }, 0, narrativeVerifier, new AbortController().signal)
    .skipToSubtitleContent.execute({ userDescription: 'the confession' }, toolOptions);
  assert.equal(verifiedScene.timestamp, 20, 'Select the actual event using its original cue');
  assert.equal(verifiedScene.sceneEvidence[0].timestamp, 20);
  assert.equal(selectionCalls, 1, 'A valid selection does not repeat the full transcript');
  let rejectedSceneCalls = 0;
  const rejectingVerifier = new MockLanguageModelV4({ doGenerate: async () => {
    rejectedSceneCalls++;
    return { content: [{ type: 'text', text: JSON.stringify(sceneMatch('C1', ['C99'])) }], usage, warnings: [], finishReason: { unified: 'stop', raw: 'stop' } };
  } });
  const rejectedScene = await createAllTools({ id: 'tt-rejected', name: 'Narrative fixture', type: 'movie' }, 0, rejectingVerifier, new AbortController().signal)
    .skipToSubtitleContent.execute({ userDescription: 'an unsupported event' }, toolOptions);
  assert.equal(rejectedScene.success, false, 'Matched status cannot bypass invalid evidence validation');
  assert.equal(rejectedScene.action, undefined, 'Invalid evidence must never prepare playback');
  assert.equal(rejectedSceneCalls, 1, 'Invalid evidence must not start a semantic retry loop');
  subtitleContent = beforeVerificationFixture;


  const { explicitSceneCoordinates, parseScenePlaybackCommand } = load('lib/navigator-scene-intent.ts');
  assert.deepEqual(clone(explicitSceneCoordinates('Can you play that one episode of Nathan for You where he goes on Jimmy Kimmel')), {});
  assert.deepEqual(clone(explicitSceneCoordinates('go to the scene in S4E5')), { seasonNumber: 4, episodeNumber: 5 });
  assert.deepEqual(clone(explicitSceneCoordinates('play season four episode eight and skip to the scene')), { seasonNumber: 4, episodeNumber: 8 });
  assert.equal(parseScenePlaybackCommand('go to the blackhole scene in interstellar').mediaQuery, 'interstellar');
  assert.equal(parseScenePlaybackCommand('play the docking scene from Interstellar (2014)').userDescription, 'the docking scene');
  assert.equal(parseScenePlaybackCommand('play the scene in the barn from Interstellar'), null, 'Ambiguous scene/title boundaries use structured extraction');
  assert.equal(parseScenePlaybackCommand('play the black hole scene in that movie'), null);
  assert.equal(parseScenePlaybackCommand('what happens in the black hole scene in Interstellar?'), null);
  assert.equal(parseScenePlaybackCommand('play the black hole scene in Interstellar and explain it'), null);
  let sceneRouterCalls = 0;
  activeModel = new MockLanguageModelV4({ provider: 'opencode-responses.responses', modelId: 'muse-spark-1.3-contributor',
    doStream: async () => { sceneRouterCalls++; return stream([{ type: 'tool-call', toolCallId: 'agent-selected-scene', toolName: 'skipToSubtitleContent', input: JSON.stringify({ mediaQuery: 'Example', userDescription: 'a scene' }) }], 'tool-calls'); },
    doGenerate: async () => ({ content: [{ type: 'text', text: JSON.stringify(sceneMatch()) }], usage, warnings: [], finishReason: { unified: 'stop', raw: 'stop' } }),
  });
  const modelSelectionsBeforeScene = selectedModelIds.length;
  const directSceneResponse = await readResponse(await POST(request({ ...payload, pathname: '/', currentMedia: null,
    aiProvider: 'opencode', opencodeModel: 'muse-spark-1.3-contributor', opencodeApiKey: 'test-key', opencodeSessionId: 'test-session',
    analysisModel: 'unselected-analysis-model', // Legacy clients cannot override the selected model for nested tools.
    messages: [user('compound-scene', 'Go to a scene in Example')] })));
  assert.deepEqual(selectedModelIds.slice(modelSelectionsBeforeScene), ['muse-spark-1.3-contributor'], 'Create only the user-selected model, ignoring legacy analysis overrides for nested scene calls');
  assert.equal(sceneRouterCalls, 1, 'The agent selects the scene tool through the native tool loop');
  assert.equal(activeModel.doGenerateCalls.length, 1, 'Subtitle selection calls only the user-selected model once');
  const directScenePart = directSceneResponse.parts.find(part => part.type === 'tool-skipToSubtitleContent');
  assert.equal(directScenePart.output.success, true);
  assert.equal(directScenePart.output.action, 'play');
  assert.equal(typeof directScenePart.output.timings.matchSceneMs, 'number', 'Scene results expose timings for diagnosis');
  assert.equal(chat.modelToolOutput('skipToSubtitleContent', directScenePart.output).timings, undefined, 'Timing diagnostics do not inflate future model context');
  const streamedProgress = directSceneResponse.parts.filter(part => part.type === 'data-sceneProgress');
  assert.deepEqual(Array.from(streamedProgress, part => part.data.stage), ['title', 'subtitles', 'scene']);
  assert.ok(streamedProgress.every(part => part.data.state === 'completed'), 'SDK must update each stage in place rather than append duplicate traces');
  assert.ok(streamedProgress.every(part => part.data.toolCallId === directScenePart.toolCallId));
  const currentMovie = await readResponse(await POST(request({ ...payload, pathname: '/',
    currentMedia: { id: 'tt123', name: 'Example', type: 'movie', poster, backdropUrl: 'https://example.test/private.jpg' },
    aiProvider: 'opencode', opencodeModel: 'muse-spark-1.3-contributor', opencodeApiKey: 'test-key', opencodeSessionId: 'test-session',
    messages: [user('current-movie-scene', 'Seek to a scene in the movie playing now')] })));
  const currentMovieTitle = currentMovie.parts.find(part => part.type === 'data-sceneProgress' && part.data.stage === 'title').data.media;
  assert.equal(currentMovieTitle.poster, poster, 'Public playback artwork survives chat request validation and scene streaming');
  assert.equal(currentMovieTitle.background, undefined, 'Do not echo private client artwork URLs into scene progress');
  const previousCompoundSubtitles = subtitleContent;
  const modelPromptText = options => options.prompt.flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'text').map(part => part.text) : []).join('\n');
  const assertOriginalSceneRequest = (prompt, expected) => {
    const line = prompt.split('\n').find(line => line.startsWith('Original user request (verbatim JSON string): '));
    assert.ok(line, 'The final subtitle-model call must receive the original user request');
    assert.equal(JSON.parse(line.slice('Original user request (verbatim JSON string): '.length)), expected);
    assert.match(prompt, /By.*goes on.*Jimmy Kimmel/, 'The final model receives earlier reference-resolving dialogue');
  };
  let typoEpisodeCalls = 0;
  const typoPrompt = 'Go to the peisode of Nathan for u where he takes the paper frlm the laywer';
  activeModel = new MockLanguageModelV4({ provider: 'opencode-responses.responses', modelId: 'gpt-6-luna',
    doStream: async () => { typoEpisodeCalls++; return stream([{ type: 'tool-call', toolCallId: 'agent-episode', toolName: 'navigateToEpisode', input: JSON.stringify({ seriesQuery: 'Nathan for You', episodeQuery: typoPrompt }) }], 'tool-calls'); },
  });
  const typoEpisodeResponse = await readResponse(await POST(request({ ...payload, pathname: '/', currentMedia: null,
    aiProvider: 'opencode', opencodeModel: 'gpt-6-luna', opencodeApiKey: 'test-key', opencodeSessionId: 'test-session',
    messages: [user('typo-episode', typoPrompt)] })));
  assert.equal(typoEpisodeCalls, 1, 'The model, rather than a text regex, selects episode navigation for the misspelled request');
  assert.equal(typoEpisodeResponse.parts.find(part => part.type === 'tool-navigateToEpisode').input.episodeQuery, typoPrompt);
  activeModel = new MockLanguageModelV4({ provider: 'opencode-responses.responses', modelId: 'gpt-6-luna',
    doStream: async () => stream([{ type: 'tool-call', toolCallId: 'luna-scene-progress', toolName: 'skipToSubtitleContent', input: JSON.stringify({ mediaQuery: 'Example', userDescription: 'a fresh semantic scene for Luna' }) }], 'tool-calls'),
    doGenerate: async options => {
      assertOriginalSceneRequest(modelPromptText(options), 'I would like a fresh semantic scene in Example');
      return { content: [{ type: 'text', text: JSON.stringify(sceneMatch()) }], usage, warnings: [], finishReason: { unified: 'stop', raw: 'stop' } };
    },
  });
  const lunaSceneProgress = await readResponse(await POST(request({ ...payload, pathname: '/', currentMedia: null,
    aiProvider: 'opencode', opencodeModel: 'gpt-6-luna', opencodeApiKey: 'test-key', opencodeSessionId: 'test-session',
    messages: [sceneHistory.at(-2), user('luna-scene-progress-user', 'I would like a fresh semantic scene in Example')] })));
  assert.deepEqual(Array.from(lunaSceneProgress.parts.filter(part => part.type === 'data-sceneProgress'), part => part.data.stage), ['title', 'subtitles', 'scene'], 'Normal agent tools stream the same stages as the fast Muse workflow');
  assert.equal(lunaSceneProgress.parts.find(part => part.type === 'tool-skipToSubtitleContent').output.execution, 'prepared');
  let failedEpisodeSteps = 0;
  activeModel = new MockLanguageModelV4({ provider: 'opencode-responses.responses', modelId: 'gpt-6-luna',
    doStream: async () => { failedEpisodeSteps++; return stream([{ type: 'tool-call', toolCallId: 'failed-episode-once', toolName: 'navigateToEpisode', input: JSON.stringify({ seriesId: 'tmdb:114294', seasonNumber: 99, episodeQuery: 'Land of Enchantment' }) }], 'tool-calls'); },
  });
  const failedEpisodeTurn = await readResponse(await POST(request({ ...payload, pathname: '/', currentMedia: null,
    aiProvider: 'opencode', opencodeModel: 'gpt-6-luna', opencodeApiKey: 'test-key', opencodeSessionId: 'test-session',
    messages: [user('failed-episode-no-retry', 'Open Land of Enchantment in season 99 of The Curse')] })));
  assert.equal(failedEpisodeTurn.parts.find(part => part.type === 'tool-navigateToEpisode').output.status, 'not_found');
  assert.equal(failedEpisodeSteps, 1, 'An exhausted episode lookup must not fall back to another title search or repeat itself');
  let failedSceneSteps = 0;
  activeModel = new MockLanguageModelV4({ provider: 'opencode-responses.responses', modelId: 'gpt-6-luna',
    doStream: async () => { failedSceneSteps++; return stream([{ type: 'tool-call', toolCallId: 'failed-scene-once', toolName: 'skipToSubtitleContent', input: JSON.stringify({ mediaQuery: 'Example', userDescription: 'a nonexistent scene' }) }], 'tool-calls'); },
    doGenerate: async () => ({ content: [{ type: 'text', text: JSON.stringify(missingScene) }], usage, warnings: [], finishReason: { unified: 'stop', raw: 'stop' } }),
  });
  const failedSceneTurn = await readResponse(await POST(request({ ...payload, pathname: '/', currentMedia: null,
    aiProvider: 'opencode', opencodeModel: 'gpt-6-luna', opencodeApiKey: 'test-key', opencodeSessionId: 'test-session',
    messages: [user('failed-scene-no-fallback', 'I would like a nonexistent scene in Example')] })));
  assert.equal(failedSceneTurn.parts.find(part => part.type === 'tool-skipToSubtitleContent').output.success, false);
  assert.equal(failedSceneSteps, 1, 'A failed scene seek must end the turn instead of giving the agent a chance to substitute navigation/playback');


  activeModel = new MockLanguageModelV4({ doStream: async options => {
    const prompt = JSON.stringify(options.prompt);
    assert.match(prompt, /Example Director/);
    assert.match(prompt, /Directing/);
    assert.doesNotMatch(prompt, /Full biography|director\.jpg/);
    assert.ok(options.tools.some(tool => tool.name === 'navigateToPerson'));
    return stream([{ type: 'tool-call', toolCallId: 'open-person', toolName: 'navigateToPerson', input: JSON.stringify({ personId: 42 }) }], 'tool-calls');
  } });
  const personTurn = [user('profile-request', 'Open the profile for this director')];
  const profileResponse = await readResponse(await POST(request({ ...payload, pathname: '/person/42', messages: personTurn })));
  const [profileAction] = chat.preparedNavigatorActions([...personTurn, profileResponse]);
  assert.equal(profileAction.output.url, '/person/42');
  assert.equal(profileAction.output.mediaName, 'Example Director');
  assert.equal(profileAction.output.execution, 'prepared');

  activeModel = new MockLanguageModelV4({ provider: 'openai-compatible.chat', modelId: 'gpt-6-luna',
    doStream: async () => stream([{ type: 'text-start', id: 'custom' }, { type: 'text-delta', id: 'custom', delta: 'Hello' }, { type: 'text-end', id: 'custom' }], 'stop'),
  });
  await readResponse(await POST(request({ ...payload, pathname: '/', currentMedia: null, openaiBaseUrl: 'https://custom-compatible.example/v1', openaiModel: 'gpt-6-luna', messages: [user('custom-structured-config', 'hello')] })));
  assert.equal(compatibleSettings.at(-1).supportsStructuredOutputs, true, 'Compatible endpoints must receive json_schema for structured tool planning, not unstructured json_object');

  for (const apiKey of [' hosted-key ', '']) {
    await readResponse(await POST(request({ ...payload, aiProvider: 'ollama', ollamaModel: 'fixture-model', ollamaBaseUrl: 'https://hosted.example', ollamaApiKey: apiKey, pathname: '/', currentMedia: null, messages: [user('ollama-auth-' + !!apiKey, 'hello')] })));
    assert.equal(ollamaSettings.at(-1).baseURL, 'https://hosted.example');
    assert.equal(ollamaSettings.at(-1).headers?.Authorization, apiKey ? 'Bearer hosted-key' : undefined, 'Hosted Ollama sends the optional key; local Ollama needs no Authorization header');
  }
  const beforeMissingModel = ollamaSettings.length;
  const missingModel = await POST(request({ ...payload, aiProvider: 'ollama', ollamaModel: ' ', ollamaBaseUrl: 'https://hosted.example', pathname: '/', currentMedia: null, messages: [user('ollama-unconfigured', 'hello')] }));
  assert.equal(missingModel.status, 400);
  assert.match(await missingModel.text(), /Choose a model in Settings/);
  assert.equal(ollamaSettings.length, beforeMissingModel);

  const anthropicRequest = { ...payload, aiProvider: 'anthropic', anthropicModel: ' claude-sonnet-5-5 ',
    anthropicApiKey: ' fixture-anthropic-key ', pathname: '/', currentMedia: null, messages: [user('anthropic-auth', 'hello')] };
  await readResponse(await POST(request(anthropicRequest)));
  assert.equal(anthropicSettings.at(-1).apiKey, 'fixture-anthropic-key');
  assert.equal(typeof anthropicSettings.at(-1).fetch, 'function');
  assert.equal(selectedModelIds.at(-1), 'claude-sonnet-5-5');
  await readResponse(await POST(request({ ...anthropicRequest, anthropicModel: '' })));
  assert.equal(selectedModelIds.at(-1), 'claude-haiku-5-5');
  defaultModels.anthropic = undefined;
  const beforeAnthropic = anthropicSettings.length;
  const missingAnthropicModel = await POST(request({ ...anthropicRequest, anthropicModel: '' }));
  assert.equal(missingAnthropicModel.status, 400);
  assert.match(await missingAnthropicModel.text(), /Choose a model in Settings/);
  assert.equal(anthropicSettings.length, beforeAnthropic);

  // Real track discovery must start providers concurrently and retain provider ordering.
  overrides['./auth'] = { getInstalledAddons: async () => [
    { transportUrl: 'https://first.subtitle.test/manifest.json', manifest: { id: 'first', resources: ['subtitles'] } },
    { transportUrl: 'https://second.subtitle.test/manifest.json', manifest: { id: 'second', resources: ['subtitles'] } },
  ] };
  const subtitleUtils = load('app/actions/utils.ts');
  const pendingProviders = [];
  subtitleTransportFetch = (input, init) => new Promise(resolve => { pendingProviders.push({ input, init, resolve }); });
  const trackDiscovery = subtitleUtils.getSubtitleTracks('tt123');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(pendingProviders.length, 2, 'Subtitle providers must start concurrently instead of waiting for one another');
  assert.ok(pendingProviders.every(p => p.init.signal), 'Every provider request must have a timeout/cancellation signal');
  pendingProviders[1].resolve(new Response(JSON.stringify({ subtitles: [{ id: 'second', lang: 'eng', url: 'https://files.test/second.srt' }] }), { status: 200 }));
  pendingProviders[0].resolve(new Response(JSON.stringify({ subtitles: [{ id: 'first', lang: 'eng', url: 'https://files.test/first.srt', subtitleFileName: 'The.Anecdote.srt' }] }), { status: 200 }));
  const discoveredTracks = await trackDiscovery;
  assert.deepEqual(clone(discoveredTracks.map(track => track.id)), ['first', 'second'], 'Provider completion order must not randomly change subtitle preference');
  assert.equal(discoveredTracks[0].filename, 'The.Anecdote.srt', 'Preserve provider subtitle release names for episode identity checks');
  subtitleTransportFetch = undefined;
  activeModel = new MockLanguageModelV4({ doStream: async () => { throw new ai.APICallError({ message: 'rate limited', url: 'https://example.test', requestBodyValues: {}, statusCode: 429 }); } });
  const limited = await POST(request(payload));
  assert.match(await limited.text(), /rate limiting/, 'Provider errors must survive retries and the UI stream');
  activeModel = new MockLanguageModelV4({ doStream: async () => { throw new ai.APICallError({ message: 'tool_choice is not supported', responseBody: JSON.stringify({ error: { message: 'tool_choice is not supported' } }), url: 'https://example.test', requestBodyValues: {}, statusCode: 400 }); } });
  assert.match(await (await POST(request(payload))).text(), /couldn’t run that action/);
  activeModel = new MockLanguageModelV4({ doStream: async () => { throw new ai.APICallError({ message: 'Key expired', responseBody: JSON.stringify({ error: { code: 'api_key_expired' } }), url: 'https://example.test', requestBodyValues: {}, statusCode: 401 }); } });
  assert.match(await (await POST(request(payload))).text(), /API key has expired/);
  authenticated = false;
  assert.equal((await POST(request(payload))).status, 401);
  console.log('PASS: SDK 7 streaming and browser-tool continuation, page context, full latest requests, saved history, action replay prevention, spoiler protection, no-match scene search, private model projections, playback acknowledgement, cancellation, and request errors.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
