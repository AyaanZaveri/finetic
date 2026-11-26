const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const React = require('react');
const { renderToPipeableStream } = require('react-dom/server');
const { load } = require('./test-support/react-hooks.cjs');

const native = tag => ({ children, ...props }) => React.createElement(tag, props, children);
const shared = {
  react: React,
  './detail-artwork.module.css': { surface: 'detail-artwork' },
  'react/jsx-runtime': require('react/jsx-runtime'),
  'lucide-react': require('lucide-react'),
  'next/link': ({ prefetch, ...props }) => native('a')(props),
  '@/components/ui/badge': { Badge: native('span') },
  '@/components/ui/button': { Button: ({ variant, size, ...props }) => native('button')(props) },
};
const view = load('components/media-page/episode-details-view.tsx', shared);
const { EpisodeDetailsSample } = load('components/media-page/episode-details-sample.tsx', {
  ...shared, './episode-details-view': view,
});
const { EpisodeDetailsBoundary } = load('components/media-page/episode-details-boundary.tsx', {
  ...shared, 'skullet/react': require('skullet/react'),
  './episode-details-boundary.module.css': { surface: 'episode-skeleton' },
});

(async () => {
  let reads = 0;
  const { default: EpisodePage } = load('app/(main)/series/[id]/[season]/[episode]/page.tsx', {
    ...shared,
    '@/components/media-page/episode-details-view': view,
    '@/components/media-page/episode-details-boundary': { EpisodeDetailsBoundary },
    '@/components/media-page/episode-details-sample': { EpisodeDetailsSample },
    '@/components/episode-description': { EpisodeDescription: native('p') },
    '@/components/episode-hero-thumbnail': { EpisodeHeroThumbnail: native('img') },
    '@/components/media-page/play-button': { MediaPlayButton: native('button') },
    '@/lib/series-route': { buildSeriesPath: id => `/series/${id}` },
    'next/navigation': { redirect() { throw Error('Unexpected redirect'); } },
    '../../_shared/series-data': { getSeriesEpisodeSelectionData: async () => {
      reads++;
      return {
        show: { id: 'tt1442437', name: 'Modern Family', imdbRating: '8.5', background: '/backdrop.jpg' },
        seasonNumber: 8, episodeNumber: 16, selectedEpisodeTitle: 'Basketball',
        selectedEpisode: { id: 'tt1442437:8:16', thumbnail: '/still.jpg', overview: 'Episode description', resumePositionTicks: 690000000 },
      };
    } },
  });
  const page = EpisodePage({ params: Promise.resolve({ id: 'tt1442437', season: '8', episode: '16' }) });
  assert.equal(page.type, EpisodeDetailsBoundary, 'The boundary renders synchronously before metadata reads');
  assert.equal(reads, 0);
  const hydrated = await page.props.children.type(page.props.children.props);
  assert.equal(hydrated.type, "metadata-hydration");
  const loaded = hydrated.props.children;
  assert.equal(reads, 1);
  assert.equal(loaded.type, view.EpisodeDetailsView);
  assert.equal(loaded.props.title, 'Basketball');
  assert.equal(loaded.props.actions.props.media.mediaSourceId, 'tt1442437:8:16');
  assert.equal(loaded.props.actions.props.media.resumePositionTicks, 690000000);
  assert.equal(loaded.props.description.props.text, 'Episode description');

  let ready = false, finish;
  const waiting = new Promise(resolve => { finish = resolve; });
  function Details() {
    if (!ready) throw waiting;
    return React.createElement(view.EpisodeDetailsView, {
      titleId: 'episode-title', showHref: '/series/tt1442437', showName: 'Modern Family',
      title: 'Basketball', seasonNumber: 8, episodeNumber: 16, ratingMedia: { imdbRating: '8.5' },
      thumbnail: React.createElement('img', { src: '/real-still.jpg', alt: 'Basketball' }),
      actions: React.createElement('button', null, 'Resume'),
    });
  }
  const output = new PassThrough();
  let html = '';
  output.on('data', chunk => { html += chunk; });
  const ended = new Promise((resolve, reject) => { output.on('end', resolve); output.on('error', reject); });
  const errors = [];
  let shell;
  const shellReady = new Promise(resolve => { shell = resolve; });
  const stream = renderToPipeableStream(React.createElement(EpisodeDetailsBoundary, {
    sample: React.createElement(EpisodeDetailsSample),
  }, React.createElement(Details)), {
    onShellReady() { stream.pipe(output); shell(); },
    onError(error) { errors.push(error); },
  });
  await shellReady;
  await new Promise(resolve => setImmediate(resolve));
  assert.match(html, /Loading episode details/, 'The fallback announces its loading state');
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /inert=""/);
  assert.match(html, /skullet-block=""/, 'Reserve the fixed-ratio thumbnail as one block');
  assert.match(html, /min-h-\[calc\(3lh\+2\.75rem\)\]/, 'The sample reserves the collapsed description slot');
  assert.match(html, /<script/, 'Skullet sends its pre-paint measurement bootstrap');
  assert.doesNotMatch(html, /<img|<a\b|<link[^>]*as="image"|id="episode-title"/, 'Sample has no artwork requests, prefetch links, or duplicate heading IDs');
  ready = true;
  finish();
  await ended;
  assert.deepEqual(errors, []);
  assert.match(html, /Basketball/);
  assert.match(html, /id="episode-title"/);
  assert.match(html, /\/series\/tt1442437/);
  assert.match(html, /Resume/);
  assert.match(html, /<img[^>]*src="\/logo\/imdb-black\.svg"/, "Loaded details retain the actual rating logo");
  assert.equal(html.match(/min-h-\[calc\(3lh\+2\.75rem\)\]/g)?.length, 2, 'Loaded details reserve the same slot even without a description');
  console.log('PASS: episode fallback streams before details, with inert samples, no sample media/prefetch, pre-paint measurement, and real content.');
})().catch(error => { console.error(error); process.exitCode = 1; });
