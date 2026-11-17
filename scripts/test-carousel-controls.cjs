const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');
let resized, disconnected = false;
const listened = new Map(), windowListeners = new Map(), observed = [];
const { observeCarouselControls } = load('lib/media/carousel-controls.ts', {}, {
    ResizeObserver: class {
        constructor(callback) { resized = callback; }
        observe(node) { observed.push(node); }
        disconnect() { disconnected = true; }
    },
    window: { addEventListener: (event, callback) => windowListeners.set(event, callback), removeEventListener: event => windowListeners.delete(event) },
});
const viewport = { scrollWidth: 600, clientWidth: 800, scrollLeft: 0, firstElementChild: {},
    addEventListener: (event, callback) => listened.set(event, callback), removeEventListener: event => listened.delete(event) };
let position;
const cleanup = observeCarouselControls(viewport, value => { position = value; });
assert.equal(position.overflow, false, 'Rows that fit hide both controls');
assert.equal(observed.length, 2, 'Watch available width and card-track width');
viewport.clientWidth = 400; resized();
assert.equal(position.overflow, true, 'Narrowing the viewport shows controls');
assert.equal(position.start, true);
assert.equal(position.end, false);
viewport.scrollLeft = 200; listened.get('scroll')();
assert.equal(position.end, true);
assert.equal(position.start, false);
viewport.scrollWidth = 300; viewport.scrollLeft = 0; resized();
assert.equal(position.overflow, false, 'A shorter card row removes the controls');
cleanup();
assert.equal(disconnected, true); assert.equal(listened.size, 0); assert.equal(windowListeners.size, 0);
console.log('PASS: overflow-only carousel controls, responsive/track resizing, edge states, and observer/listener cleanup');
