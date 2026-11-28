import test from 'node:test';
import assert from 'node:assert/strict';
import { detailStreamTarget, filterStreams, getStreamFilterTags, getStreamPresentation, isSelectableStream, matchesStreamFilters } from '../lib/stream-selection.ts';
import { streamTargetId } from '../lib/stream-api.ts';
import { getStreamFilterTags as getWebStreamFilterTags } from '../../lib/media/stream-release-info.ts';

test('Play keeps movie, series overview and episode route identities distinct', () => {
  const active = { season: 2, number: 3 };
  const route = { season: 0, number: 4 };
  assert.equal(streamTargetId(detailStreamTarget('movie', 'tt123', undefined, active)), 'tt123');
  assert.equal(streamTargetId(detailStreamTarget('series', 'tt123', undefined, active)), 'tt123:2:3');
  assert.equal(streamTargetId(detailStreamTarget('series', 'tt123', route, active)), 'tt123:0:4');
  assert.equal(detailStreamTarget('series', 'tmdb:123', route), null);
  assert.equal(detailStreamTarget('series', 'tt123'), null);
  assert.equal(detailStreamTarget('series', 'tt123', { season: 1, number: 0 }, active), null);
  assert.equal(detailStreamTarget('movie', 'invalid'), null);
});

test('stream filters use OR within a group and AND across groups', () => {
  assert.equal(matchesStreamFilters(new Set(['2160p', 'hdr10']), ['2160p', '1080p', 'hdr10']), true);
  assert.equal(matchesStreamFilters(new Set(['2160p']), ['2160p', 'hdr10']), false);
  assert.equal(matchesStreamFilters(new Set(), []), true);
});

test('stream tags recognize common labels', () => {
  const tags = getStreamFilterTags({ name: '2160p WEB-DL HEVC HDR10+ Atmos', title: '' });
  for (const tag of ['2160p', 'webdl', 'hevc', 'hdr10plus', 'atmos']) assert.ok(tags.has(tag), tag);
  assert.equal(tags.has('hdr10'), false);
});

test('release filters agree with web on common provider metadata', () => {
  const streams = [
    { title: 'AV1 (2025) 1080p WEB-DL H264' },
    { title: 'HEVC Atmos 4K HDR10+' },
    { name: '1080p H264', behaviorHints: { filename: 'Title.2160p.REMUX.H265.DV.TrueHD.mkv' } },
    { description: '[1080p] [WEBRip] [H264] [SDR]' },
    { title: 'HDR was in the title, not in the release tags' },
    { url: 'https://example.test/Title%20720p%20HDTV%20h264.m3u8?key=not-indexed' },
  ];
  for (const stream of streams) assert.deepEqual(getStreamFilterTags(stream), getWebStreamFilterTags(stream));
});

test('search, provider and quality filters combine without changing provider order', () => {
  const make = (addonId, name) => ({ addonId, addonName: `Provider ${addonId}`, addonIndex: 0, name });
  const streams = [make('a', '2160p HDR10'), make('b', '4K HDR10'), make('a', '1080p SDR'), make('a', 'UHD Dolby Vision')];
  assert.deepEqual(filterStreams(streams, '  4k ', 'a', ['hdr']), [streams[0], streams[3]]);
  assert.deepEqual(filterStreams(streams, 'provider b', null, ['2160p']), [streams[1]]);
  assert.deepEqual(filterStreams(streams, '', null, []), streams);
});

test('provider notices are shown but only HTTP(S) links can be selected', () => {
  assert.equal(isSelectableStream({ name: 'Provider notice', infoHash: 'hash' }), false);
  assert.equal(isSelectableStream({ url: 'https://user:password@example.test/video.mp4' }), false);
  assert.equal(isSelectableStream({ url: 'file:///video.mp4' }), false);
  assert.equal(isSelectableStream({ externalUrl: 'https://example.test/video' }), true);
  assert.deepEqual(getStreamPresentation({ name: '⚡ 4K WEB-DL', title: '★★☆\nTitle.mkv' }), {
    resolution: '2160p', source: 'WebDL', lightning: true, stars: [true, true, false], details: ['Title.mkv'],
  });
});
