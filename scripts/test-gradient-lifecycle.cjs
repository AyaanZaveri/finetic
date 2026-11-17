const fs = require('node:fs');
const vm = require('node:vm');
const ts = require(process.cwd() + '/node_modules/typescript');
const { load } = require('./test-support/react-hooks.cjs');
const gradientPalette = load('lib/gradient-palette.ts', {}, { Float32Array });
let lost = false, draws = 0, shaderFailure = false, webglDisabled = false, programs = 0, now = 0;
const frames = new Map(), uploads = [];
let nextFrame = 0;
const motion = { matches: false, addEventListener(_name, fn) { this.change = fn; }, removeEventListener() { this.change = null; } };
const listeners = new Map();
const constants = new Map();
const gl = new Proxy({
  getShaderParameter: () => !lost && !shaderFailure,
  isContextLost: () => lost,
  getProgramParameter: (_, param) => param === gl.ACTIVE_UNIFORMS ? 0 : !lost,
  getExtension: () => ({ loseContext() { lost = true; } }),
  drawArrays() { if (!lost) draws++; },
  createProgram() { programs++; return {}; },
  uniform3fv(_location, value) { if (value.length === 24) uploads.push(Array.from(value)); },
}, { get(target, key) {
  if (key in target) return target[key];
  if (/^[A-Z_0-9]+$/.test(key)) { if (!constants.has(key)) constants.set(key, constants.size + 1); return constants.get(key); }
  return () => ({});
}});
const canvas = { getContext: () => webglDisabled ? null : gl, addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); }, width: 1, height: 1 };
const container = { clientWidth: 390, clientHeight: 844 };
const ctx2d = { clearRect() {}, fillRect() {}, fillText() {},
  getImageData() { return { data: [...gradientPalette.hexRgb(this.fillStyle || '#000000').map(value => Math.round(value * 255)), 255] }; },
};
let effects = [], refIndex = 0, stateIndex = 0;
const refs = [], states = [];
const react = {
  useRef(initial) {
    const i = refIndex++;
    return refs[i] ??= { current: i === 0 ? container : i === 1 ? canvas : initial };
  },
  useState(initial) {
    const i = stateIndex++;
    if (!(i in states)) states[i] = initial;
    return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }];
  },
  useEffect(fn) { effects.push(fn); },
  createElement() {},
};
const source = ts.transpileModule(fs.readFileSync('components/gradient-ascii/gradient-ascii.jsx', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
}).outputText;
const sandbox = { React: react, exports: {}, require: (name) => name === 'react' ? react
    : name === '@/lib/gradient-palette' ? gradientPalette
    : name === '@/lib/logo-canvas' ? { registerLogoCanvas: () => () => {}, captureLogoCanvas() {} } : {},
  performance: { now: () => now },
  Float32Array, Map, Math,
  requestAnimationFrame: fn => { frames.set(++nextFrame, fn); return nextFrame; }, cancelAnimationFrame: id => frames.delete(id),
  ResizeObserver: class { observe() {} disconnect() {} },
  IntersectionObserver: class { observe() {} disconnect() {} },
  window: { matchMedia: () => motion, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} },
  document: { createElement: () => ({ getContext: () => ctx2d }), hidden: false, addEventListener() {}, removeEventListener() {} },
};
vm.runInNewContext(source, sandbox);
// Evaluate the actual component and effect bodies with a small WebGL lifecycle
// model. This is not a GPU/pixel test: it catches destructive cleanup and
// verifies that context-restoration events rebuild the real renderer.
function render(props = {}) {
  refIndex = stateIndex = 0;
  effects = [];
  sandbox.exports.default({ colors: ['#00b880', '#b4ffdf'], ...props });
}
function advance(time) { now = time; const work = [...frames.values()]; frames.clear(); work.forEach(fn => fn(time)); }
render();
const removeListeners = effects[0]();
const setup = effects[1];
const assert = require('node:assert/strict');
const cleanup = setup();
assert.ok(draws > 0, 'First setup must draw');
cleanup();
assert.equal(lost, false, 'Cleanup must allow effect setup on the same canvas');
const beforeReplay = draws;
const cleanupReplay = setup();
assert.ok(draws > beforeReplay, 'Strict Mode replay must render');
console.log('PASS: setup → cleanup → setup renders on the same canvas');

lost = true;
let prevented = false;
listeners.get('webglcontextlost')({ preventDefault() { prevented = true; } });
assert.equal(prevented, true, 'Context loss must permit restoration');
assert.equal(states[1], false, 'Lost canvas must be hidden, revealing CSS background');
lost = false;
listeners.get('webglcontextrestored')();
assert.equal(states[0], 1, 'Restore must invalidate renderer resources');
cleanupReplay();
render();
const beforeRestore = draws;
const cleanupRestored = effects[1]();
assert.ok(draws > beforeRestore, 'Restore must rebuild and draw');
assert.equal(states[1], true, 'Canvas is shown only after a successful draw');
console.log('PASS: context loss hides the canvas; restoration rebuilds resources');
cleanupRestored();

shaderFailure = true;
states[1] = false;
render();
const beforeFailure = draws;
effects[1]();
assert.equal(draws, beforeFailure, 'Failed shaders must not draw');
assert.equal(states[1], false, 'CSS fallback must remain visible on shader failure');
console.log('PASS: shader initialization failure leaves the CSS background visible');
webglDisabled = true;
shaderFailure = false;
render();
effects[1]();
assert.equal(states[1], false, 'WebGL unavailability must preserve the CSS fallback');
console.log('PASS: WebGL unavailable leaves the CSS background visible');

// Exercise real prop updates against the live renderer, rather than rebuilding
// it for each palette. Only the settings effect runs on these re-renders.
webglDisabled = false;
render(); const cleanupTransition = effects[1]();
const count = programs;
const target = { colors: ['#ff0000', '#ffaaaa'], colorTransitionMs: 280 };
render(target); effects.at(-1)(); advance(10); advance(150);
const mid = uploads.at(-1);
render({ colors: ['#0000ff', '#aaaaff'], colorTransitionMs: 280 }); effects.at(-1)(); advance(150);
assert.deepEqual(uploads.at(-1), mid, 'Retarget the actual GPU ramp without a color jump');
render({ colors: ['#0000ff', '#aaaaff'], colorTransitionMs: 0 }); effects.at(-1)(); advance(160);
assert.equal(refs[7].current.track.active, false, 'Keyboard focus on the same title must finish an in-progress hover blend');
advance(430); assert.notDeepEqual(uploads.at(-1), mid);
assert.equal(programs, count, 'Palette changes cannot recreate shader programs');
motion.matches = true; motion.change(); advance(450);
assert.equal(frames.size, 0, 'A live reduced-motion change must stop the animation loop');
cleanupTransition(); motion.matches = false;
console.log('PASS: actual GPU uniform updates retarget continuously without recreating programs, and live reduced-motion stops the loop');

// The low-resolution fallback runs only while a palette changes, and does not
// keep an idle animation running when WebGL is unavailable.
webglDisabled = true;
let fallbackPaints = 0;
const fallbackCanvas = { width: 128, height: 128, clientHeight: 844 };
fallbackCanvas.getContext = () => ({ canvas: fallbackCanvas, clearRect() {}, fillRect() { fallbackPaints++; }, save() {}, restore() {}, translate() {}, scale() {},
  createRadialGradient: () => ({ addColorStop() {} }),
});
refs[4].current = fallbackCanvas;
render({ homeSurface: true }); const cleanupFallback = effects[2](); effects.at(-1)(); advance(500); advance(780);
assert.ok(fallbackPaints > 0); assert.equal(frames.size, 0, 'A settled fallback does no idle drawing');
render({ homeSurface: true, ...target }); effects.at(-1)(); advance(800); advance(940);
assert.ok(frames.size, 'Fallback palette changes animate'); advance(1080);
assert.equal(frames.size, 0, 'Fallback stops once its palette settles');
cleanupFallback();
console.log('PASS: Canvas2D fallback shares palette transitions and stops drawing after settling');

// Render the actual home background on the server with theme unresolved.
// The fallback must exist before hydration, independent of React theme state.
const React = require(process.cwd() + '/node_modules/react');
const { renderToStaticMarkup } = require(process.cwd() + '/node_modules/react-dom/server');
let resolvedTheme;
let hydrated = false;
let playerVisible = false;
const homeModule = { exports: {}, React, require(name) {
  if (name === 'react') return { useSyncExternalStore: (_subscribe, get, server) => get === server ? get() : hydrated };
  if (name === '@/components/home-palette-provider') return { useHomePaletteScene: () => null };
  if (name === '@/lib/home-palette') return load('lib/home-palette.ts');
  if (name === 'jotai') return { useAtomValue: () => playerVisible };
  if (name === '@/lib/atoms') return { isPlayerVisibleAtom: {} };
  if (name.endsWith('.module.css')) return { __esModule: true, default: { background: 'home-gradient-background', animation: 'home-gradient-animation' } };
  if (name === 'next-themes') return { useTheme: () => ({ resolvedTheme }) };
  return { __esModule: true, default: props => React.createElement('canvas', { 'data-gradient': true, 'data-light-mode': String(props.lightMode), 'data-glyph-opacity': props.glyphOpacity, 'data-gradient-opacity': props.gradientOpacity }) };
}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/home-gradient-background.tsx', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
}).outputText, homeModule);
let serverMarkup;
for (const hydrationState of [false, true]) {
  hydrated = hydrationState;
  for (const theme of [undefined, 'light', 'dark']) {
    resolvedTheme = theme;
    const html = renderToStaticMarkup(React.createElement(homeModule.exports.HomeGradientBackground));
    assert.ok(html.includes('home-gradient-background'), `CSS background required for ${theme}`);
    assert.ok(!html.includes('style='), 'No inline light background may override the CSS dark theme');
    assert.equal(html.includes('data-gradient'), hydrated, 'GPU layer must appear in both themes after hydration');
    if (hydrated) {
      assert.ok(html.includes(`data-light-mode="${theme !== 'dark'}"`), 'Shader mode must match the resolved theme');
      assert.ok(html.includes(`data-glyph-opacity="0.85"`), 'Dots remain visible in both themes');
    }
    if (!hydrated) {
      serverMarkup ??= html;
      assert.equal(html, serverMarkup, 'Server and first hydration render must match, even when client theme is dark');
    }
  }
}
console.log('PASS: server and first hydration markup match for unresolved, light and dark themes');
console.log('PASS: the same GPU layer mounts in both themes after hydration');
playerVisible = true;
assert.equal(renderToStaticMarkup(React.createElement(homeModule.exports.HomeGradientBackground)), '', 'Playback must unmount the entire gradient, including the fallback and dots');
playerVisible = false;
assert.ok(renderToStaticMarkup(React.createElement(homeModule.exports.HomeGradientBackground)).includes('home-gradient-background'), 'Closing playback must restore the gradient');
console.log('PASS: playback removes the gradient; closing playback restores it');
for (const theme of ['light', 'dark']) {
  resolvedTheme = theme;
  const normal = renderToStaticMarkup(React.createElement(homeModule.exports.HomeGradientBackground));
  const subdued = renderToStaticMarkup(React.createElement(homeModule.exports.HomeGradientBackground, { emerald: true }));
  const posterSubdued = renderToStaticMarkup(React.createElement(homeModule.exports.HomeGradientBackground, { subdued: true }));
  for (const name of ['glyph', 'gradient']) {
    const read = html => Number(html.match(new RegExp(`data-${name}-opacity="([^"]+)"`))[1]);
    assert.ok(Math.abs(read(subdued) - read(normal) * 0.7) < 1e-9, `${theme}: utility pages reduce ${name} opacity by 30%`);
    assert.equal(read(posterSubdued), read(subdued), `${theme}: poster-colored backgrounds can match Settings intensity independently of the emerald palette`);
  }
}
console.log('PASS: subdued settings/addon shader opacity in both themes preserves the home defaults');

removeListeners();
assert.equal(listeners.size, 0, 'All context listeners are removed');
