import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artworkUrl, parseCatalog, selectFeatured, ratingLabel, resizeBackdrop } from '../lib/home-catalog.ts';
import { loadHome } from '../lib/home-api.ts';

const poster = 'https://images.metahub.space/poster/small/tt123/img';
const background = 'https://image.tmdb.org/t/p/w1280/sample.jpg';
const item = (id, type = 'movie', name = id) => ({ id, type, name, poster, background, releaseInfo: '2024–', imdbRating: '8.1', genres: ['Drama'] });
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'content-type': 'application/json'}});

test('catalog normalization rejects untrusted artwork and invalid titles', () => {
  const data = parseCatalog([item('tt123'), item('tt123'), {...item('tt124'), poster: 'https://example.com/private.jpg'}, item('bad'), item('tt999', 'series')], 'movie');
  assert.equal(data.length, 2);
  assert.equal(data[0].year, 2024);
  assert.equal(data[0].poster, poster);
  assert.equal(data[1].poster, undefined);
  assert.equal(ratingLabel(data[0]), '8.1');
  assert.equal(artworkUrl('http://images.metahub.space/poster/small/tt123/img'), undefined);
  assert.equal(resizeBackdrop(background), 'https://image.tmdb.org/t/p/w780/sample.jpg');
});

test('hero interleaves unique movie and series titles with backdrop artwork', () => {
  const sections = [
    { key: 'movies', sectionName: 'Movies', mediaItems: parseCatalog([item('tt1'), {...item('tt2'), background: undefined}, item('tt3')]) },
    { key: 'shows', sectionName: 'TV', mediaItems: parseCatalog([item('tt4', 'series'), item('tt5', 'series')]) },
  ];
  assert.deepEqual(selectFeatured(sections).map(value => value.id), ['tt1', 'tt4', 'tt3', 'tt5']);
  assert.deepEqual(selectFeatured(sections, 1).map(value => value.id), ['tt1']);
});

test('missing TMDB data falls back to public Cinemeta without a token', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('navigator-strm.vercel.app')) return new Response('Unavailable', {status: 429, headers: {'content-type': 'text/html'}});
    assert.ok(url.startsWith('https://cinemeta-catalogs.strem.io/'));
    const type = url.includes('/series/') ? 'series' : 'movie';
    return json({metas: [item(type === 'movie' ? 'tt123' : 'tt124', type)]});
  });
  const result = await loadHome();
  assert.equal(result.provider, 'Cinemeta');
  assert.deepEqual(result.sections.map(row => row.key), ['cinemeta-movie', 'cinemeta-series']);
});

test('working backend returns all six TMDB feeds and no Cinemeta requests', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async (url) => {
    assert.ok(url.includes('/api/discovery/home?feed=tmdb-'));
    const type = url.endsWith('movies') ? 'movie' : 'series';
    return json({status: 'ready', section: {sectionName: 'Discovery', mediaItems: [item('tmdb:100', type)]}});
  });
  const result = await loadHome();
  assert.equal(result.provider, 'TMDB');
  assert.equal(result.sections.length, 6);
  assert.equal(mock.mock.callCount(), 6);
});

test('a malformed response on both sources returns a retriable error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => json({invalid: true}));
  await assert.rejects(loadHome(), /No catalogs are available/);
});
