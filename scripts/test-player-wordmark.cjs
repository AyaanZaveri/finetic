const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const host = hooks();
const { PlayerLoadingWordmark } = load('components/player-loading-wordmark.tsx', {
  react: host.react, 'react/jsx-runtime': host.jsx,
  '@/components/artwork-image': { ArtworkImage: 'artwork-image' },
  './player-loading-wordmark.module.css': {},
  '@/lib/artwork': load('lib/artwork.ts', {}, { URLSearchParams }),
});
const src = 'https://image.tmdb.org/t/p/original/logo.svg';
const render = (source = src, loading = true) => host.render(PlayerLoadingWordmark, { src: source, alt: 'Modern Family logo', loading });
const children = tree => tree.props.children.props.children;
let tree = render();
assert.equal(children(tree)[0].props.src, src);
assert.equal(children(tree)[0].props.fetchPriority, 'high');
assert.equal(children(tree)[0].props.waitForDecode, true, 'Reveal the actual decoded logo instead of relying on the loading container animation');
assert.equal(children(tree)[0].props.crossOrigin, 'anonymous', 'Share CSS mask request mode');
assert.equal(children(tree)[1], false, 'Keep the mask off the network while the logo decodes');
children(tree)[0].props.onReady();
tree = render();
assert.equal(children(tree)[1].props.style.maskImage, `url("${src}")`, 'The mask uses the same image URL as the displayed logo');
children(tree)[0].props.onUnavailable();
tree = render();
assert.ok(children(tree)[0].props.src.includes('wsrv.nl'), 'A failed CDN redirect retries through the external image service');
assert.equal(children(tree)[1], false, 'Wait for the fallback image before attaching the mask');
children(tree)[0].props.onUnavailable();
tree = render();
assert.equal(tree.props['data-state'], 'failed');
assert.equal(children(tree)[0].props.children, 'Modern Family', 'Image failures never silently remove the entire wordmark region');
assert.equal(children(tree)[1], false);
assert.equal(render('/other-logo.svg').props['data-state'], 'image', 'Failure is scoped to one artwork URL');
assert.equal(children(render('/other-logo.svg', false))[1], false);
const css = require('postcss').parse(fs.readFileSync('components/player-loading-wordmark.module.css', 'utf8'));
const value = (selector, prop) => css.nodes.find(node => node.selector === selector).nodes.find(node => node.prop === prop)?.value;
assert.equal(value('.logo', 'width'), 'min(66vw, 48rem)', 'ViewBox-only SVGs need a definite width inside their flex container');
assert.equal(value('.logo', 'height'), '18vh');
assert.equal(value('.image', 'width'), '100%');
assert.equal(value('.image', 'height'), '100%');
assert.equal(value('.image', 'object-fit'), 'contain');
assert.equal(value('.image[data-artwork-state]', 'background-color'), 'transparent', 'Do not give transparent wordmarks a rectangular image backing');
assert.equal(value('.mask', 'visibility'), 'hidden', 'Never show a shimmer before the actual logo has decoded');
assert.equal(value('.logo:has(.image[data-artwork-state="ready"]) .mask', 'visibility'), 'visible');
console.log('PASS: definite SVG display size, high-priority image reuse, external image retry, nonempty failure fallback, and source changes.');
