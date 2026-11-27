const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function main() {
 const id = deferred(), addons = deferred(), calls = [];
 const { createPlaybackStreamRequest } = load('lib/media/fetch-playback-streams.ts', {
  './fetch-playback-id': { fetchPlaybackId: () => id.promise },
 }, { URLSearchParams, AbortSignal, fetch: async url => {
  calls.push(url);
  return url.startsWith('/api/streams/addons?') ? addons.promise : Response.json({ streams: [{ url: 'https://fixture.test/video.mkv' }] });
 } });
 const request = createPlaybackStreamRequest('tmdb:1421:6:4', 'series');
 assert.equal(calls[0], '/api/streams/addons?type=series', 'Independent add-on discovery must start while canonical ID lookup is pending');
 addons.resolve(Response.json({ addons: [{ id: 'fixture', logo: 'https://fixture.test/logo.png' }] }));
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(calls.length, 1, 'Do not fetch an add-on stream using the unresolved TMDB ID');
 id.resolve('tt1442437');
 const streams = await request.promise;
 assert.equal(streams.length, 1);
 assert.equal(streams[0].addonLogo, 'https://fixture.test/logo.png');
 assert.ok(calls[1].includes('mediaItemId=tt1442437%3A6%3A4'), 'Preserve the canonical episode coordinates');
 for (const failing of ['identity', 'addons']) {
  const identity = deferred(), discovery = deferred();
  const loader = load('lib/media/fetch-playback-streams.ts', {
   './fetch-playback-id': { fetchPlaybackId: () => identity.promise },
  }, { URLSearchParams, AbortSignal, fetch: () => discovery.promise });
  const pending = loader.createPlaybackStreamRequest('tmdb:1421', 'series');
  // When both fail, either rejection may win after the canonical-ID mapping.
  const rejected = assert.rejects(pending.promise, failing === 'identity' ? /identity|addons/ : /addons/);
  if (failing === 'identity') { identity.reject(new Error('identity failed')); discovery.reject(new Error('addons failed too')); }
  else { discovery.reject(new Error('addons failed')); identity.resolve('tt1442437'); }
  await rejected;
 }
 for (const status of [503, 200]) {
  let attempt = 0;
  const loader = load('lib/media/fetch-playback-streams.ts', {
   './fetch-playback-id': { fetchPlaybackId: async id => id },
  }, { URLSearchParams, fetch: async url => url.includes('/addons?')
   ? Response.json({ addons: [{ id: 'a' }, { id: 'b' }] })
   : ++attempt === 1 ? new Response('offline', { status: 503 })
   : status === 200 ? Response.json({ streams: [] }) : new Response('offline', { status }) });
  await assert.rejects(loader.createPlaybackStreamRequest('tt123', 'movie').promise, /Could not load streams/);
 }
 console.log('PASS: parallel ID/add-on discovery, canonical episode routing, and rejection handling for both inputs');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
