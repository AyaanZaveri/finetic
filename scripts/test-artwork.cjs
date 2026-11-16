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
  const direct = 'https://image.tmdb.org/t/p/original/art.jpg';
  assert.equal(urls.backdropVariantUrl(direct, 780), 'https://image.tmdb.org/t/p/w780/art.jpg');
  assert.equal(urls.episodeHeroStillUrl(direct), 'https://image.tmdb.org/t/p/w1280/art.jpg');
  assert.equal(urls.episodeThumbnailUrl(direct, 'tt123', 1, 1), direct);
  const sample = new URL(urls.artworkSampleUrl(direct));
  assert.equal(sample.origin, 'https://wsrv.nl');
  assert.equal(sample.searchParams.get('url'), direct);
  assert.equal(sample.searchParams.get('output'), 'png');
  for (const privateUrl of ['https://addon.test/secret/image.jpg', 'http://127.0.0.1/image.jpg', 'https://image.tmdb.org.evil.test/t/p/w500/a.jpg']) {
    assert.equal(urls.artworkSampleUrl(privateUrl), privateUrl, 'Do not disclose private URLs to the image service');
    assert.equal(urls.publicArtworkUrl(privateUrl), undefined);
  }
  assert.equal(urls.mediaArtwork({ poster: direct }).poster, direct);
  assert.equal(urls.mediaArtwork({ poster: '/api/artwork?old' }).poster, undefined);
  assert.equal(fs.existsSync('app/api/artwork/route.ts'), false, 'Image delivery must bypass app functions');

  const env = {};
  const calls = [];
  let failed = false;
  const globals = {
    process: { env }, AbortSignal,
    require: name => name === 'next/cache' ? { unstable_cache: fn => fn } : name === '@/lib/server/metadata-cache' ? { opaqueMetadataIdentity: parts => JSON.stringify(parts) } : name === '@/lib/tmdb' ? tmdb : name === '@/lib/artwork' ? urls
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
    require: name => name === 'next/cache' ? { unstable_cache: fn => fn } : name === '@/lib/server/metadata-cache' ? { opaqueMetadataIdentity: parts => JSON.stringify(parts) } : name === '@/lib/tmdb' ? {
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
  console.log('PASS: TMDB identity matching, artwork selection, episode stills, direct image delivery, sampling privacy, caching, and failures');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
