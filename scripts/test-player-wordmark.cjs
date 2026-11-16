const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load } = require('./test-support/react-hooks.cjs');
let failure = null;
const { PlayerLoadingWordmark } = load('components/player-loading-wordmark.tsx', {
  react: { useState: () => [failure, value => { failure = value; }] },
  './player-loading-wordmark.module.css': {},
  '@/lib/artwork': load('lib/artwork.ts', {}, { URLSearchParams }),
});
const src = 'https://image.tmdb.org/t/p/original/logo.svg';
const render = (source = src, loading = true) => PlayerLoadingWordmark({ src: source, alt: 'Modern Family logo', loading });
const children = tree => tree.props.children.props.children;
let tree = render();
assert.equal(children(tree)[0].props.src, src);
assert.equal(children(tree)[0].props.fetchPriority, 'high');
assert.ok(children(tree)[1].props.style.maskImage.includes('wsrv.nl'));
children(tree)[0].props.onError();
tree = render();
assert.ok(children(tree)[0].props.src.includes('wsrv.nl'), 'A failed CDN redirect retries through the external image service');
children(tree)[0].props.onError();
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
console.log('PASS: definite SVG display size, high-priority image reuse, external image retry, nonempty failure fallback, and source changes.');
