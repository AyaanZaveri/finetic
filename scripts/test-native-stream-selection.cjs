const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');
const { resolvePlayback } = load('lib/media/resolve-playback.ts', {}, { AbortController, DOMException, setTimeout, clearTimeout });
const { getStreamCacheStatus } = load('lib/media/stream-cache-status.ts');
for (const [fixture, expected] of [
 [{ name: '[RD+]' }, 'cached'],
 [{ name: '⚡️ 1080p' }, 'cached'],
 [{ description: 'Cache hit' }, 'cached'],
 [{ cached: true }, 'cached'],
 [{ name: '[RD download]' }, 'uncached'],
 [{ name: '[TB-]' }, 'uncached'],
 [{ name: '🧲 1080p' }, 'uncached'],
 [{ name: '⏳ 1080p' }, 'uncached'],
 [{ description: 'Not yet cached' }, 'uncached'],
 [{ isCached: false, name: '⚡️' }, 'uncached'],
 [{ behaviorHints: { cached: false } }, 'uncached'],
 [{ url: 'https://fixture.test/cached-or-uncached.mp4', behaviorHints: { filename: 'Cached.mp4' } }, 'unknown'],
 [{ name: '1080p WEB-DL' }, 'unknown'],
]) assert.equal(getStreamCacheStatus(fixture), expected, JSON.stringify(fixture));
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function source() {
 let resolve, reject; const listeners = new Set();
 const value = { id: 'movie', type: 'movie', canonicalId: Promise.resolve('movie'),
  promise: new Promise((yes, no) => { resolve = yes; reject = no; }),
  snapshot: { streams: [], complete: false, pending: 3, total: 3, settledPrefix: 0 },
  subscribe(fn) { listeners.add(fn); fn(value.snapshot); return () => listeners.delete(fn); },
  publish(streams, settledPrefix, complete = false) {
   value.snapshot = { streams, settledPrefix, complete, pending: complete ? 0 : 1, total: 3 };
   for (const fn of listeners) fn(value.snapshot);
   if (complete) resolve(streams);
  }, reject, listeners };
 return value;
}
const stream = (id, addonIndex, title = 'English') => ({ url: `https://fixture.test/${id}.mkv`, addonIndex, addonId: String(addonIndex), addonName: String(addonIndex), title });
const request = { id: 'movie', type: 'movie', name: 'Movie' };
const deps = { environment: 'native', preferredAudioLanguage: 'en', fetchStreams: () => assert.fail('Use shared discovery'), getNextEpisodeForSeries: async () => null, inspectStream: () => assert.fail('Native must not add a web probe'), verifyStream: () => assert.fail('Native must not add a web probe') };
async function main() {
 const first = source(); let result;
 const early = resolvePlayback(request, { ...deps, createStreamRequest: () => first }, () => {}).then(value => { result = value; return value; });
 first.publish([stream('fast', 0)], 1); await flush();
 assert.equal(result?.streamUrl, 'https://fixture.test/fast.mkv', 'The first source in a settled prefix must start without waiting for lower-priority add-ons');
 assert.equal(result.streamRequest, first); assert.equal(first.listeners.size, 0);
 first.publish([stream('fast', 0), stream('late', 2)], 3, true); await early;
 for (const title of ['English', 'Multi English German', '1080p H264']) {
  const pending = source(); let selected;
  const playback = resolvePlayback({ ...request, streamRequest: pending }, deps, () => {}).then(value => { selected = value; return value; });
  pending.publish([stream('later', 1, title)], 0); await flush();
  assert.equal(selected, undefined, 'A pending earlier add-on can still change the winner');
  pending.publish([stream('earlier', 0), stream('later', 1, title)], 2); await flush();
  assert.equal(selected?.streamUrl, 'https://fixture.test/earlier.mkv');
  await playback;
 }
 for (const title of ['Multi English German', '1080p H264', 'German']) {
  const pending = source(); let selected;
  const playback = resolvePlayback({ ...request, streamRequest: pending }, deps, () => {}).then(value => { selected = value; return value; });
  pending.publish([stream('unknown', 0, title)], 1); await flush(); assert.equal(selected?.streamUrl, 'https://fixture.test/unknown.mkv', 'Language metadata must not alter ordinary Play');
  pending.publish([stream('unknown', 0, title), stream('preferred', 1)], 3, true);
  assert.equal((await playback).streamUrl, 'https://fixture.test/unknown.mkv');
 }
 const firstListed = { ...stream('first-listed', 0, 'English Italian'), name: '4K ⚡', behaviorHints: { filename: 'Movie.2160p.ITA.ENG.mkv' } };
 const laterListed = { ...stream('later-listed', 0, 'English'), name: '1080p ⚡' };
 const mixedList = [firstListed, laterListed];
 const selectCompleted = (streams, environment = 'native') => resolvePlayback(request, { ...deps, environment, fetchStreams: async () => streams }, () => {});
 for (const environment of ['native', 'web']) {
  assert.equal((await selectCompleted(mixedList, environment)).streamUrl, firstListed.url, 'Play must use the first listed source rather than reordering by language');
  const firstUnmarked = { ...firstListed, name: '4K' };
  assert.equal((await selectCompleted([firstUnmarked, laterListed], environment)).streamUrl, firstUnmarked.url, 'Do not guess debrid cache status or change the configured add-on order');
  const direct = await resolvePlayback({ ...request, streamUrl: laterListed.url }, { ...deps, environment }, () => {});
  assert.equal(direct.streamUrl, laterListed.url, 'An explicit selection reaches the exact selected source');
 }
 const cancelled = source(), abort = new AbortController();
 const cancellation = resolvePlayback({ ...request, streamRequest: cancelled }, { ...deps, signal: abort.signal }, () => {});
 const rejected = assert.rejects(cancellation, /cancelled/); abort.abort(new Error('cancelled')); await rejected;
 assert.equal(cancelled.listeners.size, 0);
 cancelled.publish([stream('late', 0)], 3, true);
 const failed = source(); const failure = resolvePlayback({ ...request, streamRequest: failed }, deps, () => {});
 const failureCheck = assert.rejects(failure, /provider failed/); failed.reject(new Error('provider failed')); await failureCheck;
 const empty = source(); const noStreams = resolvePlayback({ ...request, streamRequest: empty }, deps, () => {});
 const emptyCheck = assert.rejects(noStreams, /No playable streams/); empty.publish([], 3, true); await emptyCheck;
 const manual = await resolvePlayback({ ...request, streamUrl: 'https://fixture.test/manual.mkv' }, { ...deps, createStreamRequest: () => assert.fail('Manual selection must not start discovery') }, () => {});
 assert.equal(manual.streamUrl, 'https://fixture.test/manual.mkv');
 const { nextEpisodeRequest } = load('lib/media/episode-continuation.ts');
 const nextEpisode = nextEpisodeRequest({ id: 'tt123', type: 'series', name: 'Example Show',
  subtitleFilename: 'Example.Show.S06E09.The.Golden.Child.1080p.WEB-DL.H264.AAC-NTb.mkv' },
 { id: 'tt123:7:1', title: 'Manhunter', season: 7, episode: 1 });
 const otherRelease = { ...stream('other', 0), behaviorHints: { filename: 'Example.Show.S07E01.Manhunter.1080p.WEB-DL.H264.AAC-Other.mkv' } };
 const sameGroup = { ...stream('same-group', 1), behaviorHints: { filename: 'Example.Show.S07E01.Manhunter.1080p.WEB-DL.H264.AAC-NTb.mkv' } };
 const changedQuality = { ...stream('other-quality', 0), behaviorHints: { filename: 'Example.Show.S07E01.Manhunter.720p.WEB-DL.H264.AAC-NTb.mkv' } };
 const conflictingGroup = { ...sameGroup, title: 'German' };
 const prefer = candidates => resolvePlayback(nextEpisode, { ...deps, fetchStreams: async () => candidates }, () => {});
 assert.equal((await prefer([otherRelease, changedQuality, sameGroup])).streamUrl, sameGroup.url, 'A new title or season can match a release group with the same format');
 assert.equal((await prefer([otherRelease, changedQuality])).streamUrl, otherRelease.url, 'A group alone does not override the normal ranking');
 assert.equal((await prefer([otherRelease, conflictingGroup])).streamUrl, otherRelease.url, 'Release preference remains below the configured audio language');
 const similarRelease = (id, tags) => ({
  ...stream(id, 1), behaviorHints: { filename: `Example.Show.S07E01.Manhunter.${tags}.mkv` },
 });
 const reordered = similarRelease('reordered', '1080p.AAC.H264.WEB-DL.PROPER');
 const anotherSimilar = similarRelease('another-similar', '1080p.WEB-DL.AAC.H264.REPACK');
 const titleOnly = similarRelease('title-only', '1080p.H264.AAC');
 assert.equal((await prefer([otherRelease, titleOnly, reordered])).streamUrl, reordered.url, 'A clear similarity winner can have reordered and extra tags');
 assert.equal((await prefer([otherRelease, reordered, sameGroup])).streamUrl, sameGroup.url, 'A group and format match outranks similarity');
 assert.equal((await prefer([otherRelease, reordered, anotherSimilar])).streamUrl, otherRelease.url, 'Ambiguous similarity falls back to add-on order');
 const reference = { ...nextEpisode, episodeReleasePreference: {
  filename: 'Example.Show.S06E09.The.Golden.Child.1080p.WEB-DL.H264.AAC.5.1.8bit.EXTENDED.PROPER-NTb.mkv',
 } };
 const preferReference = candidate => resolvePlayback(reference, {
  ...deps, fetchStreams: async () => [otherRelease, candidate],
 }, () => {});
 const commonTags = 'WEB-DL.AAC.5.1.8bit.EXTENDED.PROPER';
 const withoutGroup = similarRelease('without-group', `1080p.H264.${commonTags}`);
 assert.equal((await preferReference(withoutGroup)).streamUrl, withoutGroup.url, 'A longer matching tag list can make a strong similarity match');
 for (const tags of [`720p.H264.${commonTags}`, `1080p.H265.${commonTags}`, `1080p.H264.${commonTags}-Other`]) {
  assert.equal((await preferReference(similarRelease('conflict', tags))).streamUrl, otherRelease.url, `Conflicting tags block even high similarity: ${tags}`);
 }
 // Every completion order and language-tier combination must keep the first provider source.
 const titles = ['German', '1080p H264', 'Multi English German', 'English'];
 const orders = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
 for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) {
  const tiers = [a,b,c];
  const candidates = tiers.map((tier,index) => stream(String(index), index, titles[tier]));
  const expected = 0;
  for (const order of orders) {
   const provider = source(), settled = [false,false,false];
   const playback = resolvePlayback({ ...request, streamRequest: provider }, deps, () => {});
   for (const index of order) {
    settled[index] = true;
    let prefix = 0; while (settled[prefix]) prefix++;
    provider.publish(candidates.filter((_, i) => settled[i]), prefix, settled.every(Boolean));
    await flush();
   }
   assert.equal((await playback).streamUrl, candidates[expected].url, 'Early selection must equal full discovery across 384 order/tier cases');
   assert.equal(provider.listeners.size, 0);
  }
 }
 const alreadyCancelled = source();
 const aborted = resolvePlayback({ ...request, streamRequest: alreadyCancelled }, { ...deps, signal: AbortSignal.abort(new Error('already cancelled')) }, () => {});
 await assert.rejects(aborted, /already cancelled/);
 alreadyCancelled.reject(new Error('late discovery error')); await flush();
 const duplicates = source();
 const deduped = resolvePlayback({ ...request, streamRequest: duplicates }, deps, () => {});
 duplicates.publish([stream('same', 0, 'German'), stream('same', 1), stream('different', 2)], 3, true);
 assert.equal((await deduped).streamUrl, 'https://fixture.test/same.mkv', 'Duplicate URLs retain the first provider entry');
 console.log('PASS: progressive native selection preserves provider order and continuation release preferences, keeps late results, avoids probes, and handles cancellation/errors/manual URLs');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
