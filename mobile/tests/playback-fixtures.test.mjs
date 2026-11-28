import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPlaybackTime, seekTarget, validPlaybackUrl } from '../lib/playback-fixtures.ts';

test('direct playback accepts HTTPS only and does not accept URL credentials', () => {
  assert.equal(validPlaybackUrl(' https://example.org/sample.mp4?token=example '), 'https://example.org/sample.mp4?token=example');
  for (const url of ['http://example.org/a.mp4', 'file:///tmp/video', 'javascript:alert(1)', 'https://user:password@example.org/a', '', 'not a URL']) {
    assert.equal(validPlaybackUrl(url), null);
  }
});

test('seek target stays within a finite video duration', () => {
  assert.equal(seekTarget(14, 0.5), 7);
  assert.equal(seekTarget(14, -1), 0);
  assert.equal(seekTarget(14, 2), 13.9);
  assert.equal(seekTarget(0, 0.5), null);
  assert.equal(seekTarget(Infinity, 0.5), null);
  assert.equal(seekTarget(14, NaN), null);
});

test('playback clock formats invalid values and durations over an hour', () => {
  assert.equal(formatPlaybackTime(65.9), '1:05');
  assert.equal(formatPlaybackTime(3661), '1:01:01');
  for (const invalid of [-1, Infinity, NaN]) assert.equal(formatPlaybackTime(invalid), '0:00');
});
