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
// Execute the real timer callback from the component with a stationary pointer.
const parsed = ts.createSourceFile('player.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = {};
const callbackNames = new Set(["onControlsShow", "hideControlsIfIdle", "onPlayerMouseExit", "onMouseLeave", "onMouseMove"]);
let listenForPointerExit;
function walk(node) {
  if (ts.isVariableDeclaration(node) && callbackNames.has(node.name.getText(parsed))) {
    callbacks[node.name.getText(parsed)] = node.initializer.arguments[0].getText(parsed);
  }
  if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'React.useEffect') {
    const effect = node.arguments[0].getText(parsed);
    if (effect.includes('viewport.addEventListener("mouseleave", onPlayerMouseExit)')) listenForPointerExit = effect;
  }
  ts.forEachChild(node, walk);
}
walk(parsed);
let now = 0, id = 0;
const timers = new Map(), state = { controlsVisible: true, seekPreviewTime: null, menuOpen: false, dragging: false };
Object.assign(context, { playerControlsActive: context.exports.playerControlsActive, rootRef: { current: root },
  hideControlsTimeoutRef: { current: null }, controlPointerIdRef: { current: null },
  mouseOutsidePlayerRef: { current: false }, pointerTypeRef: { current: "mouse" }, rootImplProps: {},
  autoHide: true, mediaPaused: false, menuOpen: false, dragging: false,
  store: { setState: (key, value) => state[key] = value, getState: () => state },
  setTimeout: (fn, delay) => { timers.set(++id, { fn, at: now + delay }); return id; }, clearTimeout: id => timers.delete(id),
});
function loadCallback(name, callback) {
  vm.runInNewContext(ts.transpileModule(`globalThis.${name} = ${callback}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
}
for (const [name, callback] of Object.entries(callbacks)) loadCallback(name, callback);
const advance = ms => { now += ms; for (const [key, timer] of [...timers]) if (timer.at <= now) { timers.delete(key); timer.fn(); } };
focused = null; hovered = 'slider'; context.onControlsShow();
for (let second = 0; second < 20; second++) { advance(1000); assert.equal(state.controlsVisible, true); }
hovered = 'heading gap'; advance(1000); assert.equal(state.controlsVisible, false, 'The actual timer hides with the pointer over the title row gap');
context.controlPointerIdRef.current = 1; context.onControlsShow(); advance(3000); assert.equal(state.controlsVisible, true);
context.controlPointerIdRef.current = null; advance(1000); assert.equal(state.controlsVisible, false);
// The WebView can still report hover while dispatching the player's leave event.
hovered = 'slider';
context.onMouseMove({ defaultPrevented: false });
context.onMouseLeave({ defaultPrevented: false });
assert.equal(state.controlsVisible, false, 'Leaving the player hides controls even with stale hover');
context.onMouseMove({ defaultPrevented: false });
advance(3000);
assert.equal(state.controlsVisible, true, 'Returning to a control restores its hover hold');

for (const hold of ['dragging', 'menuOpen', 'seekPreviewTime']) {
  context.onMouseMove({ defaultPrevented: false });
  state[hold] = hold === 'seekPreviewTime' ? 12 : true;
  context.onMouseLeave({ defaultPrevented: false });
  advance(3000);
  assert.equal(state.controlsVisible, true, `Leaving preserves an active ${hold}`);
  state[hold] = hold === 'seekPreviewTime' ? null : false;
  advance(1000);
  assert.equal(state.controlsVisible, false, `Controls hide when ${hold} clears after leaving`);
}

context.onMouseMove({ defaultPrevented: false });
context.mediaPaused = true;
context.onMouseLeave({ defaultPrevented: false });
assert.equal(state.controlsVisible, true, 'Paused playback keeps the controls visible on exit');
context.mediaPaused = false;

for (const hold of ['portalled menu', 'keyboard focus']) {
  context.onMouseMove({ defaultPrevented: false });
  menu = hold === 'portalled menu' ? {} : null;
  focused = hold === 'keyboard focus'
    ? Object.assign(new Element(), { inPlayer: true, control: true, visibleFocus: true })
    : null;
  context.onMouseLeave({ defaultPrevented: false });
  advance(3000);
  assert.equal(state.controlsVisible, true, `Leaving preserves ${hold}`);
  menu = focused = null;
  advance(1000);
  assert.equal(state.controlsVisible, false);
}

const documentEvents = new EventTarget();
const viewportEvents = new EventTarget();
context.document.addEventListener = documentEvents.addEventListener.bind(documentEvents);
context.document.removeEventListener = documentEvents.removeEventListener.bind(documentEvents);
context.document.documentElement = viewportEvents;
context.window = new EventTarget();
assert.ok(listenForPointerExit);
loadCallback('listenForPointerExit', listenForPointerExit);
const stopListening = context.listenForPointerExit();

context.onMouseMove({ defaultPrevented: false });
viewportEvents.dispatchEvent(new Event('mouseleave'));
assert.equal(state.controlsVisible, false, 'Leaving the viewport hides controls without a player mouseleave or window blur');

context.onMouseMove({ defaultPrevented: false });
context.controlPointerIdRef.current = 1;
viewportEvents.dispatchEvent(new Event('mouseleave'));
assert.equal(state.controlsVisible, true, 'Leaving the viewport preserves a held control');
documentEvents.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 2 }));
assert.equal(state.controlsVisible, true, 'An unrelated pointer cannot release a held control');
documentEvents.dispatchEvent(Object.assign(new Event('lostpointercapture'), { pointerId: 1 }));
assert.equal(state.controlsVisible, false, 'Losing capture outside the player releases the hold');

context.onMouseMove({ defaultPrevented: false });
context.controlPointerIdRef.current = 1;
context.window.dispatchEvent(new Event('blur'));
assert.equal(context.controlPointerIdRef.current, null);
assert.equal(state.controlsVisible, false, 'Window blur clears a missed release and stale hover');
stopListening();

assert.doesNotMatch(source, /onClick=\{onPlayerClick\}/, 'The player must not toggle playback from control-bar padding');
assert.doesNotMatch(fs.readFileSync('components/player-control-bar.tsx', 'utf8'), /data-player-click-to-play/);
console.log('PASS: hover, player and viewport exit, active controls, pointer release and passive control-bar clicks');
