const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
let hovered = null, menu = null, focused = null;
class Element { closest() { return this.control; } matches() { return this.visibleFocus; } }
const root = {
  querySelector(selector) {
    assert.match(selector, /:is\(\[data-player-close\], \[data-slot="media-player-controls"\] :is\(button,.*\[data-slider\]\)\):hover$/);
    return ['button', 'slider', 'back'].includes(hovered) ? hovered : null;
  },
  contains: node => node.inPlayer,
};
const context = { exports: {}, Element, document: { get activeElement() { return focused; }, querySelector: () => menu } };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/media/control-activity.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, context);
const active = () => context.exports.playerControlsActive(root);
assert.equal(active(), false);
for (const control of ['button', 'slider', 'back']) {
  hovered = control;
  assert.equal(active(), true, 'Stationary mouse keeps timeline/buttons/Back visible');
}
for (const text of ['title', 'heading gap', 'ends at']) {
  hovered = text;
  assert.equal(active(), false, `Hovering ${text} leaves the idle timer running`);
}
hovered = null; assert.equal(active(), false, 'Leaving the controls releases the idle hold');
menu = {}; assert.equal(active(), true, 'Portalled menus stay interactive when the pointer leaves the player'); menu = null;
focused = new Element(); Object.assign(focused, { inPlayer: true, control: true, visibleFocus: true });
assert.equal(active(), true, 'Keyboard-focused controls stay visible'); focused.visibleFocus = false; assert.equal(active(), false);
const source = fs.readFileSync('components/ui/media-player.tsx', 'utf8');
assert.match(source, /const busy = [\s\S]*?playerControlsActive\(root\)/, 'The real idle timeout consults control hover state');
assert.match(source, /!dragging && !playerControlsActive\(rootRef.current\)/, 'Leaving the player must preserve portalled control activity');
// Execute the real timer callback from the component with a stationary pointer.
const parsed = ts.createSourceFile('player.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback, click;
function walk(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'onControlsShow') callback = node.initializer.arguments[0].getText(parsed);
  if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'onPlayerClick') click = node.initializer.getText(parsed);
  ts.forEachChild(node, walk);
}
walk(parsed); assert.ok(callback);
let now = 0, id = 0;
const timers = new Map(), state = { controlsVisible: true, seekPreviewTime: null };
Object.assign(context, { playerControlsActive: context.exports.playerControlsActive, rootRef: { current: root },
  hideControlsTimeoutRef: { current: null }, controlPointerHeldRef: { current: false },
  autoHide: true, mediaPaused: false, menuOpen: false, dragging: false,
  store: { setState: (key, value) => state[key] = value, getState: () => state },
  setTimeout: (fn, delay) => { timers.set(++id, { fn, at: now + delay }); return id; }, clearTimeout: id => timers.delete(id),
});
vm.runInNewContext(ts.transpileModule(`exports.show = ${callback}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
const advance = ms => { now += ms; for (const [key, timer] of [...timers]) if (timer.at <= now) { timers.delete(key); timer.fn(); } };
focused = null; hovered = 'slider'; context.exports.show();
for (let second = 0; second < 20; second++) { advance(1000); assert.equal(state.controlsVisible, true); }
hovered = 'heading gap'; advance(1000); assert.equal(state.controlsVisible, false, 'The actual timer hides with the pointer over the title row gap');
context.controlPointerHeldRef.current = true; context.exports.show(); advance(3000); assert.equal(state.controlsVisible, true);
context.controlPointerHeldRef.current = false; advance(1000); assert.equal(state.controlsVisible, false);
console.log('PASS: stationary timeline/button/Back hover, portalled menus, keyboard focus and release after leaving controls');

const actions = [], media = { paused: true };
Object.assign(context, {
  rootImplProps: {}, disabled: false, pointerTypeRef: { current: 'mouse' }, mediaRef: { current: media },
  dispatch: action => actions.push(action.type),
  MediaActionTypes: { MEDIA_PLAY_REQUEST: 'play', MEDIA_PAUSE_REQUEST: 'pause' },
});
assert.ok(click);
assert.match(source, /onClick=\{onPlayerClick\}/);
assert.match(fs.readFileSync('components/player-control-bar.tsx', 'utf8'), /<MediaPlayerControls[^>]*data-player-click-to-play/);
vm.runInNewContext(ts.transpileModule(`exports.click = ${click}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
function clickPlayer({ inControls = true, slot, detail = 1, defaultPrevented = false, inPlayer = true } = {}) {
  const target = new Element();
  target.inPlayer = inPlayer;
  target.closest = selector => (selector === '[data-player-click-to-play]' ? inControls : slot && selector.includes(slot)) ? target : null;
  context.exports.click({ target, currentTarget: root, button: 0, detail, defaultPrevented });
}
clickPlayer();
media.paused = false;
clickPlayer();
for (const slot of ['button', '[role="menu"]', '[data-slot="media-player-seek-container"]', '[data-slot="media-player-volume-container"]']) clickPlayer({ slot });
clickPlayer({ inControls: false });
clickPlayer({ inPlayer: false });
clickPlayer({ detail: 0 });
clickPlayer({ defaultPrevented: true });
context.pointerTypeRef.current = 'touch';
clickPlayer();
assert.deepEqual(actions, ['play', 'pause'], 'Passive mouse clicks toggle playback exactly once, while interactive controls and touch keep their own behavior');
