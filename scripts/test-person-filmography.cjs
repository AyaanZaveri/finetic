const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const model = load('lib/person-filmography.ts');
const items = Array.from({ length: 125 }, (_, index) => ({
    id: `tmdb:${index + 1}`, type: index % 2 ? 'movie' : 'series', name: `Title ${index}`,
    releaseInfo: `${1900 + index}-01-01`, popularity: 125 - index,
    roles: ['Acting'], characters: [`Character ${index}`],
}));
const originalOrder = items.map(model.creditIdentity);
let result = model.personCreditWindow(items, 'all', 'newest', { 'all:newest': 40 });
assert.equal(result.shown.size, 40);
assert.equal(result.total, 125);
assert.equal(result.hasMore, true);
assert.equal(result.pool.get(result.ordered[0]), items[124], 'Cards keep the original data object');
result = model.personCreditWindow(items, 'all', 'newest', { 'all:newest': 80 });
assert.equal(result.shown.size, 80);
assert.equal(result.ordered.length, new Set(result.ordered).size);
result = model.personCreditWindow(items, 'movie', 'popular', { 'all:newest': 80, 'movie:popular': 40 });
assert.equal(result.shown.size, 40);
assert.equal(result.total, 62);
assert.equal(result.ordered[0], 'movie:tmdb:2', 'Popularity sorts independently of release date');
assert.ok(result.pool.has('series:tmdb:125'), 'Previously mounted cards remain in the pool while hidden');
result = model.personCreditWindow(items, 'all', 'newest', { 'all:newest': 160 });
assert.equal(result.shown.size, 125);
assert.equal(result.hasMore, false);
assert.deepEqual(items.map(model.creditIdentity), originalOrder, 'Sorting never mutates the source');
assert.equal(model.personCreditWindow([], 'all', 'newest', {}).hasMore, false);

const h = hooks();
const css = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : key });
let query = new URLSearchParams(), pushes = [], observers = [];
const root = {};
class Observer {
    constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
}
const { PersonFilmography } = load('components/person-filmography.tsx', {
    react: h.react, 'react/jsx-runtime': h.jsx,
    'next/navigation': { useSearchParams: () => query },
    '@/components/arc/segmented-control/segmented-control': 'segments',
    '@/components/media-card': { MediaCard: 'media-card' }, '@/components/ui/button': { Button: 'button' },
    '@/lib/person-filmography': model, './person-page.module.css': css,
}, { URLSearchParams, IntersectionObserver: Observer, window: { history: { pushState: (_, __, url) => { pushes.push(url); query = new URLSearchParams(url.split('?')[1]); } } } });
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
function render() {
    const tree = h.render(PersonFilmography, { id: 7, items });
    const sentinel = nodes(tree).find(node => node.props?.ref);
    if (sentinel) sentinel.props.ref.current = { closest: () => root };
    h.flush();
    return tree;
}
let tree = render();
assert.equal(observers[0].options.root, root, 'Automatic loading uses the app scrollport');
observers[0].callback([{ isIntersecting: true }]);
tree = render();
assert.equal(nodes(tree).filter(node => node.type === 'li' && !node.props.hidden).length, 80);
nodes(tree).find(node => node.props?.label === 'Filmography type').props.onValueChange('movie');
tree = render();
assert.equal(pushes.at(-1), '/person/7?type=movie', 'Filters update history without a server route navigation');
assert.equal(nodes(tree).filter(node => node.type === 'li' && !node.props.hidden).length, 40);
assert.ok(nodes(tree).some(node => node.type === 'li' && node.props.hidden));
const cards = nodes(tree).filter(node => node.type === 'media-card');
assert.ok(cards.every(node => !node.props.creditContent), 'Filmography cards omit character and crew-role lists');
nodes(tree).find(node => node.props?.label === 'Sort filmography').props.onValueChange('popular');
tree = render();
assert.equal(pushes.at(-1), '/person/7?type=movie&sort=popular');
query = new URLSearchParams();
tree = render();
assert.equal(nodes(tree).filter(node => node.type === 'li' && !node.props.hidden).length, 80, 'Back navigation restores the revealed count');
h.unmount();
console.log('PASS: person filters, local sorting, stable card pool, scrollport loading, history restoration, uncluttered cards, and full filmography reachability');

const segmentHooks = hooks();
let selected = 'all';
const segment = load('components/arc/segmented-control/segmented-control.tsx', {
    react: { ...segmentHooks.react, useId: () => 'filmography-segments' }, 'react/jsx-runtime': segmentHooks.jsx,
    'motion/react': { motion: { span: 'highlight' }, useReducedMotion: () => false }, './segmented-control.module.css': css,
}, { CSS: { escape: value => value }, ResizeObserver: Observer }).default;
const buttons = { all: { offsetLeft: 3, offsetWidth: 65 }, movie: { offsetLeft: 70, offsetWidth: 90 } };
const track = {
    querySelector: () => buttons[selected], querySelectorAll: () => Object.values(buttons),
    scrollWidth: 200, clientWidth: 200, scrollLeft: 0,
    addEventListener() {}, removeEventListener() {}, toggleAttribute() {},
};
function renderSegment() {
    const tree = segmentHooks.render(segment, { value: selected, options: [{ value: 'all', label: 'All' }, { value: 'movie', label: 'Movies' }], onValueChange: value => { selected = value; } });
    nodes(tree).find(node => node.props?.ref).props.ref.current = track;
    segmentHooks.flush();
    return tree;
}
renderSegment();
let highlight = nodes(renderSegment()).find(node => node.type === 'highlight');
assert.equal(highlight.props.animate.x, 3);
// A parent may be scrolled arbitrarily; highlight coordinates remain track-local.
track.scrollTop = 1800;
selected = 'movie';
renderSegment();
highlight = nodes(renderSegment()).find(node => node.type === 'highlight');
assert.equal(highlight.props.animate.x, 70);
assert.equal(highlight.props.animate.width, 90);
assert.equal(highlight.props.animate.y, undefined, 'The highlight has no vertical animation channel');
segmentHooks.unmount();
console.log('PASS: segmented highlights use local horizontal offsets independent of page scrolling');
