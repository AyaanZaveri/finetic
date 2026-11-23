const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, globals = {}) {
  const context = { exports: {}, ...globals };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, context);
  return context.exports;
}
const cast = load('lib/cast.ts');
const credit = { id: 1, name: 'Actor One', character: 'Cooper', profile_path: '/actor.jpg' };
const normalized = cast.normalizeCast([credit, credit, { id: 2, name: 'Actor Two', profile_path: null }]);
assert.equal(normalized.length, 2, 'Duplicate people are removed');
assert.equal(normalized[0].role, 'Cooper');
assert.equal(normalized[0].image, 'https://image.tmdb.org/t/p/w185/actor.jpg');
assert.equal(normalized[1].image, undefined, 'Missing photos use avatar fallback');
assert.equal(cast.normalizeCast([{ id: 3, name: 'Actor Three', roles: [
  { character: 'Guest', episode_count: 1 }, { character: 'Lead', episode_count: 20 },
] }])[0].role, 'Lead / Guest', 'TV roles prioritize the most episodes');

async function run() {
  const env = {};
  const calls = [];
  let fail = false;
  let provider = 'auto';
  const globals = {
    require: name => name === '@/lib/cast' ? cast : name === '@/lib/tmdb' ? tmdb
      : name === '@/lib/tmdb-credentials' ? credentials
      : name === '@/lib/server/metadata-provider' ? { getMetadataProvider: async () => provider }
      : name === 'next/headers' ? { cookies: async () => ({ get: () => undefined }) } : {},
    process: { env }, AbortSignal,
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (fail) throw new Error('Unavailable');
      return { ok: true, json: async () => url.includes('/find/')
        ? { movie_results: [{ id: 157336 }], tv_results: [{ id: 42 }] }
        : { cast: [credit] } };
    },
  };
  const tmdb = load('lib/tmdb.ts', globals);
  const credentials = load('lib/tmdb-credentials.ts', globals);
  const { getMediaCast } = load('lib/tmdb-cast.ts', globals);
  let result = await getMediaCast('tt0816692', 'movie', ['Known Actor']);
  assert.equal(result.members[0].name, 'Known Actor');
  assert.equal(calls.length, 0, 'No token means no external requests');
  env.TMDB_API_READ_ACCESS_TOKEN = 'test-token';
  provider = 'cinemeta';
  result = await getMediaCast('tt0816692', 'movie', ['Known Actor']);
  assert.equal(result.members[0].name, 'Known Actor');
  assert.equal(calls.length, 0, 'Cinemeta keeps cast names and does not call TMDB');
  provider = 'auto';
  result = await getMediaCast('tt0816692', 'movie');
  assert.ok(calls[0].url.includes('external_source=imdb_id'));
  assert.ok(calls[1].url.includes('/movie/157336/credits'));
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
  assert.equal(result.members[0].role, 'Cooper');
  assert.ok(!JSON.stringify(result).includes('test-token'), 'Token stays on the server');
  await getMediaCast('tt0386676', 'series');
  assert.ok(calls.at(-1).url.includes('/tv/42/aggregate_credits'));
  await getMediaCast('tmdb:157336', 'movie');
  assert.ok(calls.at(-1).url.includes('/movie/157336/credits'));
  fail = true;
  result = await getMediaCast('tt0816692', 'movie', ['Known Actor']);
  assert.equal(result.members[0].name, 'Known Actor', 'Network failure preserves existing names');
  const before = calls.length;
  await getMediaCast('addon-specific-id', 'movie', ['Known Actor']);
  assert.equal(calls.length, before, 'Unknown ID formats do not make ambiguous lookups');
  console.log('PASS: cast normalization, movie/TV lookups, server token handling, and fallbacks');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
