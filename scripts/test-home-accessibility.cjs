const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const h = hooks();
let artwork = {};
const { MediaCard } = load('components/media-card.tsx', {
  react: h.react, 'react/jsx-runtime': h.jsx,
  '@/components/metadata-preload': { useMetadataIntent: () => ({ start() {}, cancel() {} }) },
  '@/components/artwork-image': { ArtworkImage: 'img', ArtworkPlaceholder: 'placeholder' },
  '@/lib/preload-tools': { preloadPlayer() {} },
  '@/components/home-palette-provider': { useHomePaletteScene: () => null },
  '@/lib/artwork': { mediaArtwork: () => artwork, backdropVariantUrl: value => value },
  '@/components/intent-link': { IntentLink: 'a' },
  '@/contexts/MediaPlayerContext': { usePlaybackActions: () => ({}) },
  '@/components/media-card-menu': { MediaCardMenu: ({ children }) => children },
  '@/components/watched-indicator': { WatchedIndicator: 'watched' },
  '@/components/continue-watching-warmup': { useContinueWatchingWarmup: () => null },
  './media-card.module.css': {},
});
const nodes = node => !node || typeof node !== 'object' ? [] : [node,
  ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const render = (item, continueWatching = false) => nodes(h.render(MediaCard, { item, continueWatching }));
const movie = { id: 'tt123', type: 'movie', name: 'A full title that must remain readable' };
let tree = render(movie);
assert.ok(tree.some(node => node.type === 'placeholder'));
assert.equal(tree.filter(node => node.type === 'a').length, 1, 'Poster and title share one navigation link');
const cardLink = tree.find(node => node.type === 'a');
assert.equal(nodes(cardLink).some(node => node.type === 'button'), false, 'Play is a sibling, never a button nested in a link');
const tabStops = tree.filter(node => node.type === 'a' || node.type === 'button');
assert.deepEqual(tabStops.map(node => node.type), ['a', 'button'], 'Tab order is the full card, then Play');
assert.equal(tree.find(node => node.type === 'a').props['aria-label'], `View details for ${movie.name}`,
  'An artwork failure cannot leave an unnamed navigation link');
assert.equal(tree.find(node => node.type === 'button').props['aria-label'], `Play ${movie.name}`);
artwork = { background: '/background.jpg', poster: '/poster.jpg', logo: '/logo.png' };
tree = render({ ...movie, progressPercent: 37, progressLabel: '12 minutes left' }, true);
const progress = tree.find(node => node.props.role === 'progressbar');
assert.equal(progress.props['aria-valuenow'], 37);
assert.equal(progress.props['aria-valuetext'], '12 minutes left');
assert.equal(progress.props['aria-label'], `${movie.name} playback progress`);
assert.ok(tree.filter(node => node.type === 'img').every(node => node.props.alt === ''),
  'Decorative artwork and wordmarks do not repeat the title to screen readers');
assert.equal(render({ ...movie, progressPercent: 120 }, true).find(node => node.props.role === 'progressbar').props['aria-valuenow'], 100);
assert.equal(render({ ...movie, progressPercent: NaN }, true).some(node => node.props.role === 'progressbar'), false);
console.log('PASS: named media navigation without artwork, named playback, decorative images, and valid announced resume progress');
