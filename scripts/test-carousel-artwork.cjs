const assert = require('node:assert/strict');
const fs = require('node:fs');
const React = require('react');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const h = hooks();
let warmed = 0, released = 0;
let reducedMotion = false;
const { MediaSection } = load('components/media-section.tsx', {
  react: { ...React, ...h.react }, 'react/jsx-runtime': h.jsx,
  '@/components/ui/card': { Card: 'Card', CardContent: 'CardContent' },
  '@/components/carousel-action': { CarouselAction: 'CarouselAction' },
  '@/components/media-card': { MediaCard: 'MediaCard' },
  './ui/scroll-area': { ScrollArea: 'ScrollArea', ScrollBar: 'ScrollBar' },
  './media-section.module.css': { viewport: 'viewport', track: 'track' },
  '@/lib/media/carousel-artwork': { warmCarouselArtwork() { warmed++; return () => { released++; }; } },
}, { window: { matchMedia: () => ({ matches: reducedMotion }), addEventListener() {}, removeEventListener() {} } });
const rowProps = {
  sectionName: 'Continue Watching', continueWatching: true,
  mediaItems: Array.from({ length: 20 }, (_, index) => ({ id: `tt${index}`, type: 'movie', name: `Title ${index}` })),
};
let row = h.render(MediaSection, rowProps);
function find(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...[].concat(node.props?.children ?? []).flatMap(child => find(child, predicate))];
}
assert.equal(find(row, node => node.props?.['data-media-row-viewport'] !== undefined).length, 1, 'Use one native clipped scroll viewport for the row');
const rowViewport = find(row, node => node.props?.['data-media-row-viewport'] !== undefined)[0];
assert.equal(rowViewport.props.tabIndex, -1, 'Tab moves directly to cards and controls instead of the whole carousel');
const movements = [];
rowViewport.props.ref.current = { scrollBy: value => movements.push(value), scrollWidth: 3000, clientWidth: 1000, scrollLeft: 0, addEventListener() {}, removeEventListener() {} };
h.flush();
row = h.render(MediaSection, rowProps);
find(row, node => node.type === 'CarouselAction').forEach(node => node.props.onClick());
assert.deepEqual(movements.map(value => value.left), [-300, 300], 'Both arrow actions address the actual native viewport');
assert.ok(movements.every(value => value.behavior === 'smooth'));
reducedMotion = true;
find(row, node => node.type === 'CarouselAction')[0].props.onClick();
assert.equal(movements.at(-1).behavior, 'instant', 'Reduced motion skips animated carousel scrolling');
assert.equal(find(row, node => node.type === 'CarouselAction')[0].props['aria-label'], 'Scroll Continue Watching left');
assert.equal(find(row, node => node.type === 'ul').length, 1, 'Cards have native list semantics');
assert.equal(find(row, node => node.type === 'li').length, 20);
assert.equal(warmed, 1);
h.unmount();
assert.equal(released, 1, 'Removing a row releases its artwork observers');
assert.equal(find(row, node => node.type === 'MediaCard').length, 20, 'All Continue Watching placeholders remain mounted');
const postcss = require('postcss');
const card = postcss.parse(fs.readFileSync('components/media-card.module.css', 'utf8'));
const frame = card.nodes.find(node => node.selector === '.frame');
assert.ok(frame.nodes.some(node => node.prop === 'contain' && node.value === 'paint'), 'Each card must own a paint boundary for its positioned progress and logo layers');
console.log('PASS: stable native carousel viewport, fully mounted cards and card paint boundaries.');

const frames = new Map();
let frameId = 0, visibility, disconnected = 0;
const listeners = new Map();
const promotions = [];
const pageScroll = {};
const viewport = {
  closest: () => pageScroll,
  scrollLeft: 0,
  getBoundingClientRect: () => ({ left: 0, right: 960, width: 960, height: 240 }),
  addEventListener: (name, fn) => listeners.set(name, fn),
  removeEventListener: name => listeners.delete(name),
};
const images = Array.from({ length: 20 }, (_, index) => {
  const events = new Map();
  let loading = 'lazy';
  return {
    complete: false, isConnected: true,
    src: `/art-${index}.jpg`, srcset: `/small-${index}.jpg 300w, /large-${index}.jpg 780w`, sizes: '320px',
    get loading() { return loading; },
    set loading(value) { loading = value; promotions.push(index); },
    getBoundingClientRect: () => ({ left: index * 336 - viewport.scrollLeft, right: index * 336 + 320 - viewport.scrollLeft }),
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: name => events.delete(name),
    finish(event = 'load') { this.complete = true; events.get(event)?.(); },
    events,
  };
});
viewport.querySelectorAll = () => images;
const { warmCarouselArtwork } = load('lib/media/carousel-artwork.ts', {}, {
  requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; },
  cancelAnimationFrame(id) { frames.delete(id); },
  IntersectionObserver: class {
    constructor(fn, options) {
      visibility = fn;
      assert.equal(options.root, pageScroll, 'Warm ahead inside the actual page scroller, not the window outside its clip');
      assert.equal(options.rootMargin, '480px 0px');
    }
    observe(element) { assert.equal(element, viewport); }
    disconnect() { disconnected++; }
  },
});
function tick() {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach(fn => fn());
}
const stop = warmCarouselArtwork(viewport);
tick();
assert.equal(promotions.length, 0, 'A distant row cannot launch speculative downloads');
visibility([{ isIntersecting: true }]);
tick();
assert.deepEqual(promotions, [0, 1, 2, 3], 'Warm no more than four existing responsive images concurrently');
assert.equal(images[3].fetchPriority, 'low', 'Ahead-of-screen artwork must not compete at visible priority');
assert.equal(images[3].srcset, '/small-3.jpg 300w, /large-3.jpg 780w', 'Retain native responsive candidates rather than downloading another URL');
viewport.scrollLeft = 336;
listeners.get('scroll')();
tick();
assert.equal(images[3].fetchPriority, 'auto', 'A speculative request gains normal priority when it becomes visible');
viewport.scrollLeft = 0;
for (let index = 0; index < 20; index++) listeners.get('scroll')();
assert.equal(frames.size, 1, 'A scroll burst schedules at most one geometry pass per frame');
tick();
assert.equal(promotions.length, 4, 'Repeated scroll events cannot duplicate or exceed the in-flight window');
images[0].finish();
tick();
assert.deepEqual(promotions, [0, 1, 2, 3, 4], 'A completion opens exactly one slot for the next nearby image');
viewport.scrollLeft = 5000;
listeners.get('scroll')();
tick();
images[1].finish('error');
tick();
assert.equal(promotions.at(-1), 14, 'After a long fling, select the destination instead of fetching every skipped card');
visibility([{ isIntersecting: false }]);
images[2].finish();
tick();
assert.equal(promotions.length, 6, 'Leaving the row stops further speculative promotions');
stop();
assert.equal(listeners.size, 0);
assert.equal(frames.size, 0);
assert.equal(disconnected, 1);
assert.ok(images.every(image => image.events.size === 0), 'Cleanup removes all active request listeners');
console.log('PASS: viewport-gated lookahead, four speculative promotions, responsive sources, scroll batching, destination priority, errors and cleanup.');
