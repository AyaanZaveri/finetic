const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const { load, hooks } = require('./test-support/react-hooks.cjs');

const host = hooks();
let open = false;
let preloads = 0;
const { PlayerNavigatorButton } = load('components/player-navigator-button.tsx', {
  react: host.react, 'react/jsx-runtime': host.jsx,
  jotai: { useAtomValue: () => open },
  'lucide-react': { Ship: 'Ship' },
  '@/components/ui/button': { Button: 'Button' },
  '@/components/ui/media-player': { MediaPlayerTooltip: 'Tooltip' },
  '@/hooks/use-navigator-shortcut': { useNavigatorShortcut: () => ['Ctrl', 'K'] },
  '@/lib/atoms': { isAIAskOpenAtom: 'open' },
  '@/lib/preload-tools': { preloadNavigator: () => preloads++ },
});
function render() { return host.render(PlayerNavigatorButton, { onToggle: () => { open = !open; } }); }

// Execute the panel's actual outside-pointer handler before the trigger click.
// This is the ordering that previously closed and immediately reopened the panel.
const source = ts.createSourceFile('focus.tsx', fs.readFileSync('components/navigator/focus.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let dismiss;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'dismiss' && node.initializer?.getText(source).includes('focusPanelRef')) dismiss = node.initializer.getText(source);
  ts.forEachChild(node, visit);
}
visit(source); assert.ok(dismiss);
class Element {
  constructor(attributes = {}) { this.attributes = attributes; }
  hasAttribute(name) { return name in this.attributes; }
}
const panel = new Element();
const context = { exports: {}, Element, focusPanelRef: { current: panel }, onOpenChange: next => { open = next; } };
vm.runInNewContext(ts.transpileModule(`exports.dismiss = ${dismiss}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
for (const pointerType of ['mouse', 'touch', 'pen']) {
  for (let i = 0; i < 10; i++) {
    open = true;
    const button = render().props.children;
    const event = { button: 0, pointerType, composedPath: () => [new Element(), new Element(button.props)] };
    context.exports.dismiss(event);
    assert.equal(open, true, 'The toggle must not also trigger outside dismissal');
    button.props.onClick();
    assert.equal(open, false, 'A second press closes the panel without reopening');
    assert.equal(render().props.children.props['aria-expanded'], false);
    render().props.children.props.onClick();
    assert.equal(open, true, 'The same trigger can open the panel again');
    assert.equal(render().props.children.props['aria-expanded'], true);
  }
}
context.exports.dismiss({ button: 0, composedPath: () => [panel] });
assert.equal(open, true, 'Panel interactions stay open');
context.exports.dismiss({ button: 0, composedPath: () => [new Element()] });
assert.equal(open, false, 'Outside dismissal still works');
const button = render().props.children;
assert.equal(button.props.type, 'button');
assert.equal(button.props.variant, 'player-control', 'Use the same button as adjacent player controls');
assert.equal(button.props['aria-label'], 'Ask Navigator');
assert.equal(preloads, 0, 'Rendering the control alone does not preload');
button.props.onPointerEnter();
button.props.onFocus();
assert.equal(preloads, 2, 'Pointer and keyboard intent both preload Navigator');
assert.equal(open, false, 'Preloading must not toggle the panel');
assert.deepEqual(Array.from(render().props.shortcut), ['Ctrl', 'K']);

// Render the real shared tooltip function without mounting a player or browser.
const player = ts.createSourceFile('media-player.tsx', fs.readFileSync('components/ui/media-player.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const tooltip = player.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'MediaPlayerTooltip');
assert.ok(tooltip);
const tooltipContext = { exports: {}, Tooltip: 'Tooltip', TooltipTrigger: 'Trigger', TooltipContent: 'Content', Kbd: 'Kbd', KbdGroup: 'KbdGroup',
  useMediaPlayerContext: () => ({ tooltipDelayDuration: 300, tooltipSideOffset: 8, withoutTooltip: false }), require: () => host.jsx };
vm.runInNewContext(ts.transpileModule(`exports.render = ${tooltip.getText(player)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, tooltipContext);
for (const shortcut of [['⌘', 'K'], ['Ctrl', 'K'], 'Space']) {
  const tree = tooltipContext.exports.render({ tooltip: 'Navigator', shortcut, children: 'button' });
  const group = tree.props.children[1].props.children[1];
  assert.equal(group.type, 'KbdGroup');
  const keys = Array.isArray(shortcut) ? shortcut : [shortcut];
  assert.deepEqual(Array.from(group.props.children, node => node.props.children), keys);
  assert.ok(group.props.children.every(node => node.type === 'Kbd'), 'Every hint uses the shared shadcn Kbd');
}
console.log('PASS: square player Navigator control, pointerdown/click toggle ordering, outside dismissal, expanded state and shared shadcn keyboard hints');
