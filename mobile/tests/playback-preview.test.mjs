import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaybackPreviewPipeline, playbackPreviewTime } from '../lib/playback-preview.ts';

function deferredExtractor() {
  const calls = [];
  const pending = [];
  return {
    calls,
    extract(time) {
      calls.push(time);
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
    async complete(frame) {
      pending.shift().resolve(frame);
      await Promise.resolve();
    },
    async fail() {
      pending.shift().reject(new Error('Frame unavailable'));
      await Promise.resolve();
    },
  };
}

test('scrub timestamps are stable, bounded, and independent of chapter accuracy', () => {
  assert.equal(playbackPreviewTime(1.45, 10), 1);
  assert.equal(playbackPreviewTime(1.51, 10), 2);
  assert.equal(playbackPreviewTime(1.5123, 10, true), 1.512);
  assert.equal(playbackPreviewTime(10, 10), 9);
  assert.equal(playbackPreviewTime(10, 10, true), 9.9);
  assert.equal(playbackPreviewTime(0, .05), 0);
  assert.equal(playbackPreviewTime(-1, 10), null);
  assert.equal(playbackPreviewTime(Infinity, 10), null);
  assert.equal(playbackPreviewTime(1, 0), null);
});

test('one extraction at a time, duplicate buckets share work, obsolete scrubs never publish', async () => {
  const decoder = deferredExtractor();
  const p = createPlaybackPreviewPipeline({ duration: 120, extract: decoder.extract });
  const first = p.requestScrub(1.1);
  const same = p.requestScrub(1.3);
  assert.equal(same, first);
  const second = p.requestScrub(20);
  const third = p.requestScrub(30);
  assert.equal(await first, null);
  assert.equal(await second, null);
  assert.deepEqual(decoder.calls, [1]);
  await decoder.complete('first');
  assert.deepEqual(decoder.calls, [1, 30]);
  await decoder.complete('third');
  assert.deepEqual(await third, { time: 30, frame: 'third' });
  assert.deepEqual(await p.requestScrub(1.4), { time: 1, frame: 'first' });
  assert.deepEqual(decoder.calls, [1, 30]);
});

test('chapter requests use the same worker, share timestamps and wait behind interactive scrubs', async () => {
  const decoder = deferredExtractor();
  const p = createPlaybackPreviewPipeline({ duration: 120, extract: decoder.extract, maxQueuedChapters: 2 });
  const current = p.requestChapter(10.25);
  const queued = p.requestChapter(20);
  assert.equal(queued, p.requestChapter(20));
  assert.equal(await p.requestChapter(30), null);
  const scrub = p.requestScrub(20);
  assert.deepEqual(decoder.calls, [10.25]);
  await decoder.complete('chapter');
  assert.deepEqual(await current, { time: 10.25, frame: 'chapter' });
  assert.deepEqual(decoder.calls, [10.25, 20]);
  await decoder.complete('both');
  assert.deepEqual(await queued, await scrub);
  assert.deepEqual(decoder.calls, [10.25, 20]);
});

test('cache honors decoded-byte and entry limits with LRU eviction', async () => {
  const calls = [];
  const p = createPlaybackPreviewPipeline({ duration: 120, extract: async time => { calls.push(time); return String(time); }, bytes: () => 4, maxEntries: 3, maxBytes: 8 });
  await p.requestScrub(1);
  await p.requestScrub(2);
  assert.equal(p.getCached(1).frame, '1');
  await p.requestScrub(3);
  assert.equal(p.getCached(2), null);
  await p.requestScrub(1);
  assert.deepEqual(calls, [1, 2, 3]);
  await p.requestScrub(2);
  assert.deepEqual(calls, [1, 2, 3, 2]);
  const byCount = createPlaybackPreviewPipeline({ duration: 100, extract: async time => time, maxEntries: 1 });
  await byCount.requestScrub(1);
  await byCount.requestScrub(2);
  assert.equal(byCount.getCached(1), null);
  assert.equal(byCount.getCached(2).frame, 2);
});

test('cancellation drops interactive result, permits retry, and preserves chapter request', async () => {
  const decoder = deferredExtractor();
  const p = createPlaybackPreviewPipeline({ duration: 100, extract: decoder.extract });
  const scrub = p.requestScrub(4);
  const chapter = p.requestChapter(4);
  p.cancelScrub();
  assert.equal(await scrub, null);
  await decoder.fail();
  assert.equal(await chapter, null);
  const retry = p.requestScrub(4);
  await decoder.complete('retry');
  assert.deepEqual(await retry, { time: 4, frame: 'retry' });
  assert.deepEqual(decoder.calls, [4, 4]);
});

test('disposed source resolves pending work and ignores late native completions', async () => {
  const decoder = deferredExtractor();
  const p = createPlaybackPreviewPipeline({ duration: 100, extract: decoder.extract });
  const scrub = p.requestScrub(5);
  const chapter = p.requestChapter(40);
  p.dispose();
  assert.equal(await scrub, null);
  assert.equal(await chapter, null);
  await decoder.complete('old source');
  assert.deepEqual(decoder.calls, [5]);
  assert.equal(p.getCached(5), null);
  assert.equal(await p.requestScrub(5), null);
  assert.equal(await p.requestChapter(40), null);
});
