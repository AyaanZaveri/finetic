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
 const { MpvController } = load('lib/desktop/mpv-controller.ts', { '@/lib/media/playback-preferences': { readPlaybackPreferences: () => ({ audioLanguage:'en' }) } }, {
  URL:BrowserURL, crypto:require('node:crypto'), Event,EventTarget,CustomEvent,DOMException,
  fetch:async()=>response(2),
 });
 let receive;const sent=[];
 const media=new MpvController({platform:'macos',send:m=>sent.push(m),subscribe:fn=>{receive=fn;return()=>{};}});
 media.load('https://fixture.test/video.mkv');const session=media.previewSession;
 const binary=media.preview(10);receive({type:'thumbnail',session,request:sent.at(-1).request,position:8,range:{start:8,end:14},src:source(8)});
 assert.equal(await binary,'blob:fixture-5');assert.equal(media.cachedPreview(12),'blob:fixture-5');
 const invalid=media.preview(20);receive({type:'thumbnail',session,request:sent.at(-1).request,position:20,src:'http://foreign.test/image.jpg'});
 assert.equal(await invalid,null);assert.equal(media.cachedPreview(20),undefined);
 media.load('https://fixture.test/next.mkv');assert.equal(media.cachedPreview(12),undefined);assert.ok(revoked.includes('blob:fixture-5'));media.dispose();

 const runtime = hooks(), images = [], analyses = [];
 class Image {
  naturalWidth = 448; naturalHeight = 252;
  constructor() { this.ready = deferred(); images.push(this); }
  decode() { return this.ready.promise; }
  removeAttribute() {}
 }
 const { PreviewImage } = load('components/preview-image.tsx', {
  react: runtime.react, 'react/jsx-runtime': runtime.jsx,
  '@/lib/media/preview-crop-client': { previewCrop(source, signal) { const task = { source, signal, ...deferred() }; analyses.push(task); return task.promise; } },
 }, { Image });
 const render = src => { const tree = runtime.render(PreviewImage, { src }); runtime.flush(); return tree; };
 render('one'); images[0].ready.resolve(); await flush();
 let tree = render('one'); assert.equal(tree.props.children[0].props.src, 'one', 'Display does not wait for crop analysis');
 tree = render('two'); assert.equal(tree.props.children[0].props.src, 'one', 'Retain the decoded image while its replacement loads');
 assert.equal(tree.props['aria-busy'], true); assert.equal(analyses[0].signal.aborted, true);
 images[1].ready.resolve(); await flush(); tree = render('two'); assert.equal(tree.props.children[0].props.src, 'two');
 analyses[1].resolve({ width: 448, height: 252, bounds: { x: 0, y: 20, width: 448, height: 212 } }); await flush();
 tree = render('two'); assert.equal(tree.props.style.aspectRatio, 448/212);
 render('three'); render('four'); images[2].ready.resolve(); await flush(); tree = render('four');
 assert.equal(tree.props.children[0].props.src, 'two', 'An abandoned decode cannot replace the visible frame');
 runtime.unmount(); assert.equal(analyses.at(-1).signal.aborted, true);
 console.log('PASS: binary image validation, shared fetches, byte/count bounds, URL revocation, source cancellation, decode-before-swap and independent crop analysis');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
