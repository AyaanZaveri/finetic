const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

let analysis = null;
let captureEffects = false;
const effects = [];
const imageRequests = [];
let canvasContext = null;
const react = {
    ...require('react'),
    useEffect(effect) { if (captureEffects) effects.push(effect); },
    useState: () => [analysis, update => { analysis = typeof update === 'function' ? update(analysis) : update; }],
};
function load(file, dependencies = {}, globals = {}) {
    const context = { exports: {}, require(name) {
        if (name === 'react') return react;
        if (name in dependencies) return dependencies[name];
        return require(name);
    }, ...globals };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, context);
    return context.exports;
}
const { VibrantLogo } = load('components/vibrant-logo.tsx');
const boundsHelpers = load('lib/wordmark-bounds.ts');
const { HeroWordmark } = load('components/hero-wordmark.tsx', {
    './vibrant-logo': { VibrantLogo },
    '@/lib/wordmark-bounds': boundsHelpers,
    '@/lib/artwork': load('lib/artwork.ts', {}, { URLSearchParams }),
    '@/lib/utils': { cn: (...classes) => classes.filter(Boolean).join(' ') },
    './hero-wordmark.module.css': { default: { root: 'root', artwork: 'artwork', image: 'image' } },
}, {
    Image: class {
        naturalWidth = 2944;
        naturalHeight = 834;
        set src(value) {
            imageRequests.push(value);
            if (value.includes('wsrv.nl')) this.onload?.();
            else this.onerror?.();
        }
    },
    document: { createElement: () => {
        const canvas = { getContext: () => canvasContext && canvasContext(canvas) };
        return canvas;
    } },
});
function render(src = '/wide-logo.svg') {
    const tree = HeroWordmark({ src, alt: 'Title logo', movieName: 'Title' });
    const artwork = tree.props.children;
    const logo = VibrantLogo(artwork.props.children.props.children.props);
    return { root: tree, artwork, image: logo };
}
const initial = render();
assert.equal(initial.image.props.loading, "eager", "Wordmarks load even inside an inactive carousel panel");
assert.equal(initial.root.props['data-ready'], undefined, 'Do not reveal the guessed wordmark size');
const wordmarkCss = fs.readFileSync('components/hero-wordmark.module.css', 'utf8');
assert.match(wordmarkCss, /\.artwork\s*\{[^}]*visibility:\s*hidden/s,
    'Unmeasured wordmarks must stay hidden until their final crop and aspect ratio are ready');
render().image.props.onLoad({ currentTarget: { naturalWidth: 1600, naturalHeight: 160 } });
assert.equal(render().artwork.props.style.aspectRatio, 10, 'Wide logos must use their intrinsic ratio even without pixel analysis');
const wideAspect = render().artwork.props.style.aspectRatio;
assert.equal(Math.min(768, 112 * wideAspect), 768, 'A wide desktop logo must reach the available 768px rather than the 289px fallback');

analysis = null;
render().image.props.onLoad({ currentTarget: { naturalWidth: 2944, naturalHeight: 834 } });
assert.equal(render().root.props['data-wide'], true, 'Interstellar’s decorative trail must not keep its wide lettering under the compact-logo height limit');

analysis = { src: '/wide-logo.svg', aspect: 12, bounds: { left: .1, top: .2, width: .8, height: .2 } };
render().image.props.onLoad({ currentTarget: { naturalWidth: 1600, naturalHeight: 160 } });
assert.equal(render().artwork.props.style.aspectRatio, 12, 'A late image load must preserve already-trimmed visible bounds');

render('/tall-logo.png').image.props.onLoad({ currentTarget: { naturalWidth: 200, naturalHeight: 400 } });
assert.equal(render('/tall-logo.png').artwork.props.style.aspectRatio, .5, 'Navigation must use the new logo dimensions');
assert.equal(render('/tall-logo.png').root.props['data-wide'], undefined, 'Tall logos must retain the compact height limit');
render('/tall-logo.png').image.props.onLoad({ currentTarget: { naturalWidth: 0, naturalHeight: 0 } });
assert.equal(render('/tall-logo.png').artwork.props.style.aspectRatio, .5, 'Invalid dimensions must not corrupt sizing');

// A prerendered/cached image may have loaded before React attaches onLoad.
// Its effect must still recover dimensions without cross-origin pixel access.
analysis = null;
captureEffects = true;
const artworkUrl = 'https://image.tmdb.org/t/p/original/logo.svg';
render(artworkUrl);
captureEffects = false;
effects.pop()();
assert.equal(render(artworkUrl).artwork.props.style.aspectRatio, 2944 / 834,
    'Cached logos must recover their dimensions even when the displayed image load event was missed and canvas is unavailable');
assert.ok(imageRequests.at(-1).includes('wsrv.nl'), 'Logo measurement must load external CORS-enabled image bytes');
assert.equal(render(artworkUrl).root.props['data-ready'], true,
    'Reveal the final intrinsic size even if canvas analysis is unavailable');
analysis = null;
canvasContext = canvas => ({
    drawImage() {},
    getImageData() {
        const pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
        for (let y = 10; y < 20; y++) for (let x = 10; x < 140; x++) {
            pixels[(y * canvas.width + x) * 4 + 3] = 255;
        }
        return { data: pixels };
    },
});
captureEffects = true;
const beforeMeasurement = render(artworkUrl);
captureEffects = false;
beforeMeasurement.image.props.onLoad({ currentTarget: { naturalWidth: 2944, naturalHeight: 834 } });
assert.equal(render(artworkUrl).root.props['data-ready'], undefined,
    'Image load alone must not reveal an untrimmed provisional size');
effects.pop()();
const measured = render(artworkUrl);
assert.equal(measured.root.props['data-ready'], true);
assert.ok(measured.artwork.props.style.aspectRatio > 8, 'The first visible size must include transparent-padding analysis');
const measuredAspect = measured.artwork.props.style.aspectRatio;
measured.image.props.onLoad({ currentTarget: { naturalWidth: 2944, naturalHeight: 834 } });
assert.equal(render(artworkUrl).artwork.props.style.aspectRatio, measuredAspect,
    'A late display load must not change the visible final size');
assert.equal(render('/new-title.png').root.props['data-ready'], undefined,
    'Navigation must not reveal a new title with the previous title’s measurements');
console.log('PASS: wide and cached hero logos recover dimensions without pixel analysis; cropped bounds and title navigation remain intact.');
