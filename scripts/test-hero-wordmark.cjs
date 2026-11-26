const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const { getWordmarkLightBrightness } = load('lib/wordmark-bounds.ts');

assert.equal(getWordmarkLightBrightness([34, 30, 28, 255, 255, 255, 255, 0]), 1,
    'The dark mark and its transparent margin need no dimming');
assert.equal(getWordmarkLightBrightness([255, 255, 255, 0]), undefined,
    'Transparent artwork supplies no tone');

const h = hooks();
let canvasContext = null;
let canvasImage;
const { HeroWordmark } = load('components/hero-wordmark.tsx', {
    react: h.react,
    'react/jsx-runtime': h.jsx,
    '@/lib/utils': { cn: (...classes) => classes.filter(Boolean).join(' ') },
    './hero-wordmark.module.css': { root: 'root', artwork: 'artwork', image: 'image' },
}, {
    URLSearchParams,
    Image: class { constructor() { assert.fail('Wordmark readiness must not depend on a second image request'); } },
    document: { createElement: () => {
        const canvas = { getContext: () => canvasContext?.(canvas) };
        return canvas;
    } },
});

const source = 'https://image.tmdb.org/t/p/original/logo.svg';
let failures = 0;
const onError = () => { failures++; };
function render(src = source, adaptToLightBackdrop = false) {
    const root = h.render(HeroWordmark, { src, alt: 'Title logo', fetchPriority: 'high', onError, adaptToLightBackdrop });
    const artwork = root.props.children;
    const image = artwork.props.children.props.children;
    return { root, artwork, image };
}
function sample(width, height, complete = false) {
    return { complete, naturalWidth: width, naturalHeight: height };
}

const initial = render(source, true);
assert.equal(initial.image.type, 'img');
assert.equal(initial.image.props.src, source);
assert.equal(initial.image.props.crossOrigin, 'anonymous', 'The displayed image must supply the canvas pixels');
assert.equal(initial.image.props.loading, 'eager', 'Inactive slides can load before selection');
assert.equal(initial.image.props.fetchPriority, 'high');
assert.equal(initial.root.props['data-ready'], undefined, 'Do not reveal guessed geometry');
const css = readFileSync('components/hero-wordmark.module.css', 'utf8');
assert.match(css, /\.artwork\s*\{[^}]*visibility:\s*hidden/s);

canvasContext = canvas => ({
    drawImage(image) { canvasImage = image; },
    getImageData() {
        const pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
        for (let y = 10; y < 20; y++) for (let x = 10; x < 140; x++) {
            const color = x < 14 ? [200, 20, 20] : x < 18 ? [255, 255, 255] : [204, 204, 204];
            pixels.set([...color, 255], (y * canvas.width + x) * 4);
        }
        return { data: pixels };
    },
});
const loaded = sample(2944, 834);
initial.image.props.ref(loaded);
initial.image.props.onLoad({ currentTarget: loaded });
const measured = render(source, true);
assert.equal(canvasImage, loaded, 'Sample the exact image that will be painted');
assert.equal(measured.root.props['data-ready'], true, 'The displayed image can reveal as soon as it is measured');
assert.ok(measured.artwork.props.style.aspectRatio > 8, 'The first visible size includes transparent padding analysis');
assert.equal(measured.root.props.style['--wordmark-light-brightness'], 112 / 204,
    'Light-mode dimming follows the main lettering instead of the red and white badge');
const homeCss = readFileSync('components/home-hero.module.css', 'utf8');
assert.match(homeCss, /html:not\(\.dark\)\)\s+\.wordmark\s*\{\s*filter: brightness\(var\(--wordmark-light-brightness,/,
    'Light mode scales the original colors instead of flattening opaque pixels into a silhouette');

// A server-rendered image can finish before React attaches a load handler.
canvasContext = null;
const cached = render('/wide-logo.svg');
assert.equal(cached.root.props['data-ready'], undefined, 'Navigation must not reuse another title’s geometry');
cached.image.props.ref(sample(1600, 160, true));
assert.equal(render('/wide-logo.svg').root.props['data-ready'], true);
assert.equal(render('/wide-logo.svg').artwork.props.style.aspectRatio, 10);
assert.equal(render('/wide-logo.svg').root.props['data-wide'], true);

// An upstream row may still be drawable with an ordinary request after a
// cross-origin request fails. Intrinsic dimensions suffice in that case.
const other = 'https://images.metahub.space/logo/medium/tt1234/img';
const cors = render(other);
const broken = sample(0, 0, true);
cors.image.props.ref(broken);
const fallback = render(other);
assert.equal(fallback.image.props.crossOrigin, undefined, 'Retry a failed CORS image without crossOrigin');
assert.equal(fallback.image.props.src, other);
assert.equal(failures, 0, 'Do not replace a logo with text before the direct fallback has failed');
const recovered = sample(200, 400, true);
fallback.image.props.ref(recovered);
assert.equal(render(other).root.props['data-ready'], true);
assert.equal(render(other).artwork.props.style.aspectRatio, .5);
assert.equal(render(other).root.props['data-wide'], undefined);

const missing = render('/missing-logo.png');
missing.image.props.ref(broken);
assert.equal(failures, 1, 'A terminal load failure still lets Home show the title as text');
console.log('PASS: one direct image per wordmark, immediate crop and reveal, light-mode tone, cached sizing, CORS retry and missing-logo fallback.');
