const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, globals = {}) {
  const context = { exports: {}, URL, URLSearchParams, Response, ...globals };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  vm.runInNewContext(code, context);
  return context.exports;
}

async function run() {
  const urls = load('lib/artwork.ts');
  const fullBackdrop = urls.artworkUrl('tt123', 'movie', 'backdrop');
  assert.ok(!fullBackdrop.includes('width='), 'Canonical artwork stays full-resolution');
  assert.ok(urls.backdropVariantUrl(fullBackdrop, 780).includes('width=780'));
  assert.equal(urls.backdropVariantUrl('https://image.tmdb.org/t/p/original/art.jpg', 300), 'https://image.tmdb.org/t/p/w300/art.jpg');
  assert.equal(urls.artworkSampleUrl('/api/artwork?id=tt123&kind=backdrop'), '/api/artwork?id=tt123&kind=backdrop&sample=1');
  assert.equal(urls.artworkSampleUrl('/api/artwork?id=tt123&kind=poster&sample=1'), '/api/artwork?id=tt123&kind=poster&sample=1');
  assert.equal(urls.artworkSampleUrl('https://image.tmdb.org/t/p/w1280/art.jpg'), 'https://image.tmdb.org/t/p/w1280/art.jpg');
  assert.equal(urls.artworkUrl('custom-addon-id', 'movie', 'poster'), undefined);
  assert.equal(urls.artworkUrl('tt123:2:3', 'series', 'poster'), '/api/artwork?id=tt123&type=series&kind=poster');
  assert.equal(urls.artworkUrl('tt123', 'series', 'still', 0, 1), '/api/artwork?id=tt123&type=series&kind=still&v=1&season=0&episode=1');
  for (const [season, episode] of [[-1, 1], [1, 0], [1.5, 2], [NaN, 1]]) {
    assert.equal(urls.artworkUrl('tt123', 'series', 'still', season, episode), undefined);
  }
  assert.equal(urls.artworkUrl('tt123', 'movie', 'still', 1, 1), undefined);
  assert.equal(urls.artworkUrl('tmdb:12', 'series', 'logo'), '/api/artwork?id=tmdb%3A12&type=series&kind=logo&v=3');

  assert.equal(urls.artworkFromPath('/series/tt123/2/3'), '/api/artwork?id=tt123&type=series&kind=still&v=1&season=2&episode=3');
  assert.equal(urls.artworkFromPath('/movie/tmdb%3A12'), '/api/artwork?id=tmdb%3A12&type=movie&kind=poster');
  assert.equal(urls.artworkFromPath('//external.example/movie/tt123'), undefined);
  assert.equal(urls.artworkFromPath('/movie/%E0%A4%A'), undefined);

  assert.equal(urls.artworkUrl('tmdb%3A204284', 'series', 'still', 2, 1),
    '/api/artwork?id=tmdb%3A204284&type=series&kind=still&v=1&season=2&episode=1', 'Encoded show IDs must resolve');
  assert.equal(urls.artworkUrl('tmdb:204284:2:1', 'series', 'still', 2, 1),
    '/api/artwork?id=tmdb%3A204284&type=series&kind=still&v=1&season=2&episode=1', 'Episode IDs retain the parent show identity');
  const canonicalStill = '/api/artwork?id=tt10802170&type=series&kind=still&v=1&season=2&episode=1';
  assert.equal(urls.episodeThumbnailUrl(canonicalStill, 'addon-route-id', 2, 1), canonicalStill,
    'Carousel must keep server-provided artwork even when the route ID cannot resolve');
  assert.equal(urls.episodeThumbnailUrl('https://image.tmdb.org/t/p/w500/still.jpg', 'addon-route-id', 2, 1),
    'https://image.tmdb.org/t/p/w500/still.jpg', 'Direct TMDB stills remain usable');
  assert.equal(urls.episodeThumbnailUrl('https://old-addon.test/image.jpg', 'tt10802170', 2, 1), canonicalStill,
    'Non-TMDB thumbnails still use the TMDB source');

  const env = {};
  const calls = [];
  let failed = false;
  const globals = {
    process: { env }, AbortSignal,
    require: name => name === '@/lib/tmdb' ? tmdb : name === '@/lib/artwork' ? urls
      : name === '@/lib/tmdb-credentials' ? credentials
      : name === 'next/headers' ? { cookies: async () => ({ get: () => undefined }) } : {},
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (failed) throw new Error('Network unavailable');
      return { ok: true, json: async () => url.includes('/find/')
        ? { movie_results: [{ id: 10 }], tv_results: [{ id: 20 }] }
        : url.includes('/season/') ? { episodes: [{ episode_number: 3, still_path: '/episode.jpg' }] }
        : { posters: [{ file_path: '/poster.jpg', iso_639_1: 'en' }],
            backdrops: [{ file_path: '/backdrop.jpg', iso_639_1: null }],
            logos: [{ file_path: '/logo.png', iso_639_1: 'en' }] } };
    },
  };
  const tmdb = load('lib/tmdb.ts', globals);
  const credentials = load('lib/tmdb-credentials.ts', globals);
  const artwork = load('lib/tmdb-artwork.ts', globals);
  const candidates = [
    { file_path: '/french.png', iso_639_1: 'fr', vote_average: 10 },
    { file_path: '/neutral.png', iso_639_1: null, vote_average: 9 },
    { file_path: '/english.png', iso_639_1: 'en', vote_average: 7 },
    { file_path: '//untrusted.example/test.png', iso_639_1: 'en', vote_average: 10 },
  ];
  assert.equal(artwork.selectArtwork(candidates, 'logo'), 'https://image.tmdb.org/t/p/original/english.png');
  assert.equal(artwork.selectArtwork(candidates, 'backdrop'), 'https://image.tmdb.org/t/p/original/neutral.png');
  assert.equal(candidates[0].file_path, '/french.png', 'Selection must not reorder the cached response');
  assert.equal(artwork.selectArtwork([], 'logo'), undefined);
  const rehearsalLogos = [
    { file_path: '/qCypzBQss8KetGBD7Vqqnjhh2Sm.png', iso_639_1: 'en', vote_average: 2.542, vote_count: 4, width: 4220 },
    { file_path: '/A1AKYxyqs21ZDdmlOORA19riHgf.png', iso_639_1: 'en', vote_average: 2.542, vote_count: 4, width: 4320 },
    { file_path: '/10HT3cItBzNAmJfREukVQKCQ1DQ.png', iso_639_1: 'en', vote_average: 1.75, vote_count: 3, width: 4220 },
  ];
  assert.equal(artwork.selectArtwork(rehearsalLogos, 'logo'),
    'https://image.tmdb.org/t/p/original/qCypzBQss8KetGBD7Vqqnjhh2Sm.png',
    'The Rehearsal must keep the original white logo ahead of the wider black variant');
  assert.equal(artwork.selectArtwork([
    { file_path: '/first.png', iso_639_1: 'en', vote_average: 5 },
    { file_path: '/larger.png', iso_639_1: 'en', vote_average: 10, vote_count: 100, width: 8000 },
  ], 'logo'), 'https://image.tmdb.org/t/p/original/first.png', 'Logo selection preserves provider order within a language');
  assert.equal(artwork.selectArtwork(rehearsalLogos, 'poster'),
    'https://image.tmdb.org/t/p/w500/A1AKYxyqs21ZDdmlOORA19riHgf.png',
    'Other artwork keeps its existing ranking');
  const modernFamilyLogos = [
    { file_path: '/loi4uTtq1EazhlBDVKaMYZ26Yih.svg', iso_639_1: 'en', vote_average: 3.334, vote_count: 1, width: 128 },
    { file_path: '/zbKvUZiiiA2kbj7cBytvcOVS51z.png', iso_639_1: 'en', vote_average: 3.334, vote_count: 1, width: 842 },
    { file_path: '/rbKhglYrECjMZNYtT2QyihOQ5F.png', iso_639_1: 'en', vote_average: 2.278, vote_count: 3, width: 1277 },
  ];
  assert.equal(artwork.selectArtwork(modernFamilyLogos, 'logo'),
    'https://image.tmdb.org/t/p/original/loi4uTtq1EazhlBDVKaMYZ26Yih.svg',
    'Modern Family keeps its white-and-orange SVG instead of skipping to the black PNG');
  assert.equal(artwork.selectArtwork([modernFamilyLogos[0]], 'poster'), undefined, 'Vector support is for title logos');
  assert.equal(artwork.selectArtwork([{ file_path: '//untrusted.example/logo.svg' }], 'logo'), undefined);
  assert.equal(await artwork.getTMDBArtwork('tt123', 'movie', 'poster'), undefined);
  assert.equal(calls.length, 0, 'No credentials must make no network requests');
  env.TMDB_API_READ_ACCESS_TOKEN = 'test-secret';
  assert.equal(await artwork.getTMDBArtwork('tt123', 'movie', 'poster'), 'https://image.tmdb.org/t/p/w500/poster.jpg');
  assert.ok(calls.at(-1).url.includes('/movie/10/images?include_image_language=en,null'));
  assert.equal(calls.at(-1).options.next.revalidate, 86400);
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer test-secret');
  await artwork.getTMDBArtwork('tt123', 'series', 'logo');
  assert.ok(calls.at(-1).url.includes('/tv/20/images'));
  assert.equal(await artwork.getTMDBArtwork('tmdb:20', 'series', 'still', 2, 3), 'https://image.tmdb.org/t/p/w500/episode.jpg');
  assert.ok(calls.at(-1).url.includes('/tv/20/season/2?language=en-US'));
  assert.equal(await artwork.getTMDBArtwork('tmdb:20', 'series', 'still', 2, 4), undefined);
  const foreignPaths = [];
  const foreignArtwork = load('lib/tmdb-artwork.ts', {
    require: name => name === '@/lib/tmdb' ? {
      resolveTMDBId: async () => 236182,
      fetchTMDB: async path => {
        foreignPaths.push(path);
        return { posters: path.includes('include_image_language') ? [] : [
          { file_path: '/u17FjBbauOJailVQC1siM9yGfDw.jpg', iso_639_1: 'fi' },
        ], logos: [] };
      },
    } : name === '@/lib/tmdb-credentials' ? { getTMDBToken: async () => 'fixture' } : {},
  });
  assert.equal(await foreignArtwork.getTMDBArtwork('tmdb:236182', 'series', 'poster'),
    'https://image.tmdb.org/t/p/w500/u17FjBbauOJailVQC1siM9yGfDw.jpg',
    'Amazing Race Finland must fall back to its Finnish poster when English/untagged images are absent');
  assert.equal(foreignPaths.length, 2);
  foreignPaths.length = 0;
  assert.equal(await foreignArtwork.getTMDBArtwork('tmdb:236182', 'series', 'logo'), undefined);
  assert.equal(foreignPaths.length, 1, 'Do not change established logo language selection');
  const count = calls.length;
  assert.equal(await artwork.getTMDBArtwork('unknown', 'movie', 'poster'), undefined);
  assert.equal(calls.length, count);
  failed = true;
  assert.equal(await artwork.getTMDBArtwork('tmdb:10', 'movie', 'poster'), undefined);

  const { GET } = load('app/api/artwork/route.ts', {
    require: name => name === '@/lib/artwork' ? urls : { getTMDBArtwork: async () => 'https://image.tmdb.org/t/p/w500/poster.jpg' },
  });
  const valid = await GET(new Request('https://navigator.test/api/artwork?id=tt123&type=movie&kind=poster'));
  assert.equal(valid.status, 307);
  assert.equal(valid.headers.get('location'), 'https://image.tmdb.org/t/p/w500/poster.jpg');
  assert.equal(valid.headers.get('cache-control'), 'private, max-age=86400');
  assert.equal(valid.headers.get('vary'), 'Cookie', 'Artwork credentials must not share a public redirect cache');
  for (const width of [300, 780, 1280]) {
    const thumbnail = await GET(new Request(`https://navigator.test/api/artwork?id=tt123&type=movie&kind=backdrop&width=${width}`));
    assert.equal(thumbnail.headers.get('location'), `https://image.tmdb.org/t/p/w${width}/poster.jpg`);
  }
  assert.equal((await GET(new Request('https://navigator.test/api/artwork?id=tt123&type=movie&kind=backdrop&width=9999'))).status, 400);
  assert.equal((await GET(new Request('https://navigator.test/api/artwork?id=tt123&type=movie&kind=poster&width=780'))).status, 400);
  for (const query of ['id=unknown&type=movie&kind=poster', 'id=tt123&type=movie&kind=invalid', 'id=tt123&type=series&kind=still&v=1&season=-1&episode=2']) {
    assert.equal((await GET(new Request(`https://navigator.test/api/artwork?${query}`))).status, 400);
  }
  const highStill = await GET(new Request('https://navigator.test/api/artwork?id=tt123&type=series&kind=still&season=1&episode=5&size=1280'));
  assert.equal(highStill.headers.get('location'), 'https://image.tmdb.org/t/p/w1280/poster.jpg');
  assert.equal((await GET(new Request('https://navigator.test/api/artwork?id=tt123&type=movie&kind=poster&size=1280'))).status, 400);
  assert.equal((await GET(new Request('https://navigator.test/api/artwork?id=tt123&type=series&kind=still&season=1&episode=5&size=huge'))).status, 400);
  const missing = load('app/api/artwork/route.ts', {
    require: name => name === '@/lib/artwork' ? urls : { getTMDBArtwork: async () => undefined },
  });
  const absent = await missing.GET(new Request('https://navigator.test/api/artwork?id=tt123&type=movie&kind=logo'));
  assert.equal(absent.status, 404);
  assert.equal(absent.headers.get('cache-control'), 'no-store', 'Temporary missing artwork must not stick in the browser cache');
  const sampledUrls = [];
  const sampled = load('app/api/artwork/route.ts', {
    require: name => name === '@/lib/artwork' ? urls : { getTMDBArtwork: async () => 'https://image.tmdb.org/t/p/w1280/backdrop.jpg' },
    fetch: async url => { sampledUrls.push(url); return new Response('fixture-jpeg', { headers: { 'Content-Type': 'image/jpeg' } }); },
    AbortSignal,
  });
  const sample = await sampled.GET(new Request('https://navigator.test/api/artwork?id=tt123&type=movie&kind=backdrop&sample=1'));
  assert.equal(sample.status, 200, 'Logo sampling needs same-origin bytes, not a cross-origin redirect');
  assert.equal(sample.headers.get('location'), null);
  assert.equal(sample.headers.get('content-type'), 'image/jpeg');
  assert.equal(sample.headers.get('vary'), 'Cookie');
  assert.equal(await sample.text(), 'fixture-jpeg');
  assert.equal(sampledUrls.at(-1), 'https://image.tmdb.org/t/p/w1280/backdrop.jpg', 'Logo contrast samples retain their full-resolution source');
  const beforePalette = sampledUrls.length;
  for (const [kind, size] of [["backdrop", "w300"], ["poster", "w342"]]) {
    const palette = await sampled.GET(new Request(`https://navigator.test/api/artwork?id=tt123&type=movie&kind=${kind}&sample=1&palette=1`));
    assert.equal(palette.status, 307, 'Palette image bytes are served outside the app function');
    const destination = new URL(palette.headers.get('location'));
    assert.equal(destination.origin, 'https://wsrv.nl');
    assert.equal(destination.searchParams.get('url'), `https://image.tmdb.org/t/p/${size}/backdrop.jpg`);
    assert.equal(destination.searchParams.get('w'), '160');
    assert.equal(destination.searchParams.get('output'), 'png');
    assert.equal(palette.headers.get('vary'), 'Cookie');
    assert.match(palette.headers.get('cache-control'), /^private/);
  }
  assert.equal(sampledUrls.length, beforePalette, 'Palette redirects must not fetch any image bytes on the server');
  const fallback = await sampled.GET(new Request('https://navigator.test/api/artwork?id=tt123&type=movie&kind=backdrop&sample=1&palette=1&direct=1'));
  assert.equal(fallback.status, 200, 'External-cache failures retain a direct sampling fallback');
  assert.equal(sampledUrls.at(-1), 'https://image.tmdb.org/t/p/w300/backdrop.jpg');
  const logoSample = await sampled.GET(new Request('https://navigator.test/api/artwork?id=tt123&type=movie&kind=logo&sample=1'));
  const posterSample = await sampled.GET(new Request('https://navigator.test/api/artwork?id=tt123&type=movie&kind=poster&sample=1'));
  assert.equal(posterSample.status, 200, 'Poster palette fallback also needs same-origin image bytes');
  assert.equal(posterSample.headers.get('location'), null);
  assert.equal(logoSample.status, 200, 'Wordmark measurements need same-origin logo bytes even when the CDN does not permit canvas access');
  assert.equal(logoSample.headers.get('location'), null);
  const brokenSample = load('app/api/artwork/route.ts', {
    require: name => name === '@/lib/artwork' ? urls : { getTMDBArtwork: async () => 'https://image.tmdb.org/t/p/w1280/backdrop.jpg' },
    fetch: async () => new Response('unavailable', { status: 503 }), AbortSignal,
  });
  assert.equal((await brokenSample.GET(new Request('https://navigator.test/api/artwork?id=tt123&type=movie&kind=backdrop&sample=1'))).status, 502);
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { EpisodeHeroThumbnail } = load('components/episode-hero-thumbnail.tsx', {
    React,
    require: name => name === '@/lib/artwork' ? urls : name === '@/components/artwork-image' ? { ArtworkImage: props => React.createElement('img', props) } : name === 'react' ? {
      useMemo: fn => fn(),
      useState: () => ['/failed-episode.jpg', () => {}],
    } : {},
  });
  const recovered = renderToStaticMarkup(React.createElement(EpisodeHeroThumbnail, {
    thumbnail: '/next-episode.jpg', title: 'Next episode', released: '2020-01-01',
  }));
  assert.ok(recovered.includes('src="/next-episode.jpg"'), 'A failed episode image must not hide the next episode image');
  console.log('PASS: TMDB identity matching, artwork selection, episode stills, caching, route validation, and failures');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
