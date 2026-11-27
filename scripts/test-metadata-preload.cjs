const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const listeners = new Map(), idle = new Map(), queued = [], allowed = [];
let sequence = 0, preference = true;
const document = { hidden: false, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
const navigator = { onLine: true, connection: { saveData: false, effectiveType: '4g', addEventListener() {}, removeEventListener() {} } };
const window = { innerWidth: 1000, innerHeight: 800, addEventListener() {}, removeEventListener() {},
    requestIdleCallback: callback => { idle.set(++sequence, callback); return sequence; }, cancelIdleCallback: id => idle.delete(id) };
const globals = { document, navigator, window, IntersectionObserver: class { observe() {} disconnect() {} } };
const dependencies = h => ({ react: h.react,
    './stream-query-provider': { useMetadataWarmup: () => ({ enqueue: (media, intent) => queued.push({ media, intent }), setAllowed: value => allowed.push(value) }) },
    '@/contexts/settings-context': { useSettings: () => ({ playbackPreferences: { metadataPrefetch: preference, continueWatchingPrefetch: false } }) },
    '@/contexts/account-context': { useAccountAccess: () => ({ authenticated: true }) },
});
const drainIdle = () => { const callbacks = [...idle.values()]; idle.clear(); callbacks.forEach(callback => callback()); };
const rowEvents = new Map();
let offset = 0;
const cards = Array.from({ length: 7 }, (_, index) => ({ dataset: { continueWatchingIndex: String(index) },
    getBoundingClientRect: () => ({ left: index * 160 - offset, right: index * 160 - offset + 150, top: 100, bottom: 300, width: 150, height: 200 }) }));
const viewport = { getBoundingClientRect: () => ({ left: 0, right: 1000, top: 0, bottom: 800 }),
    addEventListener: (name, fn) => rowEvents.set(name, fn), removeEventListener: name => rowEvents.delete(name) };
const root = { current: { querySelector: () => viewport, querySelectorAll: () => cards } };
const items = cards.map((_, index) => ({ id: 'show' + index, type: 'series', name: 'Show', mediaSourceId: `show${index}:1:3` }));
const h = hooks(), api = load('components/metadata-preload.tsx', dependencies(h), globals);
h.render(() => api.useContinueWatchingMetadata(root, items)); h.flush();
assert.equal(queued.length, 0, 'Automatic work waits for idle'); assert.equal(idle.size, 1);
drainIdle(); assert.deepEqual(queued.map(item => item.media.id), ['show0', 'show1', 'show2', 'show3'], 'Only four visible cards warm even when more are visible');
assert.ok(queued.length, 'Metadata starts while stream preloading is disabled, without inspecting image completion');
offset = 480; rowEvents.get('scroll')(); drainIdle(); assert.deepEqual(queued.slice(-4).map(item => item.media.id), ['show3', 'show4', 'show5', 'show6']);
const count = queued.length; document.hidden = true; listeners.get('visibilitychange')(); drainIdle(); assert.equal(queued.length, count);
h.unmount(); assert.equal(rowEvents.size, 0);

const policyHooks = hooks(), policy = load('components/metadata-preload.tsx', dependencies(policyHooks), globals);
policyHooks.render(policy.MetadataPreloadPolicy); policyHooks.flush(); assert.equal(allowed.at(-1), false);
document.hidden = false; listeners.get('visibilitychange')(); assert.equal(allowed.at(-1), true);
navigator.connection.saveData = true; listeners.get('visibilitychange')(); assert.equal(allowed.at(-1), false);
navigator.connection.saveData = false; preference = false;
policyHooks.render(policy.MetadataPreloadPolicy); policyHooks.flush(); assert.equal(allowed.at(-1), false); policyHooks.unmount();

const timers = new Map(), intentHooks = hooks(); preference = true;
const intent = load('components/metadata-preload.tsx', dependencies(intentHooks), { ...globals,
    setTimeout: (callback, delay) => { assert.equal(delay, 120); timers.set(++sequence, callback); return sequence; }, clearTimeout: id => timers.delete(id) });
const action = intentHooks.render(() => intent.useMetadataIntent(items[0])); intentHooks.flush();
action.start(); assert.equal(timers.size, 1); action.cancel(); assert.equal(timers.size, 0, 'Brief hover/focus never starts speculation');
action.start(); [...timers.values()][0](); assert.equal(queued.at(-1).intent, true); intentHooks.unmount();
const seasonHooks = hooks(), seasonRequests = [];
timers.clear();
const seasonApi = load('components/metadata-preload.tsx', {
    ...dependencies(seasonHooks),
    '@/lib/media/series-season': { warmSeriesSeason: (...args) => seasonRequests.push(args) },
}, { ...globals, setTimeout: (callback, delay) => { assert.equal(delay, 120); timers.set(++sequence, callback); return sequence; },
    clearTimeout: id => timers.delete(id) });
const highlight = seasonHooks.render(() => seasonApi.useSeasonMetadataIntent('tmdb:20', 1));
seasonHooks.flush();
highlight('1'); assert.equal(timers.size, 0);
highlight('2'); highlight('3'); assert.equal(timers.size, 1);
highlight(null); assert.equal(timers.size, 0);
highlight('3'); [...timers.values()][0]();
assert.deepEqual(seasonRequests, [['tmdb:20', 3]]);
seasonHooks.unmount();
console.log('Four visible cards, idle independence, scrolling, preference/visibility/save-data guards and 120ms intent cancellation passed');
