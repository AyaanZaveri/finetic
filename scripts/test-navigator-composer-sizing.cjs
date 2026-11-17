const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the real component's layout effects. Model a classic scrollbar:
// shrinking the textarea with overflow:auto narrows its wrapping width, so a
// near-boundary two-line draft measures as three lines instead.
let field;
let effects;
let observer;
const mod = { exports: {} };
const source = fs.readFileSync('components/navigator/composer-input.tsx', 'utf8');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText, {
    module: mod, exports: mod.exports,
    require: name => {
        if (name === 'react') return { useRef: () => ({ current: field }), useLayoutEffect: fn => effects.push(fn) };
        if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
        if (name === './focus-ui/input-group') return { InputGroupTextarea: 'textarea' };
        throw new Error(name);
    },
    ResizeObserver: class { constructor(callback) { observer = callback; } observe() {} disconnect() {} },
});

function mount(lines, nearWrap = false, width = 500) {
    field = {
        style: { height: '128px', overflowY: '' },
        lines, nearWrap, width,
        getBoundingClientRect: () => ({ width: field.width }),
        get scrollHeight() {
            const collapsed = parseFloat(this.style.height) < this.lines * 24 + 8;
            const scrollbarWrap = collapsed && this.style.overflowY !== 'hidden' && this.nearWrap;
            return (this.lines + (scrollbarWrap ? 1 : 0)) * 24 + 8;
        },
    };
    effects = [];
    const component = mod.exports.NavigatorComposerInput({ value: 'draft', disabled: false, onValueChange() {} });
    effects.forEach(effect => effect());
    return component;
}

mount(2, true);
assert.equal(field.style.height, '56px', 'A two-line draft must not reserve a phantom third line from a measurement scrollbar');
assert.equal(field.style.overflowY, '', 'Restore stylesheet scrolling after measuring, including the max-height case');
for (const lines of [1, 2, 3, 4, 5, 12]) {
    const component = mount(lines);
    assert.equal(field.style.height, `${lines * 24 + 8}px`);
    assert.equal(component.props.style.background, "transparent");
    assert.equal(component.props.style.appearance, "none");
    assert.match(component.props.className, /max-h-/);
    assert.match(component.props.className, /overflow-y-auto/);
}
mount(5);
field.lines = 2;
field.nearWrap = true;
field.width = 400;
observer([{ contentRect: { width: 400 } }]);
assert.equal(field.style.height, '56px', 'Width changes must shrink a previous tall draft without a phantom line');
mount(2, true);
field.style.overflowY = 'auto';
field.width = 390;
observer([{ contentRect: { width: 390 } }]);
assert.equal(field.style.overflowY, 'auto', 'Preserve an explicitly configured overflow mode');
assert.equal(field.style.height, '56px');
console.log('PASS: composer sizing avoids scrollbar-induced extra lines and preserves capped scrolling.');
