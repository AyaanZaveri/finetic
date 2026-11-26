const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { load, hooks } = require('./test-support/react-hooks.cjs');

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
function render(src = source) {
    const root = h.render(HeroWordmark, { src, alt: 'Title logo', fetchPriority: 'high', onError });
    const artwork = root.props.children;
    const image = artwork.props.children.props.children;
    return { root, artwork, image };
}
function sample(width, height, complete = false) {
    return { complete, naturalWidth: width, naturalHeight: height };
}

const initial = render();
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
            pixels[(y * canvas.width + x) * 4 + 3] = 255;
        }
        return { data: pixels };
    },
});
const loaded = sample(2944, 834);
initial.image.props.ref(loaded);
initial.image.props.onLoad({ currentTarget: loaded });
const measured = render();
assert.equal(canvasImage, loaded, 'Sample the exact image that will be painted');
assert.equal(measured.root.props['data-ready'], true, 'The displayed image can reveal as soon as it is measured');
assert.ok(measured.artwork.props.style.aspectRatio > 8, 'The first visible size includes transparent padding analysis');

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
console.log('PASS: one direct image per wordmark, immediate crop and reveal, cached sizing, CORS retry and missing-logo fallback.');
