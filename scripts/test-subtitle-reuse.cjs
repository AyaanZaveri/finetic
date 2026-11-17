const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient, timeoutManager } = require('@tanstack/react-query');
const { load } = require('./test-support/react-hooks.cjs');
timeoutManager.setTimeoutProvider({
  setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout,
  setInterval: (fn, ms) => { const timer = setInterval(fn, ms); timer.unref(); return timer; }, clearInterval,
});
const globals = { TextEncoder, URLSearchParams, DOMException };
const { createSubtitleQueries } = load('lib/media/subtitle-queries.ts', {}, globals);
const { subtitleMediaKey, snapshotSubtitles, isCurrentSubtitleTarget, subtitleSnapshotSchema } = load('lib/media/subtitle-snapshot.ts');
const preference = load('lib/media/subtitle-preference.ts');
const { parseSubtitleTextContent } = load('lib/media/subtitle-content.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
const text = 'WEBVTT\n\n00:00:10.000 --> 00:00:12.000\n[door opens]\nThe secret is out.\n\n00:00:20.000 --> 00:00:22.000\nWe should go.';
const tracks = [
  { src: 'https://fixture.test/fr', label: 'French SDH', language: 'fr', kind: 'subtitles' },
  { src: 'https://fixture.test/en', label: 'English', language: 'en', kind: 'subtitles' },
  { src: 'https://fixture.test/sdh?credential=private', label: 'English SDH', language: 'eng', kind: 'subtitles' },
  { src: 'https://fixture.test/forced', label: 'English SDH forced', language: 'en', forced: true, kind: 'subtitles' },
];
async function main() {
  assert.equal(preference.preferredSubtitleTrack(tracks, 'en', 'normal'), tracks[2]);
  assert.equal(preference.preferredSubtitleTrack(tracks, 'fr', 'normal'), tracks[0], 'Explicit language choices still work');
  assert.equal(preference.preferredSubtitleTrack(tracks, 'en', 'forced'), tracks[3]);
  assert.ok(preference.navigatorSubtitleRank(tracks[1]) > preference.navigatorSubtitleRank(tracks[0]), 'English before foreign SDH');
  assert.ok(preference.navigatorSubtitleRank(tracks[2]) > preference.navigatorSubtitleRank(tracks[1]));
  assert.equal(preference.isEnglishSubtitle({ language: 'fr', filename: 'English.SDH.srt' }), false, 'Release names cannot override language metadata');
  assert.equal(preference.isSDHSubtitle({ label: 'English [CC]' }), true);
  assert.equal(preference.isSDHSubtitle({ hearing_impaired: true }), true);
  assert.equal(preference.preferredSubtitleTrack([{ language: 'unknown', filename: 'Movie.English.SDH.srt', src: 'sdh' }], 'en', 'normal').src, 'sdh');
  assert.equal(parseSubtitleTextContent(text).length, 2);
  assert.equal(parseSubtitleTextContent('1\n00:00:20,000 --> 00:00:10,000\nbad').length, 0);

  const client = new QueryClient(), calls = [], requests = [];
  const store = createSubtitleQueries(client, 'user:session', async (...args) => { calls.push(args); return tracks; },
    (src, signal) => new Promise((resolve, reject) => { requests.push({ src, signal, resolve, reject }); }));
  const movie = { id: 'tt123', type: 'movie', name: 'Movie', subtitleFilename: 'release.mkv', subtitleVideoSize: 1000 };
  const episode = { ...movie, id: 'tt456', type: 'series', mediaSourceId: 'tt456:2:3', seasonNumber: 2, episodeNumber: 3 };
  try {
    await Promise.all([store.discover('tt123', 'movie', {}), store.discover('tt123', 'movie', {})]);
    assert.equal(calls.length, 1, 'Catalog requests share pending work');
    await store.discover('tt123', 'movie', { filename: 'another-release.mkv' });
    assert.equal(calls.length, 2, 'Release changes get a separate catalog');

    let release = store.publish(movie, tracks, tracks[2].src, 1.5);
    const canceled = new AbortController();
    const preload = store.file(tracks[2].src, canceled.signal, subtitleMediaKey(movie));
    const selection = store.file(tracks[2].src, undefined, subtitleMediaKey(movie));
    const snapshotPromise = store.snapshot(movie);
    assert.equal(await snapshotPromise, undefined, 'Chat never waits for an unfinished subtitle download');
    await tick();
    assert.equal(requests.length, 1, 'Preload, selection and Navigator share one file download');
    canceled.abort(); await assert.rejects(preload);
    assert.equal(requests[0].signal.aborted, false, 'One canceled consumer cannot stop another');
    requests[0].resolve({ success: true, content: text });
    const file = await selection, snapshot = await store.snapshot(movie);
    assert.equal(file.cues.length, 2);
    assert.equal(snapshot.track.label, 'English SDH');
    assert.equal(snapshotSubtitles(snapshot, movie)[0].timestamp, 11.5, 'Apply positive sync delay exactly once');
    assert.equal(snapshotSubtitles(snapshot, movie)[0].timestampFormatted, '00:00:11.500');
    assert.ok(!JSON.stringify(snapshot).includes('credential='), 'Never hand subtitle URLs to chat');
    assert.equal(await store.file(tracks[2].src, undefined, subtitleMediaKey(movie)), file, 'Parsed data is reused');
    assert.equal(requests.length, 1);
    assert.ok(client.getQueryCache().findAll({ queryKey: ['subtitles', 'user:session', 'file'] }).some(query => query.getObserversCount()),
      'Active captions remain observed for long movies');
    assert.equal(await store.snapshot({ ...movie, id: 'tt999' }), undefined);
    assert.equal(snapshotSubtitles(snapshot, { ...movie, subtitleFilename: 'different.mkv' }), undefined);
    assert.equal(snapshotSubtitles(snapshot, episode), undefined);
    release();
    release = store.publish(episode, tracks, tracks[2].src, -2);
    assert.equal(await store.snapshot(episode), undefined, 'Same URL from a different title is not a transcript cache hit');
    const episodeFile = store.file(tracks[2].src, undefined, subtitleMediaKey(episode));
    await tick(); requests.at(-1).resolve({ success: true, content: text }); await episodeFile;
    const episodeSnapshot = await store.snapshot(episode);
    assert.equal(snapshotSubtitles(episodeSnapshot, episode)[0].timestamp, 8);
    assert.equal(snapshotSubtitles(episodeSnapshot, { ...episode, mediaSourceId: 'tt456:2:4', episodeNumber: 4 }), undefined);
    assert.equal(isCurrentSubtitleTarget(episode, { id: 'tt456:2:3', type: 'series' }), true);
    assert.equal(isCurrentSubtitleTarget(episode, { id: 'tt456', type: 'series', seasonNumber: 2, episodeNumber: 3 }), true);
    assert.equal(isCurrentSubtitleTarget(episode, { id: 'tt789:2:3', type: 'series' }), false);
    assert.equal(isCurrentSubtitleTarget(episode, { id: 'tt456:2:4', type: 'series', episodeNumber: 3 }), false, 'Contradictory coordinates cannot reuse current playback');
    assert.equal(isCurrentSubtitleTarget(movie, { id: 'tt123', type: 'movie' }), true);
    release();
    assert.equal(await store.snapshot(episode), undefined, 'Closed playback cannot expose its transcript');

    const refinedMovie = { ...movie, subtitleFilename: "final-release.mkv" };
    const beforeSeed = requests.length;
    const seededRelease = store.publish(refinedMovie, tracks, tracks[2].src, 0, file.cues);
    assert.ok(await store.snapshot(refinedMovie), 'Applied captions seed final release identity without refetch');
    assert.equal(requests.length, beforeSeed);
    seededRelease();
    const foreign = createSubtitleQueries(client, 'another-session', async () => tracks, async () => ({ success: true, content: text }));
    foreign.publish(movie, tracks, tracks[2].src, 0);
    assert.equal(await foreign.snapshot(movie), undefined, 'Separate sessions do not share files');
    foreign.dispose();
    const failed = store.file('https://fixture.test/fails'); await tick(); requests.at(-1).reject(Error('offline'));
    await assert.rejects(failed);
    const retry = store.file('https://fixture.test/fails'); await tick(); requests.at(-1).resolve({ success: true, content: text }); await retry;
    assert.equal(requests.filter(request => request.src.endsWith('fails')).length, 2, 'Errors do not poison retry');
    assert.equal(subtitleSnapshotSchema.safeParse({ ...snapshot, cues: [{ ...snapshot.cues[0], timestamp: Infinity }] }).success, false);
    assert.equal(subtitleSnapshotSchema.safeParse({ ...snapshot, cues: Array(20001).fill(snapshot.cues[0]) }).success, false);

    // Exercise the real server loader and all three tools, with provider/model boundaries mocked.
    let discoveries = 0, downloads = 0, preparations = 0, authenticated = true;
    const deps = {
      ai: { tool: definition => definition },
      '@/lib/server/auth': { getAuthData: async () => { if (!authenticated) throw Error('signed out'); return { user: { _id: 'user' } }; } },
      '@/app/actions/utils': { getSubtitleTracks: async () => { discoveries++; return tracks; } },
      '@/app/actions/subtitles': { fetchSubtitleFileContent: async src => { downloads++; assert.equal(src, tracks[2].src); return { success: true, content: text }; } },
      './media': { playMedia: { execute: async () => { preparations++; throw Error('Current video must not be prepared again'); } }, searchMedia: {} },
      './episodes': { createEpisodeTools: () => ({}) },
      '@/lib/navigator-model-settings': { navigatorRoutingSettings: () => ({}) },
      '@/lib/navigator-structured-output': { generateNavigatorObject: async input => ({
        output: input.task === 'subtitle-analysis' ? { answer: 'A secret was revealed.', evidence: [1] } : { candidate: 1, confidence: 'high' },
        totalUsage: { outputTokenDetails: {} },
      }) },
    };
    const tools = load('app/tools/subtitles.ts', deps, { console: { log() {}, error() {} } });
    const sceneContext = { originalRequest: 'skip to the secret', conversation: [], titleReferences: [] };
    for (const media of [movie, episode]) {
      const snap = { ...snapshot, mediaKey: subtitleMediaKey(media) };
      const loaded = await tools.loadParsedSubtitles(media, 0, undefined, snap);
      assert.equal(loaded.subtitles[0].timestamp, 11.5);
      const scene = tools.skipToSubtitleContent(media, 'fixture-model', undefined, sceneContext, snap);
      const input = { userDescription: 'secret', mediaId: media.mediaSourceId || media.id, mediaName: media.name,
        mediaType: media.type === 'movie' ? 'Movie' : 'Episode', seasonNumber: media.seasonNumber, episodeNumber: media.episodeNumber };
      const result = await scene.execute(input, {});
      assert.equal(result.success, true); assert.equal(result.action, 'skipTo'); assert.equal(result.timestamp, 11.5);
      const explain = await tools.createExplainScene(media, 'fixture-model', undefined, 30, snap).execute({ currentTimestamp: 20, contextWindow: 30 }, {});
      assert.equal(explain.success, true);
      const analyze = await tools.createAnalyzeMedia(media, 'fixture-model', undefined, 30, snap).execute({ userQuestion: 'What happened?' }, {});
      assert.equal(analyze.success, true);
    }
    assert.equal(discoveries, 0); assert.equal(downloads, 0); assert.equal(preparations, 0);
    await tools.loadParsedSubtitles({ ...movie, id: 'tt888' }, 0, undefined, snapshot);
    assert.equal(discoveries, 1); assert.equal(downloads, 1, 'Wrong title falls back to a fresh English SDH lookup');
    const foreignSnapshot = { ...snapshot, track: { ...snapshot.track, language: 'es', label: 'Spanish SDH' } };
    const beforeForeign = discoveries;
    const english = await tools.loadParsedSubtitles(movie, 0, undefined, foreignSnapshot);
    assert.equal(discoveries, beforeForeign + 1, 'Spanish cached cues cannot bypass English external discovery');
    assert.equal(english.selectedTrackLanguage, tracks[2].language);
    assert.equal(english.selectedTrackLabel, 'English SDH');
    authenticated = false;
    await assert.rejects(tools.loadParsedSubtitles(movie, 0, undefined, snapshot), /signed out/);

    // Verify the actual client transport hands cues across the server boundary.
    const askSource = fs.readFileSync('components/navigator/ai-ask.tsx', 'utf8');
    const askAst = ts.createSourceFile('ask.tsx', askSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let bodyFunction;
    function findBody(node) {
      if (ts.isNewExpression(node) && node.expression.getText(askAst) === 'DefaultChatTransport') {
        bodyFunction = node.arguments[0].properties.find(property => property.name?.getText(askAst) === 'body').initializer.getText(askAst);
      }
      ts.forEachChild(node, findBody);
    }
    findBody(askAst);
    const transportBody = vm.runInNewContext(ts.transpileModule(`(${bodyFunction})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
      { requestBodyRef: { current: { currentMedia: movie, messages: [] } }, subtitleSnapshotRef: { current: Promise.resolve(snapshot) } });
    const payload = await transportBody();
    assert.equal(payload.currentSubtitles, snapshot); assert.equal(payload.messages.length, 0);

    // A new playback request can render before the previous subtitle state resets.
    const playerSource = fs.readFileSync('components/global-media-player.tsx', 'utf8');
    const playerAst = ts.createSourceFile('player.tsx', playerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let publishEffect;
    function findPublish(node) {
      if (ts.isCallExpression(node) && node.expression.getText(playerAst) === 'useEffect'
        && node.arguments[0]?.getText(playerAst).includes('subtitleQueries.publish')) publishEffect = node.arguments[0].getText(playerAst);
      ts.forEachChild(node, findPublish);
    }
    findPublish(playerAst);
    let published = 0;
    const previousRequest = {}, nextRequest = {};
    const publish = vm.runInNewContext(ts.transpileModule(`(${publishEffect})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
      { currentMedia: episode, isPlayerVisible: true, subtitleQueries: { publish() { published++; } },
        subtitleCatalogOwner: { current: previousRequest }, playbackRequest: nextRequest, subtitleTracks: tracks, subtitleTiming: { seconds: 0 }, subtitleData: file.cues });
    publish(); assert.equal(published, 0, 'Old cues cannot be published under a new episode identity');

    const bounded = createSubtitleQueries(client, 'bounded', async () => tracks, async () => ({ success: true, content: text }));
    for (let index = 0; index < 40; index++) await bounded.file(`https://fixture.test/${index}`, undefined, String(index));
    assert.ok(client.getQueryCache().findAll({ queryKey: ['subtitles', 'bounded'] }).length <= 24, 'Inactive cache entries are bounded');
    bounded.dispose();
    assert.equal(client.getQueryCache().findAll({ queryKey: ['subtitles', 'bounded'] }).length, 0, 'Session cleanup removes retained transcripts');
    console.log('PASS: movie/episode reuse, in-flight sharing, cancellation, identity/release/session isolation, sync offsets, English SDH ranking, retry, bounds, and all three server tools without redundant downloads');
  } finally { store.dispose(); client.clear(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
