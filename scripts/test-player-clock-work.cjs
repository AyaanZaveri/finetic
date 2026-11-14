const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript'), vm = require('node:vm');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const source = fs.readFileSync('components/global-media-player.tsx', 'utf8');
const ast = ts.createSourceFile('player.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleTimeUpdate') handler = node.initializer.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
}
visit(ast);
let rootUpdates = 0, published = 0;
const clock = { current: 0 };
const media = { currentTime: 0, duration: 90, paused: false, seeking: false };
const fn = vm.runInNewContext(ts.transpileModule(`(${handler})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    videoRef: { current: media },
    playbackStartRef: { current: null }, confirmWebPlaybackRef: { current: null }, currentTimeRef: clock,
    setCurrentTime() { rootUpdates++; }, setCurrentTimestamp(value) { published = value; }, maybeReportPeriodicProgress() {},
});
for (let i = 0; i < 500; i++) { media.currentTime = i / 10; fn(); }
assert.equal(rootUpdates, 0, 'Clock events must not schedule whole-player state updates');
assert.equal(published, 49.9);
assert.equal(clock.current, 49.9);
const { createSubtitleCueIndex } = load('lib/media/subtitle-cue-index.ts');
let processed = 0;
const cues = Array.from({ length: 10000 }, (_, index) => ({ timestamp: index * 2, endTimestamp: index * 2 + 1, text: `Cue ${index}` }));
const lookup = createSubtitleCueIndex(cues, text => { processed++; return { text, positionTop: false }; });
const selected = lookup(10000.2);
assert.equal(selected.text, 'Cue 5000');
for (let i = 0; i < 1000; i++) assert.equal(lookup(10000.2), selected, 'Repeated snapshots retain identity');
assert.equal(processed, cues.length, 'Process each caption once, not per clock event');
assert.equal(lookup(10001.1), null); assert.equal(lookup(10).text, 'Cue 5');
assert.equal(lookup(-1), null); assert.equal(lookup(NaN), null);
const overlap = createSubtitleCueIndex([{ timestamp: 1, endTimestamp: 8, text: 'First' }, { timestamp: 2, endTimestamp: 3, text: 'Latest' }], text => ({ text }));
assert.equal(overlap(3).text, 'Latest'); assert.equal(overlap(4), null, 'Preserve last-started-cue behavior after an overlap ends');

// Exercise the actual caption subscriber/getSnapshot boundary without a browser.
const host = hooks(), listeners = new Map();
let store;
const node = { currentTime: 10, controller: { subtitleText: 'Embedded' }, addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) };
const { PlayerSubtitleLayer } = load('components/player-clock-islands.tsx', {
    react: { ...host.react, useSyncExternalStore(subscribe, snapshot) { store = { subscribe, snapshot }; return snapshot(); } },
    'react/jsx-runtime': host.jsx, '@/contexts/MediaPlayerContext': { usePlaybackTimestamp: () => 0 },
    '@/components/subtitle-text': { SubtitleText: 'subtitle' }, '@/components/player-skip-segments': { PlayerSkipSegments: 'skip' },
});
const props = { mediaRef: { current: node }, lookup: createSubtitleCueIndex([{ timestamp: 10, endTimestamp: 12, text: 'Hello' }], text => ({ text, positionTop: false })), delay: 0, enabled: true, native: true, position: 10 };
const render = () => host.render(PlayerSubtitleLayer, props);
assert.equal(render().props.children.props.dangerouslySetInnerHTML.__html, 'Hello');
let changes = 0, previous = store.snapshot();
const unsubscribe = store.subscribe(() => { const next = store.snapshot(); if (!Object.is(next, previous)) changes++; previous = next; });
for (let i = 0; i < 500; i++) { node.currentTime = 10 + i / 1000; listeners.get('timeupdate')(); }
assert.equal(changes, 0, 'An unchanged caption does not publish a new snapshot');
props.delay = 2; assert.equal(render().props.children, 'Embedded', 'Paused offset changes recompute the cue immediately');
props.native = false; assert.equal(render(), null);
props.delay = -1; node.currentTime = 9; assert.equal(render().props.children.props.dangerouslySetInnerHTML.__html, 'Hello');
props.native = false; props.delay = .5; node.currentTime = 4;
node.webgpu = { subtitle: time => time >= 3 && time < 5 ? '<script>plain caption</script>' : null };
assert.equal(render().props.children, '<script>plain caption</script>', 'GPU embedded cues use the subtitle clock and render as safe React text');
props.delay = 2; assert.equal(render(), null, 'GPU caption timing changes recompute without moving playback');
props.enabled = false; assert.equal(render(), null);
unsubscribe(); assert.equal(listeners.size, 0);

console.log('PASS: 500 clock events without root updates, stable caption subscriptions, preprocessed long files, timing, gaps, backward seeks and overlap semantics');
