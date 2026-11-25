const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { BrowserImage } = require('@vibrant/image-browser');

// Exercise Vibrant's real browser loader. Model the canvas security rule for
// our same-origin artwork URLs that redirect to TMDB's cross-origin CDN.
class TestImage {
  complete = true;
  width = 10;
  height = 10;
  set src(value) {
    this._src = value;
    // Anonymous CORS cannot make a CDN that refuses canvas access readable.
    // The first-party sample endpoint must return bytes instead of redirecting.
    this.tainted = value.startsWith('https://image.tmdb.org/');
  }
  get src() { return this._src; }
}
global.HTMLImageElement = TestImage;
global.Image = TestImage;
global.location = new URL('https://navigator.test/movie/tt1');
global.window = { location: global.location };
global.document = {
  body: { appendChild() {} },
  createElement(tag) {
    if (tag === 'img') return new TestImage();
    let tainted = false;
    return { style: {}, getContext: () => ({
      drawImage(image) { tainted = image.tainted; },
      getImageData() {
        if (tainted) throw new DOMException('Canvas contains cross-origin data', 'SecurityError');
        return { data: new Uint8ClampedArray([255, 100, 0, 255]) };
      },
    }) };
  },
};

const { load, hooks } = require('./test-support/react-hooks.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const paletteHelpers = load('lib/aurora-palette.ts');
const artworkHelpers = load('lib/artwork.ts', {}, { URLSearchParams });
const palette = color => ({ Vibrant: { hex: color, population: 20 }, DarkVibrant: { hex: '#112233', population: 10 } });
const calls = [], pending = new Map();
const Vibrant = { from(image) { return {
  maxDimension(value) { assert.equal(value, 160, 'Pixel analysis must be bounded'); return this; },
  async getPalette() {
    const loader = await new BrowserImage().load(image);
    loader.getImageData();
    const url = image.src;
    calls.push(url);
    if (url.includes('broken')) throw Error('Artwork unavailable');
    if (url.includes('slow')) return new Promise(resolve => pending.set(url, resolve));
    if (url.includes('stalled')) return new Promise(() => {});
    return palette(url.includes('second') ? '#3366FF' : '#FF6600');
  },
}; } };
const loader = load('lib/aurora-palette-loader.ts', {
  'node-vibrant/browser': { Vibrant }, '@/lib/artwork': artworkHelpers, '@/lib/aurora-palette': paletteHelpers,
}, { Image: TestImage, URLSearchParams, setTimeout: callback => setTimeout(callback, 20), clearTimeout });
const first = 'https://image.tmdb.org/t/p/original/first-backdrop.jpg';
const second = 'https://image.tmdb.org/t/p/original/second-backdrop.jpg';

async function testCache() {
  const unsafe = await new BrowserImage().load('https://image.tmdb.org/t/p/original/tt1-backdrop.jpg');
  assert.throws(() => unsafe.getImageData(), { name: 'SecurityError' });
  const a = loader.loadAuroraPalette(first);
  assert.equal(a, loader.loadAuroraPalette(first), 'Strict Mode/concurrent consumers share one in-flight extraction');
  const colors = await a;
  assert.equal(colors[0], '#ff6600');
  assert.equal(colors.length, 3);
  assert.ok(calls[0].includes('wsrv.nl'), 'Extraction uses same-origin small image bytes');
  const count = calls.length;
  assert.equal(await loader.loadAuroraPalette(first), colors);
  assert.equal(calls.length, count, 'Revisiting a title must reuse its successful palette');
  await loader.loadAuroraPalette('https://image.tmdb.org/t/p/original/broken-backdrop.jpg', first.replace('backdrop', 'poster'));
  assert.ok(calls.some(url => url.includes('poster.jpg')));
  await loader.loadAuroraPalette('https://image.tmdb.org/t/p/original/stalled-backdrop.jpg', first.replace('backdrop', 'poster'));
  const failed = 'https://image.tmdb.org/t/p/original/broken-only-backdrop.jpg';
  assert.equal(await loader.loadAuroraPalette(failed), null);
  const attempts = calls.length;
  await loader.loadAuroraPalette(failed);
  assert.equal(calls.length, attempts + 1, 'Failures cannot poison the cache');
  await loader.loadAuroraPalette('https://image.tmdb.org/t/p/original/backdrop.jpg');
  assert.ok(calls.some(url => url.includes('wsrv.nl') && url.includes('backdrop.jpg')));
  console.log('PASS: origin-clean small samples, bounded analysis, shared requests, cached revisits, poster/time-out fallbacks and retryable failures.');
}

async function testRouteHandoff() {
  const h = hooks();
  let pathname = '/movie/first', playing = false;
  const component = load('components/aurora-provider.tsx', {
    react: h.react, 'react/jsx-runtime': h.jsx,
    'next/navigation': { usePathname: () => pathname },
    jotai: { useAtomValue: () => playing }, '@/lib/atoms': {},
    '@/components/aurora-background': { AuroraBackground: 'AuroraSurface' },
    '@/lib/aurora-palette': paletteHelpers,
  });
  const render = () => { h.render(component.AuroraProvider, { children: null }); h.flush(); };
  const view = () => component.PersistentAuroraBackground().props;
  render();
  const register = component.useAuroraRegistration();
  assert.equal(view().opacity, 0, 'First load cannot show an unrelated default palette');
  const a = register({ route: pathname, amplitude: 0.8, blend: 0.4, opacity: 0.2 });
  const colorsA = ['#ff0000', '#ff0000', '#ff0000'];
  const colorsB = ['#0000ff', '#0000ff', '#0000ff'];
  a.resolve(colorsA); render();
  assert.equal(component.useAuroraRegistration(), register, 'Palette updates cannot replace the registration API and restart consumers');
  assert.equal(view().opacity, 0.2);
  assert.equal(view().colorStops, colorsA);
  pathname = '/movie/second';
  a.release();
  const b = register({ route: pathname, amplitude: 0.8, blend: 0.4, opacity: 0.2 });
  render();
  assert.equal(view().opacity, 0.05, 'Loading the next title retains a low-opacity glow');
  assert.equal(view().colorStops, colorsA, 'The persistent renderer retains its displayed colors');
  await tick(); render();
  b.resolve(colorsB); render();
  assert.equal(view().opacity, 0.2, 'The old route cleanup cannot hide the new route');
  a.resolve(colorsA); render();
  assert.equal(view().colorStops, colorsB, 'A previous title finishing late cannot overwrite the active title');
  pathname = '/'; render();
  assert.equal(view().opacity, 0, 'Home without a hero must not inherit a detail page glow');
  const home = register({ route: pathname, amplitude: 0.8, blend: 0.4, opacity: 0.24 });
  render();
  assert.equal(view().opacity, 0, 'Home waits for its own artwork instead of inheriting a previous detail title');
  home.resolve(colorsA); render();
  assert.equal(view().opacity, 0.24, 'Home hero uses the existing persistent Aurora');
  const nextHome = register({ route: pathname, amplitude: 0.8, blend: 0.4, opacity: 0.24 });
  home.release(); render();
  assert.equal(view().opacity, 0.24, 'Changing hero slides retains the glow while the new palette loads');
  nextHome.resolve(colorsB); render();
  assert.equal(view().colorStops, colorsB);
  nextHome.release(); await tick(); render();
  assert.equal(view().opacity, 0, 'Removing the hero removes its Aurora');
  pathname = '/movie/second'; playing = true; render();
  assert.equal(view().opacity, 0, 'Playback pauses the persistent surface');
  playing = false;
  const c = register({ route: pathname, amplitude: 0.8, blend: 0.4, opacity: 0.2 });
  c.resolve(null); render();
  assert.equal(view().opacity, 0, 'Failed artwork fades out rather than retaining unrelated colors');
  console.log('PASS: persistent route handoff, muted loading glow, stale-owner protection, playback and failure visibility.');
}

async function testConsumerCancellation() {
  const h = hooks(), resolutions = [], releases = [];
  let theme = 'light';
  const component = load('components/vibrant-aurora-background.tsx', {
    react: h.react, 'react/jsx-runtime': h.jsx,
    'next/navigation': { usePathname: () => '/movie/current' },
    'next-themes': { useTheme: () => ({ resolvedTheme: theme }) },
    '@/components/aurora-background': {},
    '@/components/aurora-provider': { useAuroraRegistration: () => () => ({
      resolve: colors => resolutions.push(colors), release: () => releases.push(true),
    }) }, '@/lib/aurora-palette-loader': loader, '@/lib/aurora-palette': paletteHelpers,
  }).VibrantAuroraBackground;
  const slow = 'https://image.tmdb.org/t/p/original/slow-backdrop.jpg';
  const before = calls.length;
  h.render(component, { backdropUrl: slow }); h.flush(); await tick();
  assert.equal(calls.length, before, 'Light mode cannot download/decode invisible aurora artwork');
  theme = 'dark';
  assert.equal(h.render(component, { backdropUrl: slow }), null, 'Route consumers cannot create their own canvas');
  h.flush(); await tick();
  h.render(component, { backdropUrl: second }); h.flush(); await tick();
  const count = resolutions.length;
  const slowResolution = [...pending.entries()].find(([url]) => url.includes('slow-backdrop.jpg'))?.[1];
  assert.equal(typeof slowResolution, 'function', 'The current artwork sampler must reach the deferred extraction');
  slowResolution(palette('#00ff00'));
  await tick();
  assert.equal(resolutions.length, count, 'Unmounted consumers cannot publish a late shared extraction');
  assert.ok(releases.length > 0);
  h.unmount();
  console.log('PASS: route pages register palettes without additional canvases; obsolete consumers cancel publication.');
}
(async () => { await testCache(); await testRouteHandoff(); await testConsumerCancellation(); })()
  .catch(error => { console.error(error); process.exitCode = 1; });
