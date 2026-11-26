const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load } = require('./test-support/react-hooks.cjs');
const { installInputModality } = load('lib/input-modality.ts');
const listeners = new Map();
const document = {
  documentElement: { dataset: {} },
  addEventListener(type, listener, capture) { assert.equal(capture, true); listeners.set(type, listener); },
  removeEventListener(type, listener, capture) { assert.equal(capture, true); assert.equal(listeners.get(type), listener); listeners.delete(type); },
};
const cleanup = installInputModality(document);
const mode = () => document.documentElement.dataset.inputModality;
assert.equal(mode(), undefined, 'Retain browser focus heuristics before any input');
listeners.get('keydown')({ key: 'Tab' });
assert.equal(mode(), 'keyboard');
listeners.get('pointermove')({ pointerType: 'mouse' });
assert.equal(mode(), 'pointer', 'Hover changes modality before menu focus handlers run');
listeners.get('keydown')({ key: 'Shift' });
assert.equal(mode(), 'pointer', 'A modifier alone does not enable keyboard rings');
listeners.get('keydown')({ key: 'ArrowDown' });
assert.equal(mode(), 'keyboard', 'Keyboard menu navigation immediately restores rings');
listeners.get('pointerdown')({ pointerType: 'touch' });
assert.equal(mode(), 'pointer');
listeners.get('keydown')({ key: 'Escape' });
assert.equal(mode(), 'keyboard', 'Focus restored on keyboard dismissal keeps its ring');
listeners.get('keydown')({ key: 'k', metaKey: true });
assert.equal(mode(), 'keyboard', 'Keyboard shortcuts also retain visible focus');
cleanup();
assert.equal(listeners.size, 0);
assert.equal(mode(), undefined);
const css = fs.readFileSync('app/globals.css', 'utf8');
assert.ok(css.includes('html[data-input-modality="pointer"] :focus-visible:not(:is(input, textarea, select, [contenteditable]:not([contenteditable="false"])))'), 'Pointer suppression must leave editable controls visible');
assert.ok(fs.readFileSync('app/layout.tsx', 'utf8').includes('<InputModality />'), 'Install once for web and both desktop WebViews');

const { TooltipTrigger } = load('components/ui/tooltip.tsx', {
  'radix-ui': { Tooltip: { Trigger: 'radix-trigger' } },
  '@/lib/utils': { cn: (...classes) => classes.join(' ') },
});
let focuses = 0;
let activations = 0;
const trigger = TooltipTrigger({ asChild: true, onFocus: () => focuses++, onClick: () => activations++ });
function dispatchTooltipEvent(handler, { modality, focusVisible = false, hover = false, pointerType = 'mouse' } = {}) {
  const event = {
    currentTarget: {
      ownerDocument: {
        documentElement: { dataset: { inputModality: modality } },
        defaultView: { matchMedia: () => ({ matches: hover }) },
      },
      matches: () => focusVisible,
    },
    pointerType,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
  trigger.props[handler]?.(event);
  // Radix ignores native touch moves and skips its default handler when prevented.
  return !event.defaultPrevented && !(handler === 'onPointerMove' && pointerType === 'touch');
}
assert.equal(dispatchTooltipEvent('onFocus', { modality: 'pointer', focusVisible: true }), false,
    'Focus delivered after a completed tap cannot briefly open a tooltip');
assert.equal(dispatchTooltipEvent('onPointerMove'), false, 'A compatibility mouse move on a touch-only device cannot open a tooltip');
assert.equal(dispatchTooltipEvent('onPointerMove', { hover: true, pointerType: 'touch' }), false);
assert.equal(dispatchTooltipEvent('onPointerMove', { hover: true }), true, 'Mouse hover still opens tooltips');
assert.equal(dispatchTooltipEvent('onFocus', { modality: 'keyboard', focusVisible: true }), true, 'Keyboard focus still opens tooltips');
assert.equal(dispatchTooltipEvent('onFocus', { focusVisible: true }), true, 'Browser focus heuristics work before the first tracked input');
assert.equal(focuses, 3, 'Keep the caller focus handler for both modalities');
trigger.props.onClick();
assert.equal(activations, 1, 'Touch suppression leaves the button activation alone');
console.log('PASS: captured input modality, root wiring and cleanup, touch-safe tooltips, real hover, and keyboard focus');
