const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, globals = {}) {
  const context = { exports: {}, URLSearchParams, AbortController, setTimeout, clearTimeout, console, ...globals };
  if (context.require) { const original = context.require; context.require = name => name === "@/lib/server/outbound-fetch" ? { outboundFetch: context.fetch } : original(name); }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  return context.exports;
}
const artwork = load('lib/artwork.ts');
const description = load('lib/media-description.ts');
function setup(items, metadata = { id: 'tt0816692', name: 'Interstellar', type: 'movie', year: 2014, description: 'Complete.' }) {
  const calls = [], pending = [];
  const actions = load('app/actions/media.ts', {
    require(name) {
      if (name === "@/lib/server/outbound-fetch") return { outboundFetch: (...args) => context.fetch(...args) };
      if (name === './auth' || name === '@/lib/server/auth') return {
        getAuthData: async () => ({ authKey: 'test-only' }),
        getInstalledAddons: async () => {
          calls.push('addons');
          return [{ transportUrl: 'https://addon.test/manifest.json', manifest: { resources: ['meta'], catalogs: [] } }];
        },
      };
      if (name === '@/lib/server/catalog-cache') return {};
      if (name === '@/lib/server/media-artwork') return { resolveArtworkList: async items => items.map(item => ({ ...item, background: 'https://image.tmdb.org/t/p/original/backdrop.jpg' })) };
      if (name === '@/lib/artwork') return artwork;
      if (name === '@/lib/media-description') return description;
      return {};
    },
    fetch: async (url, init) => {
      if (url.endsWith('/datastoreGet')) {
        calls.push('library');
        assert.equal(init.cache, 'no-store', 'Playback positions must stay fresh');
        return { ok: true, json: async () => ({ result: items }) };
      }
      calls.push('metadata');
      await new Promise(resolve => pending.push(resolve));
      return { ok: true, json: async () => ({ meta: metadata }) };
    },
  });
  return { actions, calls, release() { pending.splice(0).forEach(resolve => resolve()); } };
}

async function run() {
  const raw = { _id: 'tt0816692', type: 'movie', name: 'Interstellar', year: '2014', state: {
    timeOffset: 600_000, duration: 7_200_000, lastWatched: '2026-10-31',
    stream: { url: 'https://stream.test/movie.mkv', behaviorHints: { filename: 'Movie.mkv', videoSize: 123 } },
  } };
  const app = setup([raw]);
  let resolved = false;
  const request = app.actions.fetchResumeItems().then(items => { resolved = true; return items; });
  await new Promise(setImmediate);
  try {
    assert.ok(resolved, 'Resume cards must become available after the library response, even when metadata providers are stalled');
    assert.deepEqual(app.calls, ['library'], 'The critical row must not fetch full details, addons, episode lists or descriptions');
  } finally { app.release(); }
  const items = await request;
  assert.equal(items[0].resumePositionTicks, 600);
  assert.equal(items[0].progressPercent, 8);
  assert.equal(items[0].streamUrl, raw.state.stream.url);
  assert.equal(items[0].subtitleFilename, 'Movie.mkv');
  assert.equal(items[0].subtitleVideoSize, 123);
  assert.equal(items[0].year, 2014);
  assert.equal(items[0].background, 'https://image.tmdb.org/t/p/original/backdrop.jpg');

  const rows = [raw,
    { ...raw, _id: 'removed', removed: true },
    { ...raw, _id: 'other', type: 'other' },
    { ...raw, _id: 'unstarted', state: { timeOffset: 0 } },
    { ...raw, _id: 'tt1442437', type: 'series', removed: true, temp: true, name: 'Modern Family', state: {
      video_id: 'tt1442437:8:10', episodeTitle: 'Ringmaster Keifth', timeOffset: 180_000, duration: 1_200_000, lastWatched: '2026-11-01',
    } },
  ];
  const filtered = await setup(rows).actions.fetchResumeItems();
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].id, 'tt1442437');
  assert.equal(filtered[0].progressLabel, 'S8 • E10');
  assert.equal(filtered[0].mediaSourceId, 'tt1442437:8:10');
  assert.equal(filtered[0].seriesId, 'tt1442437');
  assert.equal(filtered[0].episodeTitle, 'Ringmaster Keifth', 'Reuse a supplied episode name without per-card metadata requests');
  assert.equal(filtered[0].resumePositionTicks, 180);
  assert.equal(filtered[0].progressPercent, 15);
  assert.equal(filtered[1].id, 'tt0816692');
  assert.equal((await setup([]).actions.fetchResumeItems()).length, 0);
  const optionalYear = setup([]);
  const yearRequest = optionalYear.actions.fetchResumeMovieYear('tt0816692');
  await new Promise(setImmediate);
  assert.deepEqual(optionalYear.calls, ['addons', 'metadata']);
  optionalYear.release();
  assert.equal(await yearRequest, 2014, 'Optional caption metadata remains available separately');
  assert.equal(optionalYear.calls.length, 2, 'Year lookup never repairs a synopsis or reads the library again');
  const releaseYear = setup([], { releaseInfo: '2014–2015', description: 'Truncated…' });
  const releaseRequest = releaseYear.actions.fetchResumeMovieYear('tt0816692');
  await new Promise(setImmediate); releaseYear.release();
  assert.equal(await releaseRequest, 2014);
  assert.equal(releaseYear.calls.length, 2);
  const unknown = setup([], { year: 9999 });
  const unknownRequest = unknown.actions.fetchResumeMovieYear('tt0816692');
  await new Promise(setImmediate); unknown.release();
  assert.equal(await unknownRequest, null, 'Unavailable captions do not break the row');

  // Exercise the actual Home composition: optional movie metadata must remain
  // below its own Suspense boundary rather than holding up the resume section.
  const React = require('react');
  let yearCalls = 0;
  const Home = load('app/(main)/page.tsx', {
    require(name) {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return require(name);
      if (name === '@/lib/server/catalog-cache') return {};
      if (name === '@/lib/server/media-artwork') return { resolveArtworkList: async items => items.map(item => ({ ...item, background: 'https://image.tmdb.org/t/p/original/backdrop.jpg' })) };
      if (name === '@/lib/artwork') return artwork;
      if (name === '@/app/actions/media') return {
        fetchResumeItems: async () => [items[0], { ...items[0], id: 'missing', year: undefined }, filtered[0]],
        fetchResumeMovieYear: async () => { yearCalls++; return 2014; },
      };
      if (name === '@/app/actions/auth' || name === '@/lib/server/auth') return { getUser: async () => ({ _id: 'fixture-user' }), getInstalledAddons: async () => [] };
      if (name === '@/lib/home-catalogs') return { INITIAL_CATALOG_COUNT: 4, CATALOG_BATCH_SIZE: 2 };
      return new Proxy({}, { get: (_, key) => key });
    },
  }).default;
  const page = await Home();
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return undefined;
    if (Array.isArray(node)) return node.map(item => find(item, predicate)).find(Boolean);
    return predicate(node) ? node : find(node.props?.children, predicate);
  };
  const resumeBoundary = find(page, node => node.type === React.Suspense && node.props.children?.type?.name === 'ContinueWatchingSection');
  assert.ok(resumeBoundary, 'The resume row has an independent streaming boundary');
  const renderedSection = await resumeBoundary.props.children.type(resumeBoundary.props.children.props);
  const section = find(renderedSection, node => node.props?.sectionName === 'Continue Watching');
  assert.equal(yearCalls, 0, 'Producing the row does not await or start optional captions');
  assert.equal(section.props.cardSubtitles[0], undefined, 'Known years need no additional lookup');
  assert.equal(section.props.cardSubtitles[2], undefined, 'Episode labels need no metadata request');
  const yearBoundary = section.props.cardSubtitles[1];
  assert.equal(yearBoundary.type, React.Suspense);
  assert.equal(yearBoundary.props.fallback, null);
  assert.equal(await yearBoundary.props.children.type(yearBoundary.props.children.props), '2014');
  assert.equal(yearCalls, 1);
  console.log('PASS: immediate resume data, zero metadata fan-out, fresh progress, episode routing, artwork and independently streamed movie years');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
