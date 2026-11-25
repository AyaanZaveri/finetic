// Real Chromium playback against three local origins. No external media or credentials.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { build } from 'esbuild';

const run = promisify(execFile);
const temp = await mkdtemp(join(tmpdir(), 'navigator-cors-'));
const servers = [];
const requests = [];
const session = 'navigator-cors-playback';
const browser = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const cli = (args, options = {}) => run('agent-browser', ['--session', session, ...args], { timeout: 60_000, ...options });
async function listen(handler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

try {
  const fixture = join(temp, 'fixture.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-movflags', '+faststart', fixture]);
  const mp4 = await readFile(fixture);
  const cdn = await listen((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    const test = url.searchParams.get('case');
    requests.push({ test, mode: req.headers['sec-fetch-mode'], range: req.headers.range });
    if (url.pathname === '/missing.mp4') { res.writeHead(404).end(); return; }
    const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    if (test === 'cors-ok') headers['Access-Control-Allow-Origin'] = '*';
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), mp4.length - 1) : mp4.length - 1;
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${mp4.length}` }).end(); return; }
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${mp4.length}`;
    headers['Content-Length'] = end - start + 1;
    res.writeHead(range ? 206 : 200, headers).end(req.method === 'HEAD' ? undefined : mp4.subarray(start, end + 1));
  });
  const redirect = await listen((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    res.writeHead(url.pathname === '/play/token' ? 302 : 307, {
      'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store',
      Location: (url.pathname === '/play/token' ? '/redirect' : `${cdn}/file.mp4`) + url.search,
    }).end();
  });
  const { outputFiles } = await build({
    stdin: { contents: `
      import { createWebVideoSession } from './lib/media/web-video-preload.ts';
      import { canUseWebGpu } from './lib/media/webgpu-module.ts';
      import { probeStreamPlayability } from './lib/media/stream-playability.ts';
      const cdn = ${JSON.stringify(cdn)}, redirect = ${JSON.stringify(redirect)};
      const check = (value, message) => { if (!value) throw Error(message); };
      const waitFor = async (test, message) => {
        const deadline = performance.now() + 20000;
        while (!test()) {
          if (performance.now() > deadline) throw Error(message);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      };
      const results = [];
      const prefs = gpu => localStorage.setItem('navigator-playback-preferences', JSON.stringify({ webGpuPlayback: gpu }));
      async function playback(name, url, gpu, corsFallback) {
        document.querySelector('#result').textContent = 'Testing ' + name;
        prefs(gpu);
        check(canUseWebGpu(url) === gpu, name + ': requested engine is unavailable');
        const session = createWebVideoSession(url);
        const video = session.video;
        document.querySelector('#host').append(video);
        video.muted = true;
        let errors = 0, frame = false;
        video.addEventListener('error', () => errors++);
        video.addEventListener('loadedmetadata', () => { void video.play().catch(() => {}); });
        try {
          check(video.crossOrigin === 'anonymous', name + ': begin with CORS');
          void video.play().catch(() => {});
          await waitFor(() => errors || (video.readyState >= 2 && !video.webgpu && video.currentTime > .2), name + ': playback did not start, ' + JSON.stringify(video.dataset));
          check(!errors, name + ': unexpected terminal error ' + video.error?.message + ' ' + JSON.stringify(video.dataset));
          video.requestVideoFrameCallback(() => { frame = true; });
          await waitFor(() => frame && video.getVideoPlaybackQuality().totalVideoFrames > 0, name + ': no native video frame');
          check(video.crossOrigin === (corsFallback ? null : 'anonymous'), name + ': incorrect final CORS mode');
          check((video.dataset.browserCorsFallback !== undefined) === corsFallback, name + ': incorrect retry marker');
          if (gpu) check(video.dataset.webgpuFallback === 'source-unreadable', name + ': did not exercise the real GPU read failure: ' + JSON.stringify(video.dataset));
          results.push({ name, frames: video.getVideoPlaybackQuality().totalVideoFrames, time: video.currentTime, cors: video.crossOrigin, gpuFallback: video.dataset.webgpuFallback });
        } finally { session.dispose(); }
      }
      async function main() {
        await playback('redirect', redirect + '/play/token?case=redirect', false, true);
        await playback('direct-mp4', cdn + '/file.mp4?case=direct-mp4', false, true);
        await playback('cors-ok', cdn + '/file.mp4?case=cors-ok', false, false);
        await playback('webgpu', redirect + '/play/token?case=webgpu', true, true);
        prefs(false);
        const metadata = { mimeType: 'video/mp4', video: { codec: 'avc', codecString: 'avc1.64000b', internalCodecId: null }, audio: [{ codec: 'aac', codecString: 'mp4a.40.2', internalCodecId: null, primary: true }] };
        const probe = await probeStreamPlayability({ url: redirect + '/play/token?case=probe' }, { signal: new AbortController().signal, timeoutMs: 12000, metadata: Promise.resolve(metadata) });
        check(probe === 'supported', 'Automatic stream probe rejected the recoverable MP4: ' + probe);
        results.push({ name: 'probe', result: probe });
        const broken = createWebVideoSession(cdn + '/missing.mp4?case=missing');
        document.querySelector('#host').append(broken.video);
        let errors = 0;
        broken.video.addEventListener('error', () => errors++);
        try {
          await waitFor(() => errors > 0, 'Missing video did not report a terminal error');
          check(errors === 1 && broken.video.dataset.browserCorsFallback !== undefined, 'Missing file should retry once and fail');
          results.push({ name: 'missing', errors });
        } finally { broken.dispose(); }
      }
      main().then(() => ({ ok: true, results }), error => ({ ok: false, error: String(error.stack || error), results })).then(result => {
        document.querySelector('#result').textContent = JSON.stringify(result);
        window.finished = true;
      });
    `, resolveDir: process.cwd(), loader: 'js' }, bundle: true, format: 'esm', platform: 'browser', write: false,
  });
  const runtimeRoot = resolve('public/webgpu-player');
  const app = await listen(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><div id="host" style="width:320px;height:180px"></div><pre id="result">Loading bundle</pre>
        <script>
          window.addEventListener('error', event => {
            if (window.finished) return;
            document.querySelector('#result').textContent = JSON.stringify({ ok: false, error: event.error?.stack || event.message || 'Failed to load browser test module' });
            window.finished = true;
          });
        </script><script type="module" src="/bundle.js" onerror="window.dispatchEvent(new ErrorEvent('error', {message: 'Failed to load browser test module'}))"></script>`);
    } else if (url.pathname === '/bundle.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(outputFiles[0].contents);
    } else if (url.pathname === '/api/playback/source') {
      // Stand-in for the authenticated app endpoint: only resolve our fixture.
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ url: cdn + '/file.mp4?case=webgpu' }));
    } else if (url.pathname.startsWith('/webgpu-player/')) {
      const path = resolve('public', '.' + url.pathname);
      if (!path.startsWith(runtimeRoot + sep)) { res.writeHead(404).end(); return; }
      try {
        const content = await readFile(path);
        res.writeHead(200, { 'Content-Type': path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' }).end(content);
      } catch { res.writeHead(404).end(); }
    } else res.writeHead(404).end();
  });
  await cli(['--headed', '--executable-path', browser, '--args', '--enable-unsafe-webgpu,--enable-unsafe-swiftshader,--use-angle=swiftshader,--autoplay-policy=no-user-gesture-required', 'open', app]);
  try {
    await cli(['wait', '--fn', 'window.finished === true'], { env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: '90000' }, timeout: 100_000 });
  } catch (error) {
    for (const command of [['get', 'text', '#result'], ['console'], ['errors']]) {
      const diagnostics = await cli(command).catch(e => ({ stdout: e.stdout, stderr: e.stderr }));
      console.log(command.join(' '), diagnostics.stdout, diagnostics.stderr);
    }
    console.log('Media requests:', requests);
    throw error;
  }
  const { stdout } = await cli(['get', 'text', '#result']);
  const result = JSON.parse(stdout.trim());
  console.log(JSON.stringify(result, null, 2));
  assert.equal(result.ok, true, result.error);
  for (const test of ['redirect', 'direct-mp4', 'webgpu', 'probe', 'missing']) {
    assert.ok(requests.some(request => request.test === test && request.mode === 'cors'), `${test}: CORS attempt missing`);
    assert.ok(requests.some(request => request.test === test && request.mode === 'no-cors'), `${test}: native retry missing`);
  }
  assert.ok(!requests.some(request => request.test === 'cors-ok' && request.mode === 'no-cors'), 'CORS-enabled files must not use an opaque retry');
  console.log('PASS: real browser frames, native and WebGPU CORS fallback, automatic selection, CORS-enabled control, terminal error');
} finally {
  await cli(['close']).catch(() => {});
  for (const server of servers) { server.closeAllConnections(); server.close(); }
  await rm(temp, { recursive: true, force: true });
}
