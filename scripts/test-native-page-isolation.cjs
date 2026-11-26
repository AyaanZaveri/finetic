const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const ts = require('typescript');
const { load } = require('./test-support/react-hooks.cjs');

// Follow relative CSS imports too: desktop work can move the native policy
// out of globals.css without removing this cross-platform regression coverage.
function rules(file) {
  const result = [];
  const sheet = postcss.parse(fs.readFileSync(file, 'utf8'));
  for (const node of sheet.nodes) {
    const imported = node.type === 'atrule' && node.name === 'import' && node.params.match(/^["'](\.[^"']+)["']/);
    if (imported) result.push(...rules(path.resolve(path.dirname(file), imported[1])));
    else if (node.type === 'rule') result.push(node);
  }
  return result;
}
const nativeRules = rules('app/globals.css');
const macPlayerViewport = nativeRules.find(rule => rule.selector === 'html[data-native-platform="macos"]:has([data-player-shell], [data-app-layout])');
assert.equal(macPlayerViewport?.nodes.find(node => node.prop === 'overscroll-behavior')?.value, 'none',
  'Suppress rubber-banding at the outer macOS viewport during playback and browsing');
assert.equal(macPlayerViewport?.nodes.find(node => node.prop === 'overflow')?.value, 'clip',
  'Only the inner scroller can create a macOS scroll range');
const layoutSource = fs.readFileSync('components/layout-content.tsx', 'utf8');
assert.match(layoutSource, /data-page-scroll=""[^\n]*overscroll-contain/, 'The content scroller keeps local bounce without chaining to the outer viewport');
const shellRules = rules('components/layout-content.module.css');
const clip = selector => shellRules.find(rule => rule.selector === selector)?.nodes.find(node => node.prop === 'clip-path')?.value;
assert.equal(clip('.skipLink'), 'inset(50%)', 'The unfocused skip link cannot be pulled into view by viewport movement');
assert.equal(clip('.skipLink:focus-visible'), 'none', 'Keyboard focus still reveals the skip link');
function pagePolicy(attributes) {
  const policy = {};
  for (const rule of nativeRules) {
    // The real retained page boundary, not controls or descendants inside it.
    for (const selector of rule.selector.split(',')) {
      if (!/^html(?:\[[^\]]+\])+ \[data-desktop-app-content\]$/.test(selector.trim())) continue;
      const requirements = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]+)")?\]/g)].slice(0, -1);
      if (!requirements.every(([, key, value]) => key in attributes && (!value || attributes[key] === value))) continue;
      for (const declaration of rule.nodes) if (declaration.type === 'decl') policy[declaration.prop] = declaration.value;
    }
  }
  return policy;
}
const hero = postcss.parse(fs.readFileSync('components/hero-wordmark.module.css', 'utf8'));
const readyWordmark = hero.nodes.find(node => node.selector === '.root[data-ready] .artwork');
const wordmarkVisibility = readyWordmark.nodes.find(node => node.prop === 'visibility')?.value;
const mediaCard = postcss.parse(fs.readFileSync('components/media-card.module.css', 'utf8'));
const readyCard = mediaCard.nodes.find(node => node.selector?.includes(':has(') && node.selector.includes('.wordmark'));
assert.equal(readyCard.nodes.find(node => node.prop === 'visibility')?.value, 'visible',
  'Reproduce Continue Watching wordmarks becoming visible after each card image loads');


// Obtain the overscroll surface from the real hook after its bitmap is ready.
let setup, frame, surface;
const image = { complete: true, naturalWidth: 1920, naturalHeight: 1080, clientWidth: 1200, clientHeight: 500,
  closest: () => scroller, addEventListener() {}, removeEventListener() {} };
const scroller = { offsetLeft: 0, offsetTop: 0, clientWidth: 1200, clientHeight: 900,
  parentElement: { append(node) { surface = node; } }, addEventListener() {}, removeEventListener() {} };
const document = { createElement() { return { style: {}, setAttribute() {}, append() {}, remove() {},
  getContext: () => ({ drawImage() {} }) }; } };
const { useBackdropOverscroll } = load('components/media-page/use-backdrop-overscroll.ts', {
  react: { useEffect(fn) { setup = fn; } },
  './backdrop-transition.module.css': {},
  '@/lib/logo-contrast': { getLogoSampleCrop: () => ({ x: 0, y: 0, width: 1920, height: 12 }) },
}, { document, requestAnimationFrame(fn) { frame = fn; return 1; }, cancelAnimationFrame() {},
  ResizeObserver: class { observe() {} disconnect() {} }, getComputedStyle: () => ({ objectPosition: '50% 50%' }) });
useBackdropOverscroll({ current: image }, '/backdrop.jpg');
const cleanup = setup();
frame();
assert.equal(surface.style.visibility, 'visible', 'Reproduce the loaded overscroll layer explicitly restoring visibility');
assert.equal(wordmarkVisibility, 'visible', 'Reproduce the ready page wordmark explicitly restoring visibility');
for (const platform of ['android', 'windows', 'macos', 'ios', 'linux', undefined]) {
  const attributes = { 'data-desktop': 'mpv', 'data-native-playing': '' };
  if (platform) attributes['data-native-platform'] = platform;
  const policy = pagePolicy(attributes);
  // visibility:hidden alone cannot hide either visible descendant. Opacity
  // applies to the complete group's paint, so neither can override it.
  assert.equal(policy.opacity, '0', `${platform ?? 'legacy native bridge'}: the retained page must suppress all descendant paint, even visibility:visible artwork`);
  assert.equal(policy['pointer-events'], 'none');
  assert.notEqual(policy.display, 'none', 'Preserve page layout and scroll geometry while playing');
  assert.notEqual(policy['content-visibility'], 'hidden', 'Do not replace retained page geometry with an estimate');
  delete attributes['data-native-playing'];
  assert.notEqual(pagePolicy(attributes).opacity, '0', 'Closing native playback restores the same retained page');
}
assert.notEqual(pagePolicy({}).opacity, '0', 'Ordinary web browsing is unaffected');
cleanup();

// Hiding the retained page must never hide the player itself.
const layout = ts.createSourceFile('layout.tsx', fs.readFileSync('components/layout-content.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let tools = 0;
function visit(node, insidePage = false) {
  const tag = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
  const page = tag?.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.text === 'data-desktop-app-content');
  if (tag?.tagName.getText(layout) === 'DeferredTools') { tools++; assert.equal(insidePage, false, 'Player/tool overlays must remain siblings of the hidden browsing page'); }
  ts.forEachChild(node, child => visit(child, insidePage || page));
}
visit(layout);
assert.equal(tools, 1);
console.log('PASS: ready wordmark/overscroll cannot escape the retained page on any native platform; page geometry, close restoration and sibling player remain intact');

// Exercise the actual page boundary at Play intent, before native loading or
// its data-native-playing effect mounts. Ready wordmarks cannot punch through
// the group's opacity, and Back must restore the retained content unchanged.
const React = require('react');
for (const pathname of ['/', '/movie/tt0816692', '/series/tt1442437/6/4']) {
  let playerVisible = false;
  const retainedContent = React.createElement('div', { 'data-fixture-page': '' }, 'Retained catalog');
  const { LayoutContent } = load('components/layout-content.tsx', {
    react: { ...React, useEffect() {}, useLayoutEffect() {}, useRef: () => ({ current: null }) },
    jotai: { useAtom: atom => [atom === 'player-visible' ? playerVisible : false, () => {}] },
    'next/navigation': { usePathname: () => pathname },
    '@/lib/atoms': { isPlayerVisibleAtom: 'player-visible' },
    '@/components/app-header': { AppHeader: 'header' },
    '@/components/desktop-tmdb-setup-prompt': { DesktopTmdbSetupPrompt: 'setup-prompt' },
    '@/components/deferred-tools': { DeferredTools: 'player-overlays' },
    '@/contexts/settings-context': { useSettings: () => ({ navigatorEnabled: false }) },
    '@/contexts/account-context': { useAccountAccess: () => ({ authenticated: true }) },
    '@/lib/desktop/bridge': { desktopBridge: () => null },
    '@/components/aurora-provider': { AuroraProvider: 'provider', PersistentAuroraBackground: 'aurora' },
    '@/components/home-palette-provider': { HomePaletteProvider: 'home-palette' },
    '@/components/home-gradient-background': { HomeGradientBackground: 'home-gradient' },
    '@/components/home-aurora-controller': { HomeAuroraController: 'home-aurora-controller' },
    '@/components/ui/scroll-area': { ScrollAreaRoot: 'scroll-root', ScrollAreaViewport: 'scroll-viewport', ScrollBar: 'scrollbar' },
    './layout-content.module.css': {},
  });
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return undefined;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat()) {
      const found = find(child, predicate); if (found) return found;
    }
  }
  for (const playing of [false, true, false, true, false]) {
    playerVisible = playing;
    const tree = LayoutContent({ children: retainedContent, email: 'fixture@example.invalid' });
    const page = find(tree, node => node.props?.['data-desktop-app-content'] !== undefined);
    assert.equal(page.props.inert, playing, `${pathname}: hidden browsing content cannot receive keyboard or touch input`);
    assert.equal(page.props['data-playback-hidden'] !== undefined, playing, `${pathname}: hide the page in the same render that opens the player`);
    assert.equal(find(page, node => node === retainedContent), retainedContent, 'Keep the same page/content identity and scroll geometry');
    assert.ok(find(tree, node => node.type === 'player-overlays'));
    assert.equal(find(page, node => node.type === 'player-overlays'), undefined, 'Player remains outside the suppressed page');
  }
}
const immediateRule = nativeRules.find(rule => rule.selector.split(',').some(selector => selector.trim() === '[data-desktop-app-content][data-playback-hidden]'));
assert.equal(immediateRule?.nodes.find(node => node.prop === 'opacity')?.value, '0', 'The immediate React boundary suppresses the complete paint group');
console.log('PASS: Play/Back/Play retains and isolates home/movie/episode content before native readiness and restores input on close');
