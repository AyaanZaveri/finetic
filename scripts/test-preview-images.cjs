const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => { let resolve; return { promise: new Promise(yes => { resolve = yes; }), resolve }; };
async function main() {
 const revoked = [], calls = []; let id = 0;
 const URL = { createObjectURL: () => `blob:fixture-${++id}`, revokeObjectURL: url => revoked.push(url) };
 const { PreviewImages, nativePreviewUrl } = load('lib/desktop/preview-images.ts', {}, {
  URL, fetch: async (source, options) => { const d = deferred(); calls.push({ source, options, d }); return d.promise; },
 });
 const source = n => `http://127.0.0.1:12345/0123456789abcdef0123456789abcdef/${n}.jpg`;
 for (const bad of ['http://remote.test/a.jpg', 'http://localhost:1/a.jpg', 'file:///a.jpg', source(1)+'?other=1', source(1).replace(':12345', ':99999')]) assert.equal(nativePreviewUrl(bad), false);
 const evicted = [], cache = new PreviewImages(url => evicted.push(url), 2, 5);
 const response = size => ({ ok: true, headers: { get: () => 'image/jpeg' }, blob: async () => ({ size }) });
 const a = cache.get(source(1)); assert.equal(cache.get(source(1)), a, 'Concurrent image requests share one fetch');
 calls[0].d.resolve(response(2)); assert.equal(await a, 'blob:fixture-1');
 assert.equal(await cache.get(source(1)), 'blob:fixture-1'); assert.equal(calls.length, 1);
 const b = cache.get(source(2)); calls.at(-1).d.resolve(response(2)); await b;
 cache.touch('blob:fixture-1');
 const c = cache.get(source(3)); calls.at(-1).d.resolve(response(2)); await c;
 assert.deepEqual(evicted, ['blob:fixture-2']);
 const d = cache.get(source(4)); calls.at(-1).d.resolve(response(4)); await d;
 assert.equal(cache.has('blob:fixture-1'), false); assert.equal(cache.has('blob:fixture-3'), false);
 const stale = cache.get(source(5)); const staleCall = calls.at(-1); cache.clear();
 assert.equal(staleCall.options.signal.aborted, true); staleCall.d.resolve(response(2)); assert.equal(await stale, null);
 assert.equal(cache.has('blob:fixture-4'), false); assert.equal(revoked.length, 4);

 class BrowserURL extends globalThis.URL {}
 BrowserURL.createObjectURL=URL.createObjectURL;BrowserURL.revokeObjectURL=URL.revokeObjectURL;
 const transfers = new Map();
 const { MpvController } = load('lib/desktop/mpv-controller.ts', { '@/lib/media/playback-preferences': { readPlaybackPreferences: () => ({ audioLanguage:'en' }) } }, {
  URL:BrowserURL, crypto:require('node:crypto'), Event,EventTarget,CustomEvent,DOMException,
  fetch:async source=>transfers.get(source)?.promise ?? response(2),
 });
 let receive;const sent=[];
 const media=new MpvController({platform:'macos',send:m=>sent.push(m),subscribe:fn=>{receive=fn;return()=>{};}});
 media.load('https://fixture.test/video.mkv');const session=media.previewSession;
 const binary=media.preview(10);receive({type:'thumbnail',session,request:sent.at(-1).request,position:8,range:{start:8,end:14},src:source(8)});
 assert.equal(await binary,'blob:fixture-5');assert.equal(media.cachedPreview(12),'blob:fixture-5');
 const invalid=media.preview(20);receive({type:'thumbnail',session,request:sent.at(-1).request,position:20,src:'http://foreign.test/image.jpg'});
 assert.equal(await invalid,null);assert.equal(media.cachedPreview(20),undefined);
 media.load('https://fixture.test/next.mkv');assert.equal(media.cachedPreview(12),undefined);assert.ok(revoked.includes('blob:fixture-5'));media.dispose();

 const ordered = new MpvController({platform:'windows',send:m=>sent.push(m),subscribe:fn=>{receive=fn;return()=>{};}});
 ordered.load('https://fixture.test/moving.mkv');
 const presented = [];
 ordered.addEventListener('previewframe', event=>presented.push(event.detail.position));
 const slow = deferred(), fast = deferred();
 transfers.set(source(100),slow);transfers.set(source(200),fast);
 receive({type:'thumbnail-frame',session:ordered.previewSession,position:100,src:source(100)});
 receive({type:'thumbnail-frame',session:ordered.previewSession,position:200,src:source(200)});
 fast.resolve(response(2));await flush();
 receive({type:'thumbnail-frame',session:ordered.previewSession,position:50,src:'data:image/jpeg;base64,BACKWARD'});
 slow.resolve(response(2));await flush();
 assert.deepEqual(presented,[200,50], 'Follow backward scrubbing too, but a slower image transfer cannot replace a newer completed preview');
 assert.ok(ordered.cachedPreview(100), 'Out-of-order images remain reusable in the cache');
 ordered.dispose();

 const runtime = hooks(), images = [], analyses = [];
 class Image {
  naturalWidth = 448; naturalHeight = 252;
  constructor() { this.ready = deferred(); images.push(this); }
  decode() { return this.ready.promise; }
  removeAttribute() {}
 }
 const { PreviewImage, PreviewLoadingIndicator } = load('components/preview-image.tsx', {
  react: runtime.react, 'react/jsx-runtime': runtime.jsx,
  '@/components/ui/loading-placeholder': { LoadingPlaceholder: 'LoadingPlaceholder' },
  '@/lib/media/preview-crop-client': { previewCrop(source, signal) { const task = { source, signal, ...deferred() }; analyses.push(task); return task.promise; } },
 }, { Image });
 const render = src => { const tree = runtime.render(PreviewImage, { src }); runtime.flush(); return tree; };
 render('one'); images[0].ready.resolve(); await flush();
 let tree = render('one'); assert.equal(tree.props.style.height, 126, 'A 16:9 preview uses the standard height'); assert.equal(tree.props.children[0].props.src, 'one', 'Display does not wait for crop analysis');
 tree = render('two'); assert.equal(tree.props.children[0].props.src, 'one', 'Retain the decoded image while its replacement loads');
 assert.equal(tree.props['aria-busy'], true);
 assert.equal(tree.props.children[2].type, PreviewLoadingIndicator, 'Keep the old frame visible with a corner indicator');
 assert.equal(analyses[0].signal.aborted, true);
 images[1].ready.resolve(); await flush(); tree = render('two'); assert.equal(tree.props.children[0].props.src, 'two');
 assert.equal(tree.props.children[2], false, 'Decoded frames clear the loading indicator');
 analyses[1].resolve({ width: 448, height: 252, bounds: { x: 0, y: 20, width: 448, height: 212 } }); await flush();
 tree = render('two'); assert.equal(tree.props.style.height, 106, 'Letterbox removal shrinks the thumbnail to the content height');
 render('three'); render('four'); images[2].ready.resolve(); await flush(); tree = render('four');
 assert.equal(tree.props.children[0].props.src, 'two', 'An abandoned decode cannot replace the visible frame');
 assert.equal(tree.props.style.height, 106, 'Pending frames keep the displayed frame’s size');
 render('wide');
 images.at(-1).ready.resolve();
 await flush();
 tree = render('wide');
 assert.equal(tree.props.children[0].props.src, 'wide', 'A decoded frame can appear while its crop is pending');
 assert.equal(tree.props.style.height, 106, 'The next letterboxed frame cannot briefly expand to its uncropped height');
 analyses.at(-1).resolve({ width: 448, height: 252, bounds: { x: 0, y: 20, width: 448, height: 212 } });
 await flush();
 assert.equal(render('wide').props.style.height, 106, 'The same letterbox crop keeps the box at the same height');
 render('imax');
 images.at(-1).naturalWidth = 360;
 images.at(-1).ready.resolve();
 await flush();
 tree = render('imax');
 assert.equal(tree.props.style.height, 106, 'A taller frame only resizes the box once its crop is known');
 analyses.at(-1).resolve({ width: 360, height: 252, bounds: { x: 0, y: 0, width: 360, height: 252 } });
 await flush();
 tree = render('imax');
 assert.equal(tree.props.style.width, 224, 'A taller landscape frame keeps the standard width');
 assert.ok(Math.abs(tree.props.style.height - 156.8) < .01, 'An IMAX-like frame gets a taller preview');
 runtime.unmount(); assert.equal(analyses.at(-1).signal.aborted, true);
 console.log('PASS: binary image validation, shared fetches, byte/count bounds, URL revocation, source cancellation, decode-before-swap and independent crop analysis');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
