const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { load, hooks } = require('./test-support/react-hooks.cjs');

const host = hooks();
const timing = load('lib/media/subtitle-timing.ts', { react: host.react });
const movie = { type: 'movie', id: 'movie-1' };
const episode1 = { type: 'series', id: 'show', seasonNumber: 1, episodeNumber: 1 };
const episode2 = { ...episode1, episodeNumber: 2 };
const render = media => host.render(() => timing.useSubtitleTiming(media));
let state = render(movie);
assert.equal(state.seconds, 0);
state.onChange(1.2); state = render(movie);
assert.equal(state.seconds, 1.2);
state = render(episode1); assert.equal(state.seconds, 0);
state.onChange(-0.8); state = render(episode1); assert.equal(state.seconds, -0.8);
assert.equal(render(episode2).seconds, 0, 'Episodes must have separate offsets');
assert.equal(render({ ...movie, streamUrl: 'replacement-stream' }).seconds, 1.2, 'Changing source must preserve timing for the same video');
state = render(episode1); state.onChange(0); assert.equal(render(episode1).seconds, 0);
assert.equal(render(movie).seconds, 1.2, 'Reset only affects this video');
state = render(null); state.onChange(9); assert.equal(render(null).seconds, 0);
for (const [input, expected] of [[35,30],[-35,-30],[0.26,0.3],[NaN,0],[Infinity,0]]) {
 assert.equal(timing.normalizeSubtitleDelay(input), expected);
}
assert.equal(timing.subtitleDelayForMarks(.4, 10, 11.5), -1.1, 'Late captions need to move earlier from their current offset');
assert.equal(timing.subtitleDelayForMarks(-.4, 11.5, 10), 1.1, 'Early captions need to move later from their current offset');
assert.equal(timing.subtitleDelayForMarks(29, 13, 10), null, 'An out-of-range pair must not replace the existing offset');
assert.equal(timing.subtitleDelayForMarks(0, Infinity, 10), null);

// Exercise the actual player's cue selection with both signs and an unchanged
// playback time (adjusting the control while paused must update the cue).
const source = fs.readFileSync('components/global-media-player.tsx', 'utf8');
const { createSubtitleCueIndex } = load('lib/media/subtitle-cue-index.ts');
const find = createSubtitleCueIndex([{ timestamp: 10, endTimestamp: 12, text: 'Hello' }], text => ({ text, positionTop: false }));
assert.equal(find(timing.subtitleTime(10,1)), null, 'Positive offset waits longer');
assert.equal(find(timing.subtitleTime(11,1)).text, 'Hello');
assert.equal(find(timing.subtitleTime(9,-1)).text, 'Hello', 'Negative offset shows the cue earlier');
assert.equal(find(timing.subtitleTime(13,0)), null, 'Cue clears after its end');
assert.equal(find(timing.subtitleTime(9,0)), null);
assert.equal(find(timing.subtitleTime(9,-1)).text, 'Hello', 'Paused time can select a new cue after adjustment');
assert.match(source, /delay=\{subtitleTiming\.seconds\}/);


const panelHost = hooks();
const { SubtitleTimingPopover } = load('components/subtitle-timing-popover.tsx', {
 react: { ...panelHost.react, useId: () => 'timing-test-id' },
 'react/jsx-runtime': panelHost.jsx,
 '@/components/arc/popover/popover': { Popover: 'Popover', PopoverAnchor: 'PopoverAnchor', PopoverContent: 'PopoverContent', PopoverClose: 'PopoverClose' },
 '@/components/arc/ruler-slider/ruler-slider': { RulerSlider: 'RulerSlider' },
 '@/components/ui/button': { Button: 'Button' },
 '@/components/ui/kbd': { Kbd: 'Kbd' },
 '@/lib/media/subtitle-timing': timing,
 './subtitle-timing-popover.module.css': {},
 './arc/floating-surface.module.css': {},
});
function all(tree, type) {
 if (Array.isArray(tree)) return tree.flatMap(child => all(child, type));
 if (!tree || typeof tree !== 'object') return [];
 return [...(tree.type === type ? [tree] : []), ...all(tree.props?.children, type)];
}
let focused = false, prevented = false, changed, openChange;
const trigger = { isConnected: true, focus: () => { focused = true; } };
const container = { querySelector: selector => selector === '[data-slot="media-player-subtitles"]' ? trigger : null };
const renderPanel = (seconds, available = true, extra = {}) => panelHost.render(SubtitleTimingPopover, {
 open: true, onOpenChange: open => { openChange = open; }, seconds, onChange: value => { changed = value; }, available, container, ...extra,
});
let panel = renderPanel(1, false);
assert.equal(panel.props.modal, false, 'Timing must not block or dim the video');
assert.equal(all(panel,'PopoverContent')[0].props.container, container, 'Popover stays inside the fullscreen player');
assert.equal(all(panel,'PopoverContent')[0].props.side, 'bottom', 'Timing opens below the top edge of the player');
assert.equal(all(panel,'PopoverContent')[0].props.align, 'end', 'Timing aligns with the upper-right corner');
assert.equal(all(panel,'PopoverContent')[0].props.avoidCollisions, false, 'The timing panel cannot flip back into the subtitle area');
assert.equal(all(panel,'PopoverAnchor')[0].props['aria-hidden'], 'true', 'Positioning anchor is not interactive');
const css = fs.readFileSync('components/subtitle-timing-popover.module.css', 'utf8');
assert.match(css, /inset-block-start: max\(var\(--timing-top, 2rem\), env\(safe-area-inset-top\)\)/);
assert.match(css, /@media \(max-width: 27rem\)\s*\{\s*\.anchor \{ --timing-top: 4rem;/, 'A narrow panel clears the Back button');
assert.match(css, /width: min\(22rem, calc\(100vw - 2rem\)\)/, 'Narrow windows keep the panel inside the viewport');
assert.equal(all(panel,'RulerSlider')[0].props.disabled, true, 'Embedded tracks must not offer nonfunctional timing');
assert.equal(all(panel,'p')[0].props.className, 'sr-only', 'Keep technical status out of the visible layout');
assert.equal(all(panel,'RulerSlider')[0].props.hideLabel, true, 'Avoid repeating the heading above the ruler');
all(panel,'PopoverContent')[0].props.onCloseAutoFocus({ preventDefault() { prevented = true; } });
assert.ok(focused && prevented, 'Closing returns focus to the subtitles trigger');
let rulerFocused = false;
all(panel,'PopoverContent')[0].props.onOpenAutoFocus({ currentTarget: { querySelector: () => ({ focus: () => { rulerFocused = true; } }) }, preventDefault() {} });
assert.ok(rulerFocused, 'The ruler receives keyboard focus on open');
panel = renderPanel(.3);
const ruler = all(panel,'RulerSlider')[0];
assert.equal(ruler.props.step, .1);
assert.equal(ruler.props.largeStep, 1);
assert.equal(ruler.props.min, -30);
assert.equal(ruler.props.max, 30);
assert.equal(ruler.props.format(.3), '+0.3');
ruler.props.onValueChange(-.4); assert.equal(changed, -.4, 'Dragging updates the existing timing state immediately');
const panelButtons = tree => [...all(tree,'Button'), ...all(all(tree,'RulerSlider')[0].props.valueStart,'Button'), ...all(all(tree,'RulerSlider')[0].props.valueEnd,'Button')];
let buttons = panelButtons(panel);
buttons.find(node => node.props['aria-label']?.endsWith('earlier')).props.onClick();
assert.equal(changed, .2, 'Earlier nudges one tenth without floating-point drift');
buttons.find(node => node.props['aria-label']?.endsWith('later')).props.onClick();
assert.equal(changed, .4);
buttons.find(node => node.props.children === 'Reset').props.onClick();
assert.equal(changed, 0);
buttons.find(node => node.props.children === 'Done').props.onClick();
assert.equal(openChange, false, 'Done closes the panel without resetting timing again');
assert.ok(all(panel,'p').some(node => String(node.props.children).includes('0.3 seconds later')));
assert.ok(all(renderPanel(-.3),'p').some(node => String(node.props.children).includes('0.3 seconds earlier')));
for (const [seconds, direction] of [[-30,'earlier'],[30,'later']]) {
 const atLimit = panelButtons(renderPanel(seconds)).find(node => node.props['aria-label']?.endsWith(direction));
 assert.equal(atLimit.props.disabled, true);
}
assert.equal(all(renderPanel(0),'Button').find(node => node.props.children === 'Reset').props.disabled, true);
console.log('PASS: live ruler timing, precise nudges, limits, reset, embedded-track gating, fullscreen anchoring and focus return');

focused = false;
const closedOutside = all(panel,'PopoverContent')[0];
closedOutside.props.onInteractOutside({ target: {}, preventDefault() {} });
closedOutside.props.onCloseAutoFocus({ preventDefault() {} });
assert.equal(focused, false, 'Outside interaction must retain the user\'s new focus target');

assert.ok(Object.hasOwn(closedOutside.props, 'data-player-native-glass'), 'Timing participates in native menu glass');
console.log('PASS: outside dismissal keeps the new focus target');

const media = Object.assign(new EventTarget(), { currentTime: 3, paused: false, seeking: false });
const renderSync = (seconds = 0, extra = {}) => renderPanel(seconds, true, { mediaRef, ...extra });
const mediaRef = { current: media };
const mark = (tree, key) => all(tree, 'Button').find(node => node.props['aria-keyshortcuts'] === key);
const status = tree => all(tree, 'p').find(node => node.props.role === 'status')?.props.children;
renderSync();
panelHost.flush();
panel = renderSync();
assert.deepEqual(all(panel, 'Kbd').map(node => node.props.children), ['H', 'S']);
mark(panel, 'H').props.onClick();
panel = renderSync();
assert.equal(mark(panel, 'H').props['aria-pressed'], true);
assert.match(status(panel), /same subtitle/);
media.currentTime = 4.2;
mark(panel, 'S').props.onClick();
panel = renderSync(-1.2);
assert.equal(changed, -1.2, 'Heard then Saw moves late captions earlier');
assert.match(status(panel), /Timing updated/);

function press(tree, key, options = {}) {
 let prevented = false;
 all(tree, 'PopoverContent')[0].props.onKeyDown({
  key, nativeEvent: {}, preventDefault() { prevented = true; }, ...options,
 });
 return prevented;
}
media.currentTime = 9;
assert.equal(press(panel, 's', { repeat: true }), true);
assert.equal(mark(renderSync(-1.2), 'S').props['aria-pressed'], false, 'Holding a key must not set a mark');
assert.equal(press(panel, 's', { ctrlKey: true }), false);
assert.equal(press(panel, 's'), true);
panel = renderSync(-1.2);
assert.equal(mark(panel, 'S').props['aria-pressed'], true);
media.currentTime = 10.4;
press(panel, 'h');
assert.equal(changed, .2, 'Saw then Heard moves early captions later from the current offset');

panel = renderSync(.2);
press(panel, 'h');
media.dispatchEvent(new Event('seeking'));
assert.equal(mark(renderSync(.2), 'H').props['aria-pressed'], false, 'Seeking clears a pending mark');
media.paused = true;
press(renderSync(.2), 's');
assert.match(status(renderSync(.2)), /Play the video/);
assert.equal(changed, .2, 'A paused video must not apply a correction');
panelHost.unmount();
console.log('PASS: Heard and Saw in either order, live media clock, shortcuts, seek reset and pause guard');
