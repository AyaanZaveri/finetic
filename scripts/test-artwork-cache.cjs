const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { load } = require('./test-support/react-hooks.cjs');
const metadataCache = load('lib/server/metadata-cache.ts', { 'server-only': {} });
let token = 'first', requests = 0, now = 0, available = true;
const context = { exports: {}, Date: { now: () => now }, require: name => name === 'next/cache' ? { unstable_cache: callback => callback }
  : name === '@/lib/server/metadata-cache' ? metadataCache
  : name === '@/lib/tmdb-credentials'
  ? { getTMDBToken: async () => token } : name === '@/lib/tmdb' ? {
    resolveTMDBId: async () => 10,
    fetchTMDB: async () => { requests++; await Promise.resolve(); return available ? { posters: [{ file_path: '/poster.jpg' }] } : null; },
  } : {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/tmdb-artwork.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, context);
const get = id => context.exports.getTMDBArtwork(id, 'movie', 'poster');
(async () => {
  await Promise.all(Array.from({ length: 20 }, () => get('tt123')));
  assert.equal(requests, 1, 'Concurrent artwork consumers must share lookup and selection');
  await get('tt123'); assert.equal(requests, 1, 'Warm artwork must reuse its resolved URL');
  token = 'second'; await get('tt123'); assert.equal(requests, 2, 'Credentials must isolate cached results');
  now += 86400001; await get('tt123'); assert.equal(requests, 3, 'Expired results must refresh');
  available = false; await get('tt456'); const failed = requests;
  available = true; assert.ok(await get('tt456')); assert.ok(requests > failed, 'Missing artwork must recover immediately');
  for (let i = 0; i < 300; i++) await get(`tt${1000+i}`);
  const before = requests; await get('tt123'); assert.ok(requests > before, 'Cache must evict old entries');
  console.log('PASS: artwork single-flight, warm cache, credential isolation, expiry, failure recovery and bounded eviction');
})().catch(error => { console.error(error); process.exitCode = 1; });
