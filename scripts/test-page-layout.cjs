const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
function load(file, resolve, globals = {}) {
  const context = { exports: {}, require: resolve, console, ...globals };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  return context.exports;
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...React.Children.toArray(node.props?.children).flatMap(child => find(child, predicate))];
}
function Header() {}
for (const path of ['/', '/movie/tt123', '/series/tt123', '/series/tt123/1/2', '/settings', '/addons', '/search', '/library/all', '/person/1']) {
  const { LayoutContent } = load('components/layout-content.tsx', name => {
    if (name === 'react') return { ...React, useEffect() {}, useLayoutEffect() {}, useRef: () => ({ current: null }) };
    if (name === 'react/jsx-runtime') return require(name);
    if (name === '@/contexts/account-context') return { useAccountAccess: () => ({ authenticated: true }) };
    if (name === 'jotai') return { useAtom: () => [false, () => {}] };
    if (name === 'next/navigation') return { usePathname: () => path };
    if (name === '@/components/app-header') return { AppHeader: Header };
    if (name === '@/contexts/settings-context') return { useSettings: () => ({ navigatorEnabled: false }) };
    if (name === '@/lib/desktop/bridge') return { desktopBridge: () => null };
    if (name === '@/components/navigator/ai-ask') return { default: () => null };
    return new Proxy({}, { get: (_, key) => key });
  });
  const page = React.createElement('p', null, 'Page content');
  const tree = LayoutContent({ children: page, email: 'fixture@example.invalid' });
  const headers = find(tree, node => node.type === Header);
  const mains = find(tree, node => node.props?.['data-page-scroll'] !== undefined);
  const layout = find(tree, node => node.props?.['data-app-layout'] !== undefined)[0];
  assert.equal(layout.props['data-home-layout'] !== undefined, path === '/', 'The shared 40px desktop gutter is scoped to Home');
  assert.equal(find(mains[0], node => node.type === 'HomeAuroraController').length, path === '/' ? 1 : 0, 'Only Home mounts the scroll/hover Aurora controller');
  assert.equal(headers.length, 1, `${path}: one persistent header`);
  assert.equal(headers[0].props.home, path === '/', `${path}: compact Home header styling stays on Home`);
  assert.equal(mains.length, 1, `${path}: one page scrollport`);
  const gradients = find(mains[0], node => node.type === 'HomeGradientBackground');
  assert.equal(gradients[0].props.emerald, /^\/(settings|addons)(?:\/|$)/.test(path), 'Only Settings and Addons replace artwork colors with emerald');
  assert.equal(gradients[0].props.subdued, /^\/(person|settings|addons)(?:\/|$)/.test(path), 'Person pages match the subdued Settings intensity while retaining artwork colors');
  assert.equal(gradients.length, 1, `${path}: keep one layout-owned gradient mounted`);
  assert.equal(gradients[0].props.visible, /^\/(search|person|settings|addons)(?:\/|$)/.test(path), `${path}: Home uses Aurora; dots remain on other supported surfaces`);
  assert.equal(mains[0].props.tabIndex, -1, 'The skip target is programmatically focusable without an extra tab stop');
  assert.equal(mains[0].props.role, 'main', `${path}: retain the main landmark on the actual scroll viewport`);
  assert.equal(find(mains[0], node => node.type === Header).length, 0, `${path}: scrolling page content must not contain the navbar`);
  assert.ok(find(mains[0], node => node.type === "p" && node.props.children === "Page content").length, `${path}: page content remains in the scrollport`);
  assert.equal(headers[0].props.overlay, /^\/(movie|series)(?:\/|$)/.test(path), `${path}: media pages retain adaptive backdrop presentation`);
  assert.equal(mains[0].props['data-header-overlay'], path === '/' || /^\/(movie|series)(?:\/|$)/.test(path) ? 'true' : 'false', `${path}: Mac scrollport geometry follows route changes without double-insetting overlay pages`);
}

// Native scrolling can move the page before its JS scroll listener runs.
// Enforce the paint boundary rather than depending on scroll-event timing:
// the scrolling content must mask the stationary backing in both themes.
const postcss = require('postcss');
const backdropCss = postcss.parse(fs.readFileSync('components/media-page/backdrop-transition.module.css', 'utf8'));
const pageSurface = backdropCss.nodes.find(node => node.type === 'rule' && node.selector === '.page');
const background = pageSurface.nodes.find(node => node.prop === 'background' || node.prop === 'background-color')?.value;
assert.equal(background, 'var(--background)', 'Media pages must mask the overscroll backing under body text even when its visibility update is late');
for (const file of ['components/media-page/movie-details-view.tsx', 'components/media-page/series-details-frame.tsx', 'components/media-page/loading.tsx']) {
  assert.ok(fs.readFileSync(file, 'utf8').includes('backdropStyles.page'), `${file}: media content and loading states must share the opaque page surface`);
}
console.log('PASS: movie, series and loading surfaces mask the overscroll backing independently of scroll-event timing');

// Exercise the actual header effect without a browser: safe-area/font changes
// must update the geometry consumed by movie, series and episode logos.
let height = 148, resized, disconnected = false;
const properties = new Map(), effects = [];
const layout = { style: { setProperty(key, value) { properties.set(key, value); } } };
const element = { closest: () => layout, getBoundingClientRect: () => ({ height }), querySelectorAll: () => [] };
const { AppHeader } = load('components/app-header.tsx', name => {
  if (name === '@/contexts/account-context') return { useAccountAccess: () => ({ authenticated: true }) };
  if (name === 'react') return { ...React, useRef: () => ({ current: element }), useLayoutEffect: effect => effects.push(effect) };
  if (name === 'react/jsx-runtime') return require(name);
  if (name === '@/contexts/MediaPlayerContext') return { useIsPlayerVisible: () => false };
  return new Proxy({}, { get: (_, key) => key });
}, { cancelAnimationFrame() {}, ResizeObserver: class {
  constructor(callback) { resized = callback; }
  observe(node) { assert.equal(node, element); }
  disconnect() { disconnected = true; }
} });
const header = AppHeader({ email: 'fixture@example.invalid', overlay: true });
assert.equal(header.type, 'header');
assert.ok(!header.props.className.includes('absolute'), 'Media navbar must participate in the persistent shell, not page positioning');
const cleanup = effects[0]();
assert.equal(properties.get('--app-header-height'), '148px');
height = 164; resized();
assert.equal(properties.get('--app-header-height'), '164px', 'Native inset and font changes update logo geometry');
cleanup();
assert.equal(disconnected, true);
console.log('PASS: persistent navbar across all routes, media overlay mode, measured safe-area geometry and observer cleanup');

// Exercise route transitions against the actual persistent scrollport ref.
const { hooks } = require('./test-support/react-hooks.cjs');
const navigationHooks = hooks();
let pathname = '/movie/first';
const { LayoutContent: NavigatingLayout } = load('components/layout-content.tsx', name => {
  if (name === 'react') return { ...React, ...navigationHooks.react, useLayoutEffect: navigationHooks.react.useEffect };
  if (name === 'react/jsx-runtime') return require(name);
  if (name === '@/contexts/account-context') return { useAccountAccess: () => ({ authenticated: true }) };
  if (name === 'jotai') return { useAtom: () => [false, () => {}] };
  if (name === 'next/navigation') return { usePathname: () => pathname };
  if (name === '@/contexts/settings-context') return { useSettings: () => ({ navigatorEnabled: false }) };
  return new Proxy({}, { get: (_, key) => key });
});
let top = 1200, resets = 0;
const viewport = { scrollTo(options) {
  assert.equal(options.behavior, 'instant', 'New-title navigation must cancel smooth scrolling');
  assert.equal(options.left, 0);
  top = options.top;
  resets++;
} };
function renderNavigation() {
  const tree = navigationHooks.render(NavigatingLayout, { email: 'fixture@example.invalid', children: 'Page' });
  const main = find(tree, node => node.props?.['data-page-scroll'] !== undefined)[0];
  assert.ok(main.props.ref, 'The effect must target the actual Radix viewport, not the document');
  main.props.ref.current = viewport;
  navigationHooks.flush();
  const skip = find(tree, node => node.type === 'a' && node.props.href === '#page-content')[0];
  assert.ok(skip, 'A skip link bypasses repeated header controls');
  assert.equal(main.props.id, 'page-content');
  let focused = false, prevented = false;
  viewport.focus = options => { focused = true; assert.equal(options.preventScroll, true); };
  skip.props.onClick({ preventDefault() { prevented = true; } });
  assert.ok(focused && prevented, 'Skip moves keyboard focus to the actual page viewport without changing the URL');
}
for (const route of ['/movie/first', '/series/second', '/movie/third', '/']) {
  pathname = route;
  top = 1200;
  const previous = resets;
  renderNavigation();
  assert.equal(top, 0, `${route}: reset retained recommendations scroll to the hero`);
  assert.equal(resets, previous + 1);
  top = 450;
  renderNavigation();
  assert.equal(top, 450, 'Metadata/palette/player updates on the same route must preserve scrolling');
  assert.equal(resets, previous + 1);
}
const seriesId = path => {
  const value = path.split('/')[2];
  try { return decodeURIComponent(value); } catch { return value; }
};
// The title card uses a raw ID; the first episode link encodes that same ID.
// Include escape casing, trailing slashes and malformed bookmarked IDs too.
for (const route of [
  '/series/show-a', '/series/show-a/1/2', '/series/show-a/1/3',
  '/series/show-a/2/1', '/series/show-a/0/1', '/series/show-a',
  '/series/tmdb:123', '/series/tmdb%3A123/1/1', '/series/tmdb%3a123/1/2',
  '/series/tmdb:123/2/1', '/series/tmdb%3A123/', '/series/tmdb%3A123/0/1',
  '/series/tmdb%3A456/1/1', '/series/bad%ZZ', '/series/bad%25ZZ/1/1',
  '/series/show-b/1/1', '/movie/show-b', '/series/show-b/1/2', '/', '/series/show-b/1/3',
]) {
  const previousPath = pathname;
  pathname = route;
  top = 725;
  const previous = resets;
  renderNavigation();
  const sameShow = previousPath.split('/')[1] === 'series' && route.split('/')[1] === 'series' && seriesId(previousPath) === seriesId(route);
  assert.equal(top, sameShow ? 725 : 0, `${previousPath} → ${route}: preserve scroll only within the same series`);
  assert.equal(resets, previous + (sameShow ? 0 : 1));
}
navigationHooks.unmount();
console.log('PASS: new-title navigation resets to the hero; episode changes within a series and same-route updates preserve scroll');
