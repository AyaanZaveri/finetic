const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const { clsx } = require('clsx');
const { twMerge } = require('tailwind-merge');

const h = hooks();
const { Button } = load('components/ui/button.tsx', {
    react: h.react, 'react/jsx-runtime': h.jsx,
    'radix-ui': { Slot: { Root: 'slot' } },
    'lucide-react': { Loader2: 'loader' },
    '@/lib/utils': { cn: (...values) => twMerge(clsx(values)) },
});
let props = {};
const render = () => h.render(Button, props);
const pointer = () => ({ button: 0, defaultPrevented: false });
let clicks = 0;
props = { onClick: () => { clicks++; }, children: 'Save' };
assert.equal(render().type, 'button');
assert.ok(render().props.className.split(' ').includes('h-9'), 'Default buttons use the compact 36px preset');
props = { variant: 'destructive', children: 'Delete' };
assert.ok(render().props.className.split(' ').includes('bg-destructive/20'), 'Destructive actions use the shared muted red fill');
assert.ok(render().props.className.split(' ').includes('text-destructive'));
props = { onClick: () => { clicks++; }, children: 'Save' };
assert.equal(render().props['data-pressed'], undefined);
render().props.onPointerDown(pointer());
assert.equal(render().props['data-pressed'], 'true');
render().props.onPointerLeave(pointer());
assert.equal(render().props['data-pressed'], undefined);
render().props.onClick({ preventDefault() {} });
assert.equal(clicks, 1);

for (const inert of [{ disabled: true }, { loading: true }, { 'aria-disabled': true }]) {
    props = { ...inert, onClick: () => { clicks++; }, children: 'Save' };
    let prevented = false;
    render().props.onPointerDown(pointer());
    assert.equal(render().props['data-pressed'], undefined, 'Inert buttons never scale');
    render().props.onClick({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
}
assert.equal(clicks, 1, 'Disabled and loading buttons cannot submit twice');
props = { loading: true, children: 'Save' };
assert.equal(render().props.disabled, undefined, 'Loading preserves keyboard focus');
assert.equal(render().props['aria-disabled'], true);
assert.equal(render().props['aria-busy'], true);

for (const trigger of [
    { 'aria-haspopup': 'dialog' }, { 'data-state': 'closed' },
    { 'data-state': 'delayed-open' }, { role: 'combobox' },
    { 'aria-haspopup': 'menu', 'data-state': 'open' },
]) {
    props = trigger;
    render().props.onPointerDown(pointer());
    assert.equal(render().props['data-pressed'], 'true', 'Dialog, menu, and tooltip triggers automatically get the shared press effect');
    render().props.onPointerUp(pointer());
    assert.equal(render().props['data-pressed'], undefined);
}
props = { onPointerDown: event => { event.defaultPrevented = true; } };
render().props.onPointerDown(pointer());
assert.equal(render().props['data-pressed'], 'true', 'Preventing native focus changes does not suppress visual feedback');
render().props.onPointerCancel(pointer());
assert.equal(render().props['data-pressed'], undefined);

const anchor = { type: 'a', props: { href: '/settings' } };
const ref = () => {};
props = { asChild: true, children: anchor, ref, 'data-slot': 'custom-player-control', className: 'h-8 rounded-full bg-transparent' };
const link = render();
assert.equal(link.type, 'slot');
assert.equal(link.props.children, anchor, 'Link composition keeps the original child and adds no nested button');
assert.equal(link.props.ref, ref);
assert.equal(link.props['data-slot'], 'custom-player-control', 'Custom integration selectors survive');
assert.ok(link.props.className.includes('h-8'));
assert.ok(link.props.className.includes('rounded-full'));
assert.ok(!link.props.className.split(' ').includes('h-11'), 'Custom dimensions override shared defaults');
console.log('PASS: button press/reset, inert/loading safety, focus retention, automatic dialog/menu/tooltip feedback, consumer handlers, Slot/ref forwarding, and custom styles');

assert.ok(render().props.className.includes('motion-safe:[transform:translateZ(0)_scale(1)]'), 'Press starts from an explicit compositing transform');
assert.ok(render().props.className.includes('motion-safe:data-[pressed=true]:[transform:translateZ(0)_scale(0.97)]'), 'Press retains the same transform functions at both endpoints');
