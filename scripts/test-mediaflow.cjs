const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const globals = { URL, Request, Response, Headers, ReadableStream, TransformStream, TextDecoder, Uint8Array, AbortSignal, AbortController, Date };
const urlHelpers = load('lib/media/mediaflow-url.ts', {}, globals);
const source = 'https://addon.example.com/play/episode.mkv?token=fixture';
const proxyUrl = 'https://proxy.example.com';
const proxied = `${proxyUrl}/_token_fixture/proxy/stream/video.mkv`;
const base = urlHelpers.mediaFlowBaseUrl(proxyUrl + '/');
assert.equal(base.href, proxyUrl + '/');
for (const value of ['file:///tmp/video', 'https://user:pass@proxy.example', 'https://proxy.example?foo=bar', 'x']) {
  assert.equal(urlHelpers.mediaFlowBaseUrl(value), undefined);
}
assert.equal(urlHelpers.mediaFlowRequest(base, source, 'fixture').filename, 'video.mkv');
assert.equal(urlHelpers.mediaFlowRequest(base, source, 'fixture').destination_url, source);
assert.equal(urlHelpers.mediaFlowRequest(base, 'https://media.example/live.m3u8?token=1', '').endpoint, '/proxy/hls/manifest.m3u8');
assert.equal(urlHelpers.mediaFlowRequest(base, 'https://media.example/live', 'fixture', true).endpoint, '/proxy/hls/manifest.m3u8');
assert.equal(urlHelpers.mediaFlowResponse(base, { url: proxied }), proxied);
assert.throws(() => urlHelpers.mediaFlowResponse(base, { url: 'https://other.example/proxy/stream/video.mp4' }));
assert.throws(() => urlHelpers.mediaFlowResponse(base, { url: proxyUrl + '/unrelated' }));
assert.equal(urlHelpers.isMediaFlowSource('ftp://proxy.example/proxy/stream/video.mp4'), false);

const host = hooks();
let settings = { mediaFlowMode: 'off', mediaFlowUrl: '', mediaFlowPassword: '' };
const ui = load('components/settings/mediaflow-settings.tsx', {
  react: host.react, 'react/jsx-runtime': host.jsx,
  '@/components/arc/segmented-control/segmented-control': { __esModule: true, default: 'SegmentedControl' },
  '@/components/ui/field': { Field: 'Field', FieldGroup: 'FieldGroup', FieldLabel: 'FieldLabel', FieldDescription: 'FieldDescription' },
  '@/components/ui/input': { Input: 'Input' }, '@/app/(main)/settings/settings.module.css': {},
  '@/contexts/settings-context': { useSettings: () => ({ playbackPreferences: settings, updatePlaybackPreferences: patch => { settings = { ...settings, ...patch }; } }) },
  '@/lib/media/mediaflow-url': urlHelpers,
}, globals);
function find(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => find(child, predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...find(node.props?.children, predicate)];
}
const render = () => host.render(ui.MediaFlowSettings);
const mode = () => find(render(), node => node.type === 'SegmentedControl')[0];
assert.deepEqual(Array.from(mode().props.options, option => option.label), ['Off', 'In-house', 'Custom']);
assert.equal(mode().props.options.find(option => option.value === 'in-house').tooltip, 'Use Navigator’s hosted proxy');
assert.equal(find(render(), node => node.type === 'Input').length, 0);
mode().props.onValueChange('custom');
let fields = find(render(), node => node.type === 'Input');
assert.equal(fields.length, 2);
assert.equal(fields[1].props.type, 'password');
fields[0].props.onChange({ target: { value: 'invalid' } });
assert.equal(find(render(), node => node.props?.id === 'mediaflow-url')[0].props['aria-invalid'], true);
fields[0].props.onChange({ target: { value: proxyUrl } });
fields[1].props.onChange({ target: { value: 'fixture' } });
mode().props.onValueChange('in-house');
assert.equal(find(render(), node => node.type === 'Input').length, 0);
mode().props.onValueChange('custom');
assert.equal(find(render(), node => node.props?.id === 'mediaflow-url')[0].props.value, proxyUrl);
assert.equal(find(render(), node => node.props?.id === 'mediaflow-password')[0].props.value, 'fixture');

(async () => {
  const signal = new AbortController().signal;
  const requests = [];
  let fail = false;
  const client = load('lib/media/mediaflow-source.ts', { './mediaflow-url': urlHelpers }, { ...globals,
    fetch: async (path, init) => {
      requests.push({ path: String(path), body: JSON.parse(init.body), credentials: init.credentials });
      return fail ? new Response(null, { status: 502 }) : Response.json({ url: proxied });
    },
  });
  const off = { mediaFlowMode: 'off', mediaFlowUrl: '', mediaFlowPassword: '' };
  const inHouse = { ...off, mediaFlowMode: 'in-house' };
  const custom = { mediaFlowMode: 'custom', mediaFlowUrl: proxyUrl, mediaFlowPassword: 'custom-fixture' };
  assert.equal(await client.resolveMediaFlowSource(source, signal, off), source);
  assert.equal(requests.length, 0);
  assert.equal(await client.resolveMediaFlowSource(source, signal, inHouse), proxied);
  assert.deepEqual(requests[0].body, { url: source, mediaFlow: 'in-house' });
  assert.equal(requests[0].path, '/api/playback/source');
  assert.equal(requests[0].credentials, 'same-origin');
  assert.equal(await client.resolveMediaFlowSource(source, signal, inHouse), proxied);
  assert.equal(await client.resolveMediaFlowSource(proxied, signal, inHouse), proxied);
  assert.equal(requests.length, 1, 'Reuse the routed source and never wrap it twice');
  assert.equal(await client.resolveMediaFlowSource(source, signal, custom), proxied);
  assert.equal(requests[1].path, `${proxyUrl}/generate_url`);
  assert.equal(requests[1].credentials, 'omit');
  assert.equal(requests[1].body.api_password, 'custom-fixture');
  assert.equal(requests[1].body.destination_url, source);
  assert.equal(await client.resolveMediaFlowSource('http://192.168.1.2/video.mkv', signal, custom), proxied, 'User-managed proxy can serve their local media');
  assert.equal(requests.at(-1).body.destination_url, 'http://192.168.1.2/video.mkv');
  fail = true;
  await assert.rejects(client.resolveMediaFlowSource('https://media.example/other.mp4', signal, inHouse), /Check Playback settings/);
  await assert.rejects(client.resolveMediaFlowSource(source, AbortSignal.abort(), inHouse));

  const calls = [];
  const transport = load('lib/server/outbound-fetch.ts', { 'server-only': {}, 'ipaddr.js': require('ipaddr.js') }, {
    ...globals, WebSocketPair: class {}, fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url) === `${proxyUrl}/generate_url`) return Response.json({ url: proxied });
      return new Response(null, { status: 206, headers: { 'Content-Type': 'video/x-matroska' } });
    },
  });
  const server = load('lib/server/web-playback-source.ts', { 'server-only': {}, './outbound-fetch': transport, '../media/mediaflow-url': urlHelpers }, {
    ...globals, process: { env: { MEDIAFLOW_PROXY_URL: proxyUrl, MEDIAFLOW_API_PASSWORD: 'in-house-fixture' } },
  });
  assert.equal(await server.resolveInHouseMediaFlowSource(source, signal), proxied);
  assert.equal(calls[0].init.headers.get('range'), 'bytes=0-0');
  assert.equal(calls[1].url, `${proxyUrl}/generate_url`);
  assert.equal(JSON.parse(calls[1].init.body).api_password, 'in-house-fixture');
  assert.equal(JSON.parse(calls[1].init.body).destination_url, source);
  await assert.rejects(server.resolveInHouseMediaFlowSource('http://192.168.1.2/video.mkv', signal), /Private/);
  assert.equal(calls.length, 2, 'The hosted proxy is not issued a URL for a private address');

  let signedIn = false;
  const route = load('app/api/playback/source/route.ts', {
    '@/lib/server/auth': { getAuthData: async () => { if (!signedIn) throw new Error(); } },
    '@/lib/server/web-playback-source': server,
  }, globals);
  const req = origin => new Request('https://navigator.example/api/playback/source', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: source, mediaFlow: 'in-house' }),
  });
  assert.equal((await route.POST(req('https://navigator.example'))).status, 401);
  signedIn = true;
  assert.equal((await route.POST(req('https://other.example'))).status, 403);
  const response = await route.POST(req('https://navigator.example'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(await response.json(), { url: proxied });
  const gpu = load('lib/media/webgpu-source.ts', { './mediaflow-url': urlHelpers }, { ...globals, fetch: () => { throw new Error('Already routed'); } });
  assert.equal(await gpu.resolveWebGpuSource(proxied, signal), proxied);
  console.log('PASS: MediaFlow modes, URLs, HLS endpoint, custom LAN destination, cache, authenticated in-house generation and WebGPU transport reuse');
})().catch(error => { console.error(error); process.exitCode = 1; });
