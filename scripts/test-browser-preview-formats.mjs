// Real headed Chrome, synthetic media and Navigator's actual SeekPreview UI.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';

const directory = process.argv[2];
const run = promisify(execFile);
const session = `navigator-preview-formats-${process.pid}`;
const args = ['--session', session, '--headed', '--executable-path',
  process.env.CHROME_PATH || '/usr/bin/google-chrome', '--args', '--autoplay-policy=no-user-gesture-required'];
const cli = commands => run('agent-browser', [...args, ...commands], { timeout: 60_000 });
const servers = [], requests = [];
const files = ['avc-stereo.mkv', 'avc-surround-open-gop.mkv', 'avc-front-cues.mkv', 'avc-no-cues.mkv',
  'avc-bad-cue-offsets.mkv', 'avc-tail.mp4', 'avc-front.mp4', 'avc-fragmented.mp4', 'avc.mov', 'vp9.webm'];
async function listen(handler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function body(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  return data;
}
try {
  const origin = await listen(async (req, res) => {
    const parsed = new URL(req.url, 'http://fixture');
    const name = parsed.pathname.slice(1);
    if (!files.includes(name)) { res.writeHead(404).end(); return; }
    const path = join(directory, name), size = (await stat(path)).size;
    const mode = parsed.searchParams.get('mode');
    const mime = name.endsWith('.mkv') ? 'video/x-matroska' : name.endsWith('.webm') ? 'video/webm' : name.endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
    const headers = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    if (mode !== 'opaque') {
      headers['Access-Control-Allow-Origin'] = '*';
      headers['Access-Control-Expose-Headers'] = 'Content-Range, Content-Length, Accept-Ranges';
      headers['Access-Control-Allow-Headers'] = 'Range';
    }
    if (req.method === 'OPTIONS') { res.writeHead(204, headers).end(); return; }
    requests.push({ name, mode, range: req.headers.range, fetchMode: req.headers['sec-fetch-mode'] });
    const range = mode === 'no-range' ? null : /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` }).end(); return; }
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    headers['Content-Length'] = end - start + 1;
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(path, { start, end });
    res.on('close', () => stream.destroy());
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { SeekPreview } from './components/seek-preview';
    const origin = ${JSON.stringify(origin)}, names = ${JSON.stringify(files)};
    const main = document.querySelector('#main'), host = document.querySelector('#preview');
    const root = createRoot(host), results = [];
    const check = (ok, reason) => { if (!ok) throw Error(reason); };
    async function until(predicate, reason, deadline = 12000) {
      const limit = performance.now() + deadline;
      while (!predicate()) {
        check(performance.now() < limit, reason);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    const progress = value => fetch('/progress', { method: 'POST', body: value });
    function render(source, time, active = true) {
      root.render(<SeekPreview media={main} source={source} time={time} duration={30} active={active} />);
    }
    async function preview(name, mode) {
      const source = origin + '/' + name + (mode ? '?mode=' + mode : '');
      await progress(name + (mode ? ' ' + mode : ''));
      let kind;
      const timings = [];
      for (const target of [18, 5, 11, 18]) {
        const started = performance.now();
        render(source, target);
        // Give React a commit before reading the new request state.
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await until(() => {
          if (host.textContent.includes('Preview unavailable')) throw Error(name + ': Preview unavailable at ' + target);
          const surface = host.querySelector('[data-slot="media-player-seek-thumbnail"]');
          if (!surface || surface.getAttribute('aria-busy') !== 'false') return false;
          const image = surface.querySelector('img');
          const video = surface.querySelector('video.opacity-100');
          if (image?.complete && image.naturalWidth > 0 && image.getBoundingClientRect().width > 0 && getComputedStyle(image).visibility === 'visible'
              && image.closest('[aria-busy]')?.getAttribute('aria-busy') === 'false') { kind = 'jpeg'; return true; }
          if (video?.readyState >= 2 && video.videoWidth > 0 && video.getBoundingClientRect().width > 0) { kind = 'video'; return true; }
          return false;
        }, name + ': no visible preview at ' + target);
        timings.push(Math.round(performance.now() - started));
      }
      check(Math.abs(main.currentTime - 1) < .1, name + ': preview moved the main playback clock');
      results.push({ name, mode: mode || 'cors', kind, timings });
      render(source, 18, false);
      // A new source unmounts its previous decoder and cache.
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    async function test() {
      main.src = origin + '/avc-front.mp4';
      main.muted = true;
      await main.play();
      let frame = false;
      main.requestVideoFrameCallback(() => { frame = true; });
      await until(() => frame && main.getVideoPlaybackQuality().totalVideoFrames > 0, 'Main video did not present a frame');
      main.pause();
      main.currentTime = 1;
      await until(() => !main.seeking && main.readyState >= 2 && Math.abs(main.currentTime - 1) < .1, 'Main video did not seek');
      const failures = [];
      for (const [name, mode] of [...names.map(name => [name, '']), ['avc-front.mp4', 'opaque'], ['avc-front.mp4', 'no-range']]) {
        try { await preview(name, mode); }
        catch (error) { failures.push({ name, mode, error: String(error.message) }); }
      }
      root.unmount();
      main.removeAttribute('src'); main.load();
      return { ok: failures.length === 0, results, failures };
    }
    test().catch(error => ({ ok: false, results, failures: [{ error: String(error.stack || error) }] }))
      .then(report => { document.querySelector('#result').textContent = JSON.stringify(report); return fetch('/result', { method: 'POST', body: JSON.stringify(report) }); });
  ` }, outfile: '/fixture.js', bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', write: false });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).contents;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
  const worker = await build({ entryPoints: ['lib/media/preview-crop.worker.ts'], bundle: true, platform: 'browser', format: 'esm', write: false });
  let report;
  const reported = new Promise(resolve => { report = resolve; });
  const app = await listen(async (req, res) => {
    if (req.url === '/') res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><meta charset="utf-8"><style>
      body{background:#111;color:white}video#main{width:480px;height:270px}.relative{position:relative}.absolute{position:absolute}.inset-0{inset:0}.size-full{width:100%;height:100%}.opacity-0{opacity:0}.opacity-100{opacity:1}.overflow-hidden{overflow:hidden}.object-contain{object-fit:contain}${css}
      </style><video id="main" playsinline muted></video><div id="preview"></div><pre id="result">Testing</pre><script type="module" src="/fixture.js"></script>`);
    else if (req.url === '/fixture.js') res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(js);
    else if (req.url === '/preview-crop.worker.ts') res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(worker.outputFiles[0].contents);
    else if (req.url === '/api/playback/source' && req.method === 'POST') {
      const url = JSON.parse(await body(req)).url;
      if (!url.startsWith(origin + '/')) { res.writeHead(400).end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ url }));
    } else if (req.method === 'POST' && ['/progress', '/result'].includes(req.url)) {
      const data = await body(req);
      res.writeHead(204).end();
      if (req.url === '/progress') console.log('Browser preview:', data);
      else report(JSON.parse(data));
    } else res.writeHead(404).end();
  });
  await cli(['open', app]);
  let timeout;
  try {
    const result = await Promise.race([reported, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(Error('Browser preview test did not finish')), 240_000);
    })]);
    console.log(JSON.stringify(result, null, 2));
    assert.equal(result.ok, true, JSON.stringify(result.failures));
    assert.ok(requests.some(r => r.mode === 'opaque' && r.fetchMode === 'no-cors'), 'The opaque source must reach actual HTML video fallback');
    assert.ok(requests.some(r => r.mode === 'no-range' && r.range), 'The non-range server must exercise rejected sparse reads');
  } finally { clearTimeout(timeout); }
} catch (error) {
  for (const command of [['get', 'text', '#result'], ['console'], ['errors']]) {
    const diagnostic = await cli(command).catch(e => ({ stdout: e.stdout, stderr: e.stderr }));
    console.log(command.join(' '), diagnostic.stdout, diagnostic.stderr);
  }
  throw error;
} finally {
  await cli(['close']).catch(() => {});
  for (const server of servers) { server.closeAllConnections(); server.close(); }
}
