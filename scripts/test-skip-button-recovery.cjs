const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, globals = {}) {
    const context = { exports: {}, ...globals };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, context);
    return context.exports;
}

const utility = load('lib/media/skip-segments.ts');
const segments = [
    { kind: 'intro', start: 30, end: 90, provider: 'theintrodb' },
    { kind: 'recap', start: 100, end: 120, provider: 'introdb' },
    { kind: 'credits', start: 1800, end: 1850, provider: 'theintrodb' },
    { kind: 'credits', start: 1900, end: 2000, provider: 'theintrodb' },
];

function harness(initialSegments = segments) {
    const slots = [], effects = [];
    let cursor = 0;
    const element = new EventTarget();
    element.currentTime = 45;
    element.closest = () => null;
    const ref = { current: element };
    const hooks = {
        useState(initial) {
            const at = cursor++;
            slots[at] ??= { value: at === 0 ? initialSegments : typeof initial === 'function' ? initial() : initial };
            return [slots[at].value, value => { slots[at].value = typeof value === 'function' ? value(slots[at].value) : value; }];
        },
        useRef(initial) { return slots[cursor++] ??= { current: initial }; },
        useEffect(fn, deps) {
            const at = cursor++;
            if (!slots[at] || deps.some((dep, i) => dep !== slots[at].deps[i])) {
                slots[at]?.cleanup?.();
                slots[at] = { deps };
                // Seed the real fetched segments; only DOM/media effects run here.
                if (!fn.toString().includes('fetchSkipSegments')) effects.push(() => { slots[at].cleanup = fn(); });
            }
        },
    };
    const { PlayerSkipSegments } = load('components/player-skip-segments.tsx', {
        require: name => {
            if (name === 'react') return hooks;
            if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
            if (name === '@/lib/media/skip-segments') return utility;
            if (name.endsWith('.module.css')) return { __esModule: true, default: { button: 'skip-button' } };
            return new Proxy({}, { get: (_, key) => key === 'Button' ? 'button' : key });
        },
    });
    function button(node, label) {
        if (!node || typeof node !== 'object') return null;
        if (Array.isArray(node)) return node.map(child => button(child, label)).find(Boolean) || null;
        if (node.type === 'button' && !node.props.disabled && node.props.children.includes(label)) return node;
        return button(node.props?.children, label);
    }
    const render = time => {
        cursor = 0;
        element.currentTime = time;
        const tree = PlayerSkipSegments({
            lookup: { id: 'tt11280740', type: 'series', season: 1, episode: 1, duration: 2000 },
            currentTime: time, mediaRef: ref, onSeek() {},
        });
        effects.splice(0).forEach(fn => fn());
        return label => button(tree, label);
    };
    return { render, element };
}

const player = harness();
const approximate = harness([{ kind: 'intro', start: 72.7, end: 85.3, provider: 'skipdb', verification: 'unverified' }]);
const approximateButton = approximate.render(73)('Skip Intro');
assert.ok(approximateButton, 'Runtime-mismatched intros use the standard Skip Intro label');
assert.equal(approximateButton.props.title, undefined);
approximateButton.props.onClick({ stopPropagation() {} });
assert.equal(approximate.element.currentTime, 85.3, 'A manual approximate skip uses the original boundary without a runtime-based shift');
assert.equal(approximate.render(74)('Skip Intro'), null);
const corroborated = harness([{ kind: 'intro', start: 72.7, end: 85.3, provider: 'skipdb', verification: 'corroborated' }]);
assert.ok(corroborated.render(73)('Skip Intro'), 'Cross-provider agreement restores the normal label');
const early = harness();
assert.equal(early.render(27.99)('Skip Intro'), null);
assert.ok(early.render(28)('Skip Intro'), 'An intro starting at 0:30 is offered two seconds early');
early.render(28)('Skip Intro').props.onClick({ stopPropagation() {} });
assert.equal(early.element.currentTime, 90, 'Early notice keeps the verified skip destination');
assert.equal(early.render(29)('Skip Intro'), null, 'A skipped intro stays dismissed during its lead-in too');
assert.equal(utility.activeSkipSegment(segments, 1799, [], 2), undefined, 'Credits are never offered early');
const overlapping = [{ kind: 'recap', start: 0, end: 30 }, ...segments];
assert.equal(utility.activeSkipSegment(overlapping, 29, [], 2).kind, 'recap', 'An active recap wins over a preview of the intro');
assert.equal(player.render(45)('Skip Intro').props['data-player-glass'], '',
    'Skip actions must register for native video glass; CSS backdrop-filter cannot sample a SurfaceView');
player.render(45)('Skip Intro').props.onClick({ stopPropagation() {} });
assert.equal(player.element.currentTime, 90);
assert.equal(player.render(90)('Skip Intro'), null);
assert.equal(player.render(45)('Skip Intro'), null, 'A stale native playhead echo must not resurrect the skipped intro');
assert.equal(player.render(89.95)('Skip Intro'), null, 'A seek landing just before the endpoint must not resurrect the skipped intro');
player.element.dispatchEvent(new Event('seeking'));
assert.equal(player.render(89.95)('Skip Intro'), null, 'Our own seek event cannot re-arm the intro');
player.element.dispatchEvent(new Event('seeked'));
assert.equal(player.render(89.95)('Skip Intro'), null, 'Finishing an imprecise seek does not re-arm the intro');
player.render(130);
player.element.currentTime = 50;
player.element.dispatchEvent(new Event('seeking'));
assert.ok(player.render(50)('Skip Intro'), 'A deliberate rewind into the intro makes Skip available again');
player.render(50)('Skip Intro').props.onClick({ stopPropagation() {} });
player.element.dispatchEvent(new Event('seeked'));
assert.ok(player.render(110)('Skip Recap'), 'Skipping intro does not suppress a later recap from the fallback');
player.render(110)('Skip Recap').props.onClick({ stopPropagation() {} });
assert.equal(player.render(119.95)('Skip Recap'), null);
player.element.dispatchEvent(new Event('seeked'));
player.render(1820)('Skip Credits').props.onClick({ stopPropagation() {} });
assert.equal(player.render(1849.95)('Skip Credits'), null);
assert.equal(player.render(1870)('Skip Credits'), null, 'Do not offer to skip a post-credit scene');
assert.ok(player.render(1920)('Skip Credits'), 'Later, separate credits remain skippable');
player.element.dispatchEvent(new Event('seeked'));
player.element.currentTime = 0;
player.element.dispatchEvent(new Event('seeking'));
assert.ok(player.render(45)('Skip Intro'), 'Rewinding before an intro also re-arms it when playback reaches the intro again');

const postcss = require('postcss');
const css = postcss.parse(fs.readFileSync('components/player-skip-segments.module.css', 'utf8'));
const base = css.nodes.find(rule => rule.selector === '.button');
const declarations = Object.fromEntries(base.nodes.map(node => [node.prop, node.value]));
assert.equal(declarations['box-shadow'], 'none');
assert.equal(declarations['backdrop-filter'], 'blur(6px)');
assert.equal(declarations.transform, 'none');
css.walkDecls('translate', () => assert.fail('Skip Intro must stay stationary while fading in or out'));
assert.equal(declarations['transform-origin'], 'center');
assert.equal(declarations['min-height'], '3rem');
const borderOverride = css.nodes.find(rule => rule.selector === '.button[data-player-skip]');
assert.ok(borderOverride?.nodes.some(node => node.prop === 'border' && node.value === '0'),
  'The skip button must override the shared glass border regardless of stylesheet order');
const glassCss = postcss.parse(fs.readFileSync('components/player-mobile.css', 'utf8'));
const hover = glassCss.nodes.find(rule => rule.params === '(hover: hover) and (pointer: fine)').nodes[0];
assert.ok(hover.selector.includes('[data-player-skip][data-visible]:enabled:hover'));
assert.ok(!hover.nodes.some(node => node.prop === 'transform'), 'Hover only lightens the glass; it never scales');
const press = css.nodes.find(rule => rule.selector === '.button[data-visible]:enabled:active');
assert.ok(press.nodes.some(node => node.prop === 'transform' && node.value === 'scale(0.97)'), 'Press matches the normal button scale on mouse, touch, and keyboard');
assert.ok(declarations.transition.includes('opacity var(--duration-fast, 160ms) var(--ease-out)'));
assert.ok(declarations.transition.includes('transform'));
const visible = css.nodes.find(rule => rule.selector === '.button[data-visible]');
assert.ok(visible.nodes.some(node => node.prop === 'transition' && node.value.includes('opacity var(--duration-standard, 240ms)')));
assert.ok(css.nodes.some(rule => rule.name === 'starting-style'), 'A button first painted visible still gets its entrance');
const reduced = css.nodes.find(rule => rule.params === '(prefers-reduced-motion: reduce)');
assert.ok(reduced.nodes[0].nodes.some(node => node.prop === 'transform' && node.value === 'none'));
assert.ok(glassCss.nodes.some(rule => rule.params === '(hover: hover) and (pointer: fine)'));
assert.ok(css.nodes.some(rule => rule.params === '(prefers-reduced-motion: reduce)'));
console.log('PASS: no skip-button reappearance after delayed seeks; deliberate rewinds, later segments, hidden controls, and restrained motion stay correct.');
