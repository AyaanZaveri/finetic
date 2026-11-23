const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Minimal ancestor matching for the bridge's tag and attribute selectors.
function element(tag, attributes = {}, parent = null) {
  return { parent, closest(selectors) {
    for (let node = this; node; node = node.parent) {
      if (selectors.split(',').some(selector => {
        selector = selector.trim();
        const attr = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
        return attr ? Object.hasOwn(node.attributes, attr[1]) && (attr[2] === undefined || node.attributes[attr[1]] === attr[2]) : node.tag === selector;
      })) return node;
    }
    return null;
  }, tag, attributes };
}

const source = fs.readFileSync('desktop/src/bridge.js', 'utf8');
for (const platform of ['windows', 'macos']) {
  const sent = [], handlers = new Map(), attributes = new Map(), events = [];
  const window = { ipc: { postMessage: message => sent.push(JSON.parse(message)) }, addEventListener() {} };
  window.top = window;
  const document = {
    documentElement: { dataset: {}, style: { setProperty() {} }, setAttribute: (name, value) => attributes.set(name, value) },
    addEventListener: (type, callback) => handlers.set(type, callback),
    dispatchEvent: event => events.push(event.type),
  };
  vm.runInNewContext(source.replace('__PROTOCOL__', '1').replace('__ORIGIN__', JSON.stringify('http://localhost:3000')).replace('__PLATFORM__', JSON.stringify(platform)),
    { window, document, location: { origin: 'http://localhost:3000' }, console, Event });
  window.__navigatorDesktopReceive({ type: 'open-settings' });
  assert.equal(attributes.get('data-desktop-settings-pending'), '');
  assert.equal(events.at(-1), 'navigatoropensettings');
  window.__navigatorDesktopReceive({ type: 'close-player' });
  assert.equal(events.at(-1), 'navigatorcloseplayer');
  window.__navigatorDesktopReceive({ type: 'window-active', value: false });
  assert.equal(document.documentElement.dataset.windowActive, 'false');
  const header = element('header', { 'data-window-drag-region': '' });
  const listbox = element('div', { role: 'listbox' }, header);
  const option = element('div', { role: 'option' }, listbox);
  const poster = element('img', {}, element('span', {}, option));
  function press(target, options = {}) {
    const event = { target, isTrusted: true, button: 0, clientY: 140, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...options };
    handlers.get('mousedown')(event);
    return event;
  }
  // Search rows prevent mousedown's focus change before it bubbles to document.
  press(poster, { defaultPrevented: true });
  assert.equal(sent.length, 0, `${platform}: clicking a search result must not start a native drag after the row preserves input focus`);
  for (const target of [option, poster, listbox]) {
    const event = press(target);
    assert.equal(sent.length, 0, `${platform}: search rows, artwork and listbox space must not drag`);
    assert.equal(event.defaultPrevented, false, 'The bridge must leave suggestion input alone');
  }
  for (const [tag, attributes] of [['button', {}], ['input', {}], ['a', {}], ['div', { role: 'menu' }], ['div', { 'data-no-window-drag': '' }]]) {
    press(element('span', {}, element(tag, attributes, header)));
  }
  press(element('canvas', {}, header), { defaultPrevented: true });
  press(header, { isTrusted: false });
  press(header, { button: 2 });
  press(element('main'), { clientY: 100 });
  assert.equal(sent.length, 0, `${platform}: controls and consumed, synthetic or non-header input must not drag`);
  assert.equal(press(header).defaultPrevented, true);
  assert.equal(sent.at(-1).type, 'window-drag', 'Blank header space must still drag');
  press(element('div'), { clientY: 10 });
  assert.equal(sent.length, 2, 'Blank top-edge space must still drag');
  press(element('main', { 'data-page-scroll': '' }), { clientY: 10 });
  assert.equal(sent.length, 2, 'Content scrolling behind the navbar does not become a drag region');
  assert.equal(press(header, { detail: 2 }).defaultPrevented, true);
  assert.deepEqual(sent.at(-1), { type: 'window-drag', doubleClick: true },
    'A double-click on blank header space must use the native titlebar action');
  press(header, { detail: 3 });
  press(element('button', {}, header), { detail: 2 });
  press(poster, { detail: 2 });
  if (platform === 'macos') press(header, { detail: 2, ctrlKey: true });
  assert.equal(sent.length, 3, 'Triple clicks, controls and macOS context clicks must not trigger a titlebar action');
  window.__navigatorDesktopReceive({ type: 'fullscreen', value: true });
  press(header);
  press(header, { detail: 2 });
  assert.equal(sent.length, 3, 'Fullscreen must disable window gestures');
  console.log(`PASS: ${platform} search suggestions, interactive controls, native drag and double-click guards`);
}
