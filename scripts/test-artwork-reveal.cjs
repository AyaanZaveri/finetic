const assert = require('node:assert/strict');
const fs = require('node:fs');
const postcss = require('postcss');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const h = hooks();
const { ArtworkImage } = load('components/artwork-image.tsx', {
  react: h.react, 'react/jsx-runtime': h.jsx,
  '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
  './artwork-image.module.css': { image: 'image', pending: 'pending', reveal: 'reveal' },
}, { window: { innerWidth: 1200, innerHeight: 800 } });
const props = { src: '/cached.jpg' };
let image = h.render(ArtworkImage, props);
image.props.ref({ complete: true, naturalWidth: 500,
  getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) });
image = h.render(ArtworkImage, props);
assert.match(image.props.className, /reveal/, 'A cache hit before layout must still reveal on first paint');
// Snapshot metadata can be cached while the actual image still needs a download.
const lateProps = { src: '/snapshot.jpg', reveal: 'late' };
image = h.render(ArtworkImage, lateProps);
image.props.ref({ complete: false, naturalWidth: 0 });
image.props.onLoad({ currentTarget: { getBoundingClientRect: () => ({ top: 20, bottom: 220, left: 20, right: 160 }) } });
image = h.render(ArtworkImage, lateProps);
assert.match(image.props.className, /reveal/, 'A late image must fade even when its card came from cached metadata');
assert.equal(image.props['data-artwork-revealing'], '', 'Wordmarks can follow the artwork reveal');
image.props.ref({ complete: true, naturalWidth: 500 });
image = h.render(ArtworkImage, lateProps);
assert.match(image.props.className, /reveal/, 'A repeated ref attachment must not interrupt a late reveal');
const warmProps = { src: '/warm.jpg', reveal: 'late' };
image = h.render(ArtworkImage, warmProps);
image.props.ref({ complete: true, naturalWidth: 500 });
image.props.onLoad({ currentTarget: {} });
image = h.render(ArtworkImage, warmProps);
assert.doesNotMatch(image.props.className, /reveal/, 'Already loaded images do not replay a fade');
assert.equal(image.props['data-artwork-revealing'], undefined);
const reattachedProps = { src: '/reattached.jpg', reveal: 'late' };
image = h.render(ArtworkImage, reattachedProps);
image.props.ref({ complete: false, naturalWidth: 0 });
image.props.ref({ complete: true, naturalWidth: 500 });
image = h.render(ArtworkImage, reattachedProps);
assert.match(image.props.className, /reveal/, 'Pixels that complete between ref attachments are still late');
const offscreenProps = { src: '/offscreen.jpg', reveal: 'late' };
image = h.render(ArtworkImage, offscreenProps);
image.props.onLoad({ currentTarget: { getBoundingClientRect: () => ({ top: 850, bottom: 1000, left: 20, right: 160 }) } });
image = h.render(ArtworkImage, offscreenProps);
assert.doesNotMatch(image.props.className, /reveal/, 'An image that finishes outside the viewport stays ready without extra motion');
const artwork = postcss.parse(fs.readFileSync('components/artwork-image.module.css', 'utf8'));
let endpoint;
artwork.walkAtRules('keyframes', rule => { if (rule.params === 'artwork-reveal') endpoint = rule.nodes.find(node => node.selector === 'to').nodes.find(node => node.prop === 'opacity').value; });
assert.equal(endpoint, 'var(--artwork-opacity, 1)', 'The reveal must finish at the macOS dimmed opacity, without a bright frame');
const card = postcss.parse(fs.readFileSync('components/media-card.module.css', 'utf8'));
let mac;
card.walkRules(rule => { if (rule.selector === ':global(html[data-native-platform="macos"]) .card[data-continue-watching] .artwork') mac = rule; });
assert.equal(mac.nodes.find(node => node.prop === '--artwork-opacity')?.value, '0.65');
assert.equal(mac.nodes.find(node => node.prop === 'opacity'), undefined, 'No platform selector can override the shared pending opacity');
assert.ok(card.nodes.some(node => node.type === 'atrule' && node.name === 'keyframes' && node.params === 'wordmark-reveal'), 'Cached wordmarks need a first-paint animation');
assert.ok(card.nodes.some(node => node.type === 'rule' && node.selector.includes('[data-logo-late]') && node.selector.includes('[data-artwork-revealing]') &&
  node.nodes.some(declaration => declaration.prop === 'animation' && declaration.value.includes('wordmark-reveal'))),
  'Late wordmarks and late backdrops both trigger the existing fade');
console.log('PASS: pre-layout cache reveal, macOS opacity endpoint, pending opacity, and cached wordmark animation');
