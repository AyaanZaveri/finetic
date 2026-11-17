const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
class Element {
    constructor(button) { this.button = button; }
    closest(selector) {
        assert.equal(selector, 'button, [role="button"], [data-slot="button"]');
        return this.button ? {} : null;
    }
}
const listeners = new Map();
const document = {
    addEventListener(type, listener, capture) { assert.equal(capture, true); listeners.set(type, listener); },
    removeEventListener(type, listener, capture) { assert.equal(capture, true); assert.equal(listeners.get(type), listener); listeners.delete(type); },
};
const { installButtonDragPrevention } = load('lib/button-drag.ts', {}, { Element });
const cleanup = installButtonDragPrevention(document);
for (const button of [true, false]) {
    let prevented = false;
    listeners.get('dragstart')({ target: new Element(button), preventDefault() { prevented = true; } });
    assert.equal(prevented, button, 'Prevent button descendants from dragging without blocking ordinary content');
}
cleanup();
assert.equal(listeners.size, 0, 'Unmount removes the captured listener');

const h = hooks();
const { Button } = load('components/ui/button.tsx', {
    react: h.react, 'react/jsx-runtime': h.jsx, 'radix-ui': { Slot: { Root: 'slot' } },
    'lucide-react': { Loader2: 'loader' }, '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
});
for (const asChild of [false, true]) {
    let tree = h.render(Button, { asChild, draggable: true, variant: 'ghost', children: 'IMDb' });
    assert.equal(tree.props.draggable, false, 'Native and link-composed buttons enforce the app drag policy');
    tree.props.onPointerDown({ button: 0 });
    tree = h.render(Button, { asChild, variant: 'ghost', children: 'IMDb' });
    assert.equal(tree.props['data-pressed'], 'true');
    tree.props.onPointerLeave({});
    tree = h.render(Button, { asChild, variant: 'ghost', children: 'IMDb' });
    assert.equal(tree.props['data-pressed'], undefined);
}
h.unmount();
console.log('PASS: button drag prevention, ordinary-content exclusion, listener cleanup, native/link button policy, and ghost press feedback');
