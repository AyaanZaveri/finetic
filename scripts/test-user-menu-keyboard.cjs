const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const menuHooks = hooks(), segmentHooks = hooks();
const motion = { div: 'div', span: 'span', button: 'button' };
const motionMock = { motion, AnimatePresence: 'presence', LayoutGroup: 'group', useReducedMotion: () => true };
const css = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : key });
const document = { activeElement: null };
class Element {
  constructor(stop) { this.stop = stop || this; }
  closest() { return this.stop; }
  focus() { document.activeElement = this; }
}
const globals = { document, HTMLElement: Element, CSS: { escape: value => value },
  window: { matchMedia: () => ({ matches: false }) } };
const SegmentedControl = load('components/arc/segmented-control/segmented-control.tsx', {
  react: { ...segmentHooks.react, useId: () => 'segments' }, 'react/jsx-runtime': segmentHooks.jsx,
  'motion/react': motionMock, './segmented-control.module.css': css,
}, globals).default;
const { UserMenu } = load('components/arc/user-menu/user-menu.tsx', {
  react: { ...menuHooks.react, useId: () => 'account', useSyncExternalStore: (_, get) => get() },
  'react/jsx-runtime': menuHooks.jsx, 'motion/react': motionMock,
  '../segmented-control/segmented-control': SegmentedControl,
  '@/components/artwork-image': { ArtworkImage: 'artwork-image' },
  './user-menu.module.css': css,
}, globals);
const nodes = node => !node || typeof node !== 'object' ? [] : [node,
  ...[node.props?.children].flat(Infinity).flatMap(nodes)];
let theme = 'system', open = true;
const settings = new Element(), group = new Element(), signOut = new Element(), trigger = new Element();
const choices = Object.fromEntries(['light', 'dark', 'system'].map(value => [value, new Element(group)]));
group.dataset = { stop: 'group' };
settings.dataset = signOut.dataset = { stop: 'item' };
group.querySelector = selector => choices[selector === '[aria-pressed="true"]' ? theme : 'light'];
function render() {
  const tree = menuHooks.render(UserMenu, { user: { name: 'User', email: 'user@example.test' },
    open, portal: false, theme, onThemeChange: value => { theme = value; }, onOpenChange: value => { open = value; },
    items: [{ label: 'Settings' }] });
  const all = nodes(tree);
  all.find(node => node.props.className === 'list').props.ref.current = { querySelectorAll: () => [settings, group, signOut] };
  all.find(node => node.type === 'button' && node.props['aria-haspopup'] === 'menu').props.ref(trigger);
  const menu = all.find(node => node.props.role === 'menu');
  const segmentRow = all.find(node => node.props.label === 'Theme' && typeof node.type === 'function');
  const segment = nodes(segmentRow.type(segmentRow.props)).find(node => node.type === SegmentedControl);
  const segmentedTree = segmentHooks.render(SegmentedControl, segment.props);
  nodes(segmentedTree).find(node => node.props.ref).props.ref.current = {
    querySelector: selector => choices[selector.match(/data-value="(.*?)"/)[1]],
  };
  return { menu, button: nodes(segmentedTree).find(node => node.props['aria-pressed'] === true) };
}
function press(key) {
  const { menu, button } = render();
  const event = { key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  // The actual child handler runs before the event bubbles to the actual menu.
  button.props.onKeyDown(event);
  menu.props.onKeyDown(event);
}
choices.system.focus();
press('ArrowDown');
assert.equal(document.activeElement, signOut, 'Down leaves Theme for the next menu item');
assert.equal(theme, 'system', 'Vertical menu navigation must not change the theme');
choices.system.focus(); press('ArrowUp');
assert.equal(document.activeElement, settings, 'Up leaves Theme for the previous menu item');
choices.system.focus(); press('ArrowRight');
assert.equal(theme, 'light');
assert.equal(document.activeElement, choices.light, 'Right stays in the horizontal theme group');
press('ArrowLeft');
assert.equal(theme, 'system');
press('Home'); assert.equal(theme, 'light');
press('End'); assert.equal(theme, 'system');
press('Escape');
assert.equal(open, false);
assert.equal(document.activeElement, trigger, 'Escape closes the menu and restores the trigger');
console.log('PASS: real theme/menu event bubbling, vertical escape, horizontal selection, wrapping, Home/End, and Escape focus restoration');
