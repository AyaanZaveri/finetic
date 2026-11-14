const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');
const globals = { Request, Response, Headers, URL, AbortController, AbortSignal, TransformStream, ReadableStream, TextDecoder, Uint8Array, Error, Date };
(async () => {
  const original = 'https://addon.example.com/play/private-token';
  const final = 'https://cdn.example.com/file.mkv?token=private';
  let requests = [], responses = [], cancelled = 0;
  const transport = load('lib/server/outbound-fetch.ts', { 'server-only': {}, 'ipaddr.js': require('ipaddr.js') }, {
    ...globals, WebSocketPair: class {}, fetch: async (url, init) => {
      requests.push({ url: String(url), init }); return responses.shift();
    },
  });
  const resolver = load('lib/server/web-playback-source.ts', { 'server-only': {}, './outbound-fetch': transport }, globals);
  const stream = () => new ReadableStream({ cancel() { cancelled++; } });
  const redirect = location => new Response(null, { status: 302, headers: { Location: location } });
  responses = [redirect(final), new Response(stream(), { status: 206, headers: { 'Content-Type': 'application/octet-stream' } })];
  const url = await resolver.resolveWebPlaybackSource(original, new AbortController().signal);
  assert.equal(url, final, 'Resolve the non-CORS addon redirect before browser media fetching');
  assert.equal(requests.length, 2); assert.equal(cancelled, 1, 'Cancel media bytes immediately after the header probe');
  for (const request of requests) {
    assert.equal(request.init.headers.get('range'), 'bytes=0-0');
    assert.equal(request.init.redirect, 'manual', 'Validate every redirect through the outbound guard');
  }
  requests = []; responses = [redirect('http://169.254.169.254/latest')];
  await assert.rejects(resolver.resolveWebPlaybackSource(original, new AbortController().signal), /Private|reserved/);
  assert.equal(requests.length, 1, 'A redirect cannot reach private addresses');
  requests = []; responses = [redirect('http://cdn.example.com/file.mkv')];
  await assert.rejects(resolver.resolveWebPlaybackSource(original, new AbortController().signal), /insecure/);
  assert.equal(requests.length, 1);
  const before = requests.length;
  await assert.rejects(resolver.resolveWebPlaybackSource('file:///private', new AbortController().signal));
  assert.equal(requests.length, before);
  responses = [new Response('error page', { headers: { 'Content-Type': 'text/html' } })];
  await assert.rejects(resolver.resolveWebPlaybackSource(original, new AbortController().signal), /not media/);
  responses = [new Response(null, { status: 403 })];
  await assert.rejects(resolver.resolveWebPlaybackSource(original, new AbortController().signal), /unavailable/);
  requests = [];
  await assert.rejects(resolver.resolveWebPlaybackSource(original, AbortSignal.abort())); assert.equal(requests.length, 0);

  let signedIn = false, resolutions = 0;
  const route = load('app/api/playback/source/route.ts', {
    '@/lib/server/auth': { getAuthData: async () => { if (!signedIn) throw Error('sign in'); } },
    '@/lib/server/web-playback-source': { resolveWebPlaybackSource: async url => { resolutions++; assert.equal(url, original); return final; } },
  }, globals);
  const request = (body, origin = 'http://localhost:3000', headers = {}) => new Request('http://localhost:3000/api/playback/source', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body,
  });
  assert.equal((await route.POST(request(JSON.stringify({ url: original })))).status, 401);
  signedIn = true;
  assert.equal((await route.POST(request(JSON.stringify({ url: original }), 'https://other.example.com'))).status, 403);
  assert.equal(resolutions, 0);
  let response = await route.POST(request(JSON.stringify({ url: original })));
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await response.json()).url, final);
  assert.equal((await route.POST(request('{'))).status, 400);
  assert.equal((await route.POST(request(JSON.stringify({ url: 42 })))).status, 400);
  assert.equal((await route.POST(request(' '.repeat(16385)))).status, 413, 'Bound streamed bodies even without Content-Length');
  assert.equal((await route.POST(request('{}', undefined, { 'Content-Length': '16385' }))).status, 413);

  let calls = 0, now = 0;
  const client = load('lib/media/webgpu-source.ts', {}, { ...globals, Date: class extends Date { static now() { return now; } },
    fetch: async (path, init) => {
      calls++; assert.equal(path, '/api/playback/source'); assert.equal(init.method, 'POST');
      assert.equal(JSON.parse(init.body).url, original); assert.equal(init.credentials, 'same-origin');
      return Response.json({ url: final });
    },
  });
  const signal = new AbortController().signal;
  assert.equal(await client.resolveWebGpuSource(original, signal), final);
  assert.equal(await client.resolveWebGpuSource(original, signal), final); assert.equal(calls, 1, 'Probe and player reuse a short-lived resolved URL');
  now = 60001; assert.equal(await client.resolveWebGpuSource(original, signal), final); assert.equal(calls, 2);
  await assert.rejects(client.resolveWebGpuSource(original, AbortSignal.abort()));
  const fallback = load('lib/media/webgpu-source.ts', {}, { ...globals, fetch: async () => new Response(null, { status: 404 }) });
  assert.equal(await fallback.resolveWebGpuSource(original, signal), original, 'Direct CORS-readable files remain usable on older servers');
  console.log('PASS: non-CORS redirect resolution, one-byte probe cancellation, private/downgrade guards, authenticated same-origin bounded POST, private response and short-lived client reuse');
})().catch(error => { console.error(error); process.exitCode = 1; });
