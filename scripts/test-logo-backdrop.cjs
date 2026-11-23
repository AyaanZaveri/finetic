const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, dependencies = {}) {
    const context = { exports: {}, URL, URLSearchParams, require: name => dependencies[name] };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, context);
    return context.exports;
}
const contrast = load('lib/logo-contrast.ts');
const { paintLogoBackdrop, logoSampleSource, verticalGradientStops, logoBlurRadius } = load('lib/logo-backdrop.ts', { '@/lib/logo-contrast': contrast, '@/lib/artwork': load('lib/artwork.ts') });
const css = 'linear-gradient(rgba(255, 255, 255, 0) 0%, rgb(255, 255, 255) 100%)';
assert.equal(verticalGradientStops(css).length, 2, 'Commas inside color functions must not split the gradient');
assert.equal(verticalGradientStops('linear-gradient(90deg, black, white)'), null);
assert.equal(verticalGradientStops('linear-gradient(to bottom, transparent, white 100%)')[0].position, 0);
assert.equal(verticalGradientStops('linear-gradient(0deg, transparent 0%, white 100%)')[0].color, 'white');
const box = { left: 0, top: 0, width: 100, height: 100 };
const logoBox = { left: 40, top: 40, width: 20, height: 20 };
const layer = { rect: box, filter: 'blur(10px)', mask: 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,1) 100%)', opacity: .5 };
assert.equal(logoBlurRadius([layer], logoBox), 5, 'Mask and scroll-transition opacity both affect the sampled blur');
assert.equal(logoBlurRadius([{ ...layer, opacity: 0 }], logoBox), 0);
assert.equal(logoBlurRadius([{ ...layer, rect: { ...box, top: 200 } }], logoBox), 0);
const opaque = { ...layer, mask: 'none', opacity: 1 };
assert.equal(logoBlurRadius([opaque, opaque], logoBox), Math.sqrt(200));

const calls = [];
function recordingCanvas() {
    const canvas = { width: 64, height: 64 };
    const context = { canvas, filter: 'none', globalAlpha: 1,
        clearRect() {}, save() {}, restore() { this.filter = 'none'; }, scale() {}, translate() {},
        fillRect() { calls.push(['fill', this.fillStyle]); },
        drawImage(...args) { calls.push(['image', this.filter, args]); },
    };
    canvas.getContext = () => context;
    return canvas;
}
const output = recordingCanvas(), scratch = recordingCanvas();
paintLogoBackdrop(output.getContext(), { left: 64, top: 64, width: 32, height: 32 }, 'white', {
    image: { naturalWidth: 160, naturalHeight: 160 }, rect: { left: 0, top: 0, width: 160, height: 160 }, opacity: 1, objectPosition: '50% 50%',
}, [{ rect: box, background: 'black', opacity: .1, header: true }], { radius: 12, canvas: scratch });
assert.ok(calls.find(call => call[0] === 'image' && call[1] === 'blur(24px)'), 'Blur is applied at the canvas sampling scale');
assert.ok(calls.find(call => call[0] === 'image' && call[2][3] > 32), 'Surrounding source pixels participate, not just the unblurred logo crop');
assert.equal(calls.at(-1)[0], 'fill', 'The header tint paints after the filtered backdrop');
assert.ok(logoSampleSource('https://image.tmdb.org/t/p/w300/backdrop.jpg', 'https://navigator.test').includes('wsrv.nl'));
const fullSizeArtwork = 'https://image.tmdb.org/t/p/w1280/art.jpg';
assert.equal(new URL(logoSampleSource(fullSizeArtwork, 'https://navigator.test')).searchParams.get('url'), fullSizeArtwork,
    'Sampling preserves the full-size artwork URL when routing it through the image service');

// A one-pixel software canvas exercises the real painter's compositing at the
// logo center. The fixed logo stays at y=8 while artwork/fade scroll underneath.
function reading({ top = 0, background = 255, fade = false, imageOpacity = 1, tint = false } = {}) {
    let pixel = [0, 0, 0];
    function color(cssColor) {
        if (cssColor === 'transparent') return [0, 0, 0, 0];
        const values = cssColor.match(/[\d.]+/g).map(Number);
        return [values[0], values[1], values[2], values[3] ?? 1];
    }
    const point = { x: 8, y: 8 };
    function blend(value, opacity) {
        const alpha = value[3] * opacity;
        pixel = pixel.map((channel, i) => channel * (1 - alpha) + value[i] * alpha);
    }
    const context = {
        canvas: { width: 1, height: 1 }, globalAlpha: 1, fillStyle: '',
        clearRect() {}, save() {}, restore() {}, scale() {}, translate() {},
        createLinearGradient(_x, y, _x2, bottom) {
            return { y, bottom, stops: [], addColorStop(position, value) { this.stops.push({ position, color: color(value) }); } };
        },
        fillRect(x, y, width, height) {
            if (point.x < x || point.x >= x + width || point.y < y || point.y >= y + height) return;
            if (typeof this.fillStyle === 'string') blend(color(this.fillStyle), this.globalAlpha);
            else {
                const gradient = this.fillStyle;
                const fraction = Math.max(0, Math.min(1, (point.y - gradient.y) / (gradient.bottom - gradient.y)));
                const a = gradient.stops[0].color, b = gradient.stops.at(-1).color;
                blend(a.map((value, i) => value + (b[i] - value) * fraction), this.globalAlpha);
            }
        },
        drawImage(image, _sx, _sy, _sw, _sh, x, y, width, height) {
            if (point.x >= x && point.x < x + width && point.y >= y && point.y < y + height) blend(image.color, this.globalAlpha);
        },
    };
    const rect = { left: 0, top, width: 100, height: 100 };
    const overlays = fade ? [{ rect, background: css, opacity: 1 }] : [];
    if (tint) overlays.push({ rect: {left:0,top:0,width:100,height:100}, background: css, opacity: .12 });
    paintLogoBackdrop(context, {left:0,top:0,width:16,height:16}, `rgb(${background}, ${background}, ${background})`, {
        image: { naturalWidth: 100, naturalHeight: 100, color: [30,30,30,1] }, rect, opacity: imageOpacity, objectPosition: '50% 50%',
    }, overlays);
    return contrast.chooseLogoTreatment(new Uint8ClampedArray([...pixel,255]), {
        light: [54,204,176,255], dark: [17,135,119,255], deep: [7,84,73,255], neutral: [244,251,249,255],
    });
}
assert.equal(reading(), 'light', 'Dark artwork selects the bright logo in light mode');
assert.equal(reading({ background: 0 }), 'light', 'The same opaque artwork selects the same logo in dark mode');
assert.equal(reading({ imageOpacity: .88 }), 'light', 'A subtle light-theme artwork wash does not force a theme-based logo');
assert.equal(reading({ fade: true }), 'light');
assert.equal(reading({ top: -70, fade: true }), 'deep', 'The fade to white must switch the logo before the backdrop leaves the screen');
assert.equal(reading({ top: -94 }), 'deep', 'Partially exposed page background must be sampled too');
assert.equal(reading({ top: -120 }), 'deep', 'Once artwork leaves, sample the actual white page');
assert.equal(reading({ top: -120, background: 0 }), 'light', 'A black page retains the brighter logo');
console.log('PASS: local compositing, theme-independent artwork contrast, scroll fades, partial overlap, page color, and origin-clean sample URLs');
