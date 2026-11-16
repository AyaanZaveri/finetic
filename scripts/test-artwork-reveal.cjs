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
console.log('PASS: pre-layout cache reveal, macOS opacity endpoint, pending opacity, and cached wordmark animation');
