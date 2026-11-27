import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artworkUrl, parseCatalog, parseEpisodes, formatReleaseDate, selectFeatured, ratingLabel, resizeBackdrop } from '../lib/home-catalog.ts';
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

test('Home loads both live Cinemeta catalogs without a token', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.ok(url.startsWith('https://v3-cinemeta.strem.io/catalog/'));
    const type = url.includes('/series/') ? 'series' : 'movie';
    return json({metas: [item(type === 'movie' ? 'tt123' : 'tt124', type)]});
  });
  const result = await loadHome();
  assert.equal(result.provider, 'Cinemeta');
  assert.deepEqual(result.sections.map(row => row.key), ['cinemeta-movie', 'cinemeta-series']);
});

test('Home uses the alternate Cinemeta catalog endpoint on failure', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('v3-cinemeta')) return new Response('Unavailable', {status: 503});
    assert.ok(url.startsWith('https://cinemeta-catalogs.strem.io/top/catalog/'));
    const type = url.includes('/series/') ? 'series' : 'movie';
    return json({metas: [item(type === 'movie' ? 'tt123' : 'tt124', type)]});
  });
  assert.equal((await loadHome()).sections.length, 2);
});

test('a malformed response on both sources returns a retriable error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => json({invalid: true}));
  await assert.rejects(loadHome(), /No catalogs are available/);
});

test('Cinemeta title details aggregate distinct valid episodes into seasons', async (t) => {
  const {loadTitle} = await import('../lib/home-api.ts');
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url, 'https://v3-cinemeta.strem.io/meta/series/tt123.json');
    return json({meta: {...item('tt123', 'series'), cast: ['Actor'], videos: [{season: 1, episode: 1}, {season: 1, episode: 1}, {season: 1, episode: 2}, {season: 2, episode: 1}, {season: -1, episode: 1}]}});
  });
  const title = await loadTitle('series', 'tt123');
  assert.deepEqual(title.seasons, [{number:1,name:'Season 1',episodeCount:2},{number:2,name:'Season 2',episodeCount:1}]);
  assert.deepEqual(title.cast, ['Actor']);
});

test('Cinemeta details require the exact requested title identity', async (t) => {
  const {loadTitle} = await import('../lib/home-api.ts');
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url, 'https://v3-cinemeta.strem.io/meta/movie/tt123.json');
    return json({meta: {...item('tt123'), cast: ['Actor']}});
  });
  assert.equal((await loadTitle('movie', 'tt123')).id, 'tt123');
  await assert.rejects(loadTitle('movie', 'invalid'), /Invalid title/);
});

test('search uses live Cinemeta and interleaves movie and series results', async (t) => {
  const {searchTitles} = await import('../lib/home-api.ts');
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.ok(url.startsWith('https://v3-cinemeta.strem.io/catalog/'));
    assert.ok(url.includes('/top/search=Star%20Wars.json'));
    const type = url.includes('/series/') ? 'series' : 'movie';
    return json({metas: [item(type === 'movie' ? 'tt123' : 'tt124', type)]});
  });
  assert.deepEqual((await searchTitles('Star Wars')).map(value => value.id), ['tt123', 'tt124']);
});

test('cast portraits are normalized and invalid URLs are omitted', () => {
  const result = parseCatalog([{...item('tt1'), director:['Director'], castMembers:[
    {id:'1', name:'Actor', image:'https://image.tmdb.org/t/p/w185/actor.jpg'},
    {id:'2', name:'Other', image:'https://example.com/unsafe.jpg'},
    {id:'3'},
  ]}])[0];
  assert.deepEqual(result.director, ['Director']);
  assert.equal(result.castMembers.length, 2);
  assert.equal(result.castMembers[0].image, 'https://image.tmdb.org/t/p/w185/actor.jpg');
  assert.equal(result.castMembers[1].image, undefined);
});


test('TMDB is opt-in while Cinemeta remains the default', async (t) => {
  const {loadHome, loadTitle, searchTitles} = await import('../lib/home-api.ts');
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.ok(url.startsWith('https://navigator-strm.vercel.app'));
    if (url.includes('/api/discovery/home')) {
      const type = url.endsWith('movies') ? 'movie' : 'series';
      return json({status:'ready', section:{sectionName:'Discovery',mediaItems:[item('tmdb:123',type)]}});
    }
    if (url.includes('/api/search/results')) return json({provider:'TMDB',results:[item('tmdb:123')]});
    assert.ok(url.includes('/api/discovery/title'));
    return json({item:item('tmdb:123')});
  });
  assert.equal((await loadHome(undefined, 'tmdb')).sections.length, 6);
  assert.equal((await searchTitles('Movie', undefined, 'tmdb'))[0].id, 'tmdb:123');
  assert.equal((await loadTitle('movie', 'tmdb:123')).id, 'tmdb:123');
});


test('live series episode records preserve title, coordinates, date and artwork', () => {
  const rows = parseEpisodes([
    {season:2, episode:1, title:'Second season', thumbnail:'https://episodes.metahub.space/tt123/2/1/w780.jpg', released:'2026-02-01T09:00:00Z'},
    {season:1, number:2, name:'Episode two', overview:'Synopsis'},
    {season:1, episode:2, name:'Duplicate'}, {season:-1, episode:1}, {season:1, episode:0}
  ], 'tt123');
  assert.deepEqual(rows.map(row => row.id), ['tt123:1:2','tt123:2:1']);
  assert.equal(rows[0].description, 'Synopsis');
  assert.equal(rows[1].thumbnail, 'https://episodes.metahub.space/tt123/2/1/w780.jpg');
  assert.equal(formatReleaseDate(rows[1].released), 'Feb 1, 2026');
  assert.equal(parseCatalog([{...item('tt123','series'), year:'2023–', contentRating:{value:'TV-PG',region:'US'}}])[0].contentRating,'TV-PG');
});

test('optional TMDB season requests return matching episode coordinates', async (t) => {
  const {loadSeasonEpisodes} = await import('../lib/home-api.ts');
  t.mock.method(globalThis,'fetch',async url => {
    assert.ok(url.includes('/api/discovery/title?id=tmdb%3A123&type=series&season=2'));
    return json({episodes:[{season:2,episode:3,name:'Episode three',runtime:44},{season:1,episode:1,name:'Wrong season'}]});
  });
  const episodes = await loadSeasonEpisodes('tmdb:123',2);
  assert.equal(episodes.length,1);
  assert.equal(episodes[0].runtime,'44 min');
});

test('optional age certification supplements live Cinemeta without changing its provider', async (t) => {
  const {loadCertification} = await import('../lib/home-api.ts');
  t.mock.method(globalThis, 'fetch', async url => {
    assert.ok(url.includes('/api/discovery/title?id=tt123&type=series&certification=1'));
    return json({contentRating:{value:'TV-PG',region:'US'}});
  });
  assert.equal(await loadCertification('series','tt123'),'TV-PG');
});
