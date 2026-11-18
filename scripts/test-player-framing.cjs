const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const postcss = require('postcss');
let bridge, cursor = 0, dirty = false;
const hooks = [], effects = [], sent = [], properties = new Map();
const media = { style: { setProperty: (name, value) => properties.set(name, value) }, controller: { previewSession: 'one' } };
const ref = { current: media };
const context = { exports: {}, require(name) {
  if (name === 'react') return {
    useState(initial) { const at = cursor++; hooks[at] ??= { value: initial }; return [hooks[at].value, value => { if (!Object.is(value, hooks[at].value)) { hooks[at].value = value; dirty = true; } }]; },
    useEffect(fn, deps) { const at = cursor++, old = hooks[at]; if (!old || deps.some((value, index) => !Object.is(value, old[index]))) { hooks[at] = deps; effects.push(fn); } },
  };
  if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  if (name.endsWith('/bridge')) return { desktopBridge: () => bridge };
  return new Proxy({}, { get: (_, key) => key });
} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/player-video-fit.tsx', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
function render() { let view; do { dirty = false; cursor = 0; view = context.exports.PlayerVideoFit({ mediaRef: ref, sourceKey: 'one' }); while (effects.length) effects.shift()(); } while (dirty); return view; }
const button = view => view.props.children;
let view = render();
assert.equal(view.props.shortcut, 'A');
assert.equal(button(view).props['aria-keyshortcuts'], 'A');
for (const [id, fit] of [['fit', 'contain'], ['crop', 'cover'], ['stretch', 'fill'], ['fit', 'contain']]) {
  assert.equal(button(view).props['data-player-video-fit'], id); assert.equal(media.style.objectFit, fit); assert.equal(properties.get('--media-object-fit'), fit);
  button(view).props.onClick(); view = render();
}
bridge = { platform: 'android', capabilities: { videoFit: true }, send: message => sent.push(message) };
view = render();
for (let i = 0; i < 3; i++) { button(view).props.onClick(); view = render(); }
assert.deepEqual(sent.slice(-3).map(message => message.mode), ['stretch', 'fit', 'crop']);
assert.ok(sent.every(message => message.type === 'video-fit' && message.session === 'one'));
bridge = { platform: 'android', send: () => { throw new Error('Old APK cannot handle video-fit'); } };
assert.equal(render(), null, 'Hide unsupported native controls instead of pretending to change framing');
const css = postcss.parse(fs.readFileSync('components/player-mobile.css', 'utf8'));
let volume;
css.walkRules(rule => { if (rule.selector.includes('html[data-native-engine="exoplayer"]') && rule.selector.includes('media-player-volume-container')) volume = rule; });
assert.equal(volume.nodes.find(node => node.prop === 'display').value, 'none');
assert.ok(!volume.selector.includes(','), 'The volume removal is scoped to Android');
for (const file of ['components/season-episodes.tsx', 'components/episode-card.tsx']) {
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /artwork \+ " absolute inset-0 block w-full h-full object-contain"/, 'Episode stills have explicit bounds and retain their full contents');
}
assert.match(fs.readFileSync('components/desktop/tracks.tsx', 'utf8'), /className="text-white hover:text-white/);
console.log('PASS: browser and native framing cycle, session routing, old-client fallback, Android-only volume removal, white track buttons and bounded episode artwork');
