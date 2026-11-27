const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');

const { selectHomeHeroItems, formatHeroMetadata, heroDetailsHref } = load('lib/home-hero.ts');

const backdrop = id => `https://image.tmdb.org/t/p/w1280/${id}.jpg`;
const logo = id => `https://image.tmdb.org/t/p/original/${id}.png`;

// 1. Selection: interleaving, deduping, filtering missing backdrops
const selected = selectHomeHeroItems([
  {
    items: [
      { id: 'tmdb:1', type: 'movie', name: 'No Backdrop Movie', poster: backdrop('p1') },
      { id: 'tmdb:2', type: 'movie', name: 'First Movie', background: backdrop('m1') },
      { id: 'tmdb:3', type: 'movie', name: 'Second Movie', background: backdrop('m2') },
    ],
  },
  {
    items: [
      { id: 'tmdb:10', type: 'series', name: 'First Show', background: backdrop('s1') },
      { id: 'tmdb:2', type: 'movie', name: 'First Movie Duplicate', background: backdrop('m1') },
      { id: 'tmdb:11', type: 'series', name: 'Second Show', background: backdrop('s2') },
    ],
  },
], 4);

assert.deepEqual(
  Array.from(selected, item => `${item.type}:${item.id}`),
  ['movie:tmdb:2', 'series:tmdb:10', 'movie:tmdb:3', 'series:tmdb:11'],
  'Interleaves movie and series rows, skips items without backdrops, and deduplicates titles',
);

// 2. Metadata formatting & detail links
assert.equal(heroDetailsHref({ id: 'tmdb:42', type: 'movie' }), '/movie/tmdb:42');
assert.equal(heroDetailsHref({ id: 'tt0944947', type: 'series' }), '/series/tt0944947');

const meta = formatHeroMetadata({
  communityRating: 7.14,
  ratingSource: 'TMDB',
  voteCount: 1240,
  releaseInfo: '2026-04-12',
  runtime: '101 min',
  genres: ['Action', 'Adventure', 'Drama', 'Thriller'],
});
assert.equal(meta.rating.value, '7.1');
assert.equal(meta.rating.label, 'TMDB 7.1 out of 10, 1,240 votes');
assert.equal(meta.year, '2026');
assert.equal(meta.runtime, '1h 41m');
assert.deepEqual(Array.from(meta.genres), ['Action', 'Adventure', 'Drama']);

// 3. Component rendering, accessibility, playback, and manual switcher
const h = hooks();
let reducedMotion = false;
let pageVisible = true;
h.react.useSyncExternalStore = subscribe => subscribe.name === 'subscribeReducedMotion' ? reducedMotion : pageVisible;
let authenticated = true;
let signInCalls = 0;
const played = [];
const metadataIntents = [];

let snapshot = null;
const heroDependencies = {
  react: h.react,
  'react/jsx-runtime': h.jsx,
  'lucide-react': {
    ArrowRight: 'icon-arrow-right',
    CalendarDays: 'icon-calendar',
    Clock: 'icon-clock',
    Pause: 'icon-pause',
    Info: 'icon-info',
    Play: 'icon-play',
    Star: 'icon-star',
    Tag: 'icon-tag',
  },
  '@/components/artwork-image': { ArtworkImage: 'artwork-img' },
  '@/components/hero-wordmark': { HeroWordmark: 'hero-wordmark' },
  '@/components/home-snapshot-provider': { useHomeHeroSnapshot: () => snapshot },
  '@/components/intent-link': { IntentLink: 'intent-link' },
  '@/components/metadata-preload': { useMetadataIntent: media => ({ start() { metadataIntents.push(media.id); }, cancel() { metadataIntents.push(null); } }) },
  '@/components/motion-primitives/progressive-blur': { ProgressiveBlur: 'progressive-blur' },
  '@/components/ui/button': { Button: 'button' },
  '@/components/ui/tooltip': { Tooltip: 'tooltip', TooltipTrigger: 'tooltip-trigger', TooltipContent: 'tooltip-content' },
  '@/components/ui/skeleton': { Skeleton: 'skeleton' },
  '@/contexts/account-context': {
    useAccountAccess: () => ({ authenticated, requestSignIn: () => { signInCalls++; } }),
  },
  '@/contexts/MediaPlayerContext': {
    usePlaybackActions: () => ({
      playMedia: async media => { played.push(media); },
      setIsPlayerVisible() {},
    }),
  },
  '@/lib/preload-tools': { preloadPlayer() {} },
  './home-hero.module.css': new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) }),
};
const { HomeHero, HomeHeroSkeleton } = load('components/home-hero.tsx', heroDependencies);

const nodes = node => (!node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]);

assert.equal(h.render(HomeHero, { items: [] }), null, 'Renders nothing when no hero items exist');

const heroItems = [
  {
    id: 'tmdb:2',
    type: 'movie',
    name: 'Heart of the Beast',
    background: backdrop('heart'),
    logo: logo('heart-logo'),
    description: 'Stranded in the Alaskan wilderness.',
    year: 2026,
    communityRating: 7.1,
    ratingSource: 'TMDB',
    genres: ['Action', 'Adventure', 'Drama'],
  },
  {
    id: 'tmdb:10',
    type: 'series',
    name: 'Severance',
    background: backdrop('sev'),
    description: 'Memories divided between work and home.',
    year: 2022,
    communityRating: 8.4,
    ratingSource: 'TMDB',
    genres: ['Drama', 'Sci-Fi'],
  },
];

// All six slide assets must exist before the first selection or timer event.
const fullCarousel = [
  ...heroItems,
  ...Array.from({ length: 4 }, (_, index) => ({
    id: `tmdb:${20 + index}`, type: 'movie', name: `Featured ${index + 3}`,
    background: backdrop(`slide-${index}`), logo: logo(`slide-${index}`),
  })),
];
const initialCarousel = nodes(h.render(HomeHero, { items: fullCarousel }));
const initialBackdrops = initialCarousel.filter(n => n.type === 'artwork-img');
assert.equal(initialBackdrops.length, 6, 'Every responsive backdrop mounts on the initial render');
assert.deepEqual(initialBackdrops.map(n => n.props.src), fullCarousel.map(item => item.background));
assert.ok(initialBackdrops.every(n => n.props.loading === 'eager' && n.props.waitForDecode && n.props.srcSet));
assert.deepEqual(initialBackdrops.map(n => n.props.fetchPriority), ['high', 'auto', 'auto', 'auto', 'auto', 'auto']);
assert.deepEqual(initialCarousel.filter(n => n.type === 'hero-wordmark').map(n => n.props.src),
  fullCarousel.flatMap(item => item.logo ? [item.logo] : []), 'Every wordmark mounts before its slide is selected');
assert.equal(initialCarousel.filter(n => n.props?.className === 'copyPanel' && n.props.inert).length, 5,
  'Preloaded title panels stay hidden from interaction and assistive technology');

let tree = nodes(h.render(HomeHero, { items: heroItems }));
const activeCopy = () => nodes(tree.find(n => n.props?.className === 'copyPanel' && n.props['data-active'] === 'true'));
const activeTitle = () => activeCopy().find(n => n.type === 'h2').props.children;
const backdropFor = source => tree.find(n => n.type === 'artwork-img' && n.props.src === source);
assert.equal(tree.find(n => n.props?.['aria-label'] === 'Featured title switcher').props['data-running'], 'false', 'The initial progress does not advance before artwork is ready');
backdropFor(backdrop('heart')).props.onReady();
tree = nodes(h.render(HomeHero, { items: heroItems }));
assert.ok(tree.some(n => n.type === 'progressive-blur'), 'Uses Navigator ProgressiveBlur in the hero');
for (const layer of ['topScrim', 'contentScrim', 'stageFade']) {
  assert.ok(tree.some(n => n.props?.className === layer && n.props['data-header-backdrop-fade'] !== undefined), `${layer} participates in adaptive header logo sampling`);
}
assert.equal(tree.find(n => n.props?.['data-home-hero'] !== undefined).props['data-aurora-primary'], backdrop('heart'), 'Exposes the displayed hero artwork to the Home Aurora controller');
assert.ok(tree.some(n => n.type === 'hero-wordmark'), 'Renders HeroWordmark when a logo is available');
assert.equal(activeTitle(), 'Heart of the Beast');
assert.equal(tree.find(n => n.type === 'artwork-img').props.alt, '', 'Hero backdrop is decorative');
assert.equal(tree.find(n => n.type === 'intent-link').props.href, '/movie/tmdb:2');
const detailsIntent = tree.find(n => n.type === 'intent-link').props;
detailsIntent.onPointerEnter({ pointerType: 'touch' });
assert.equal(metadataIntents.length, 0);
detailsIntent.onPointerEnter({ pointerType: 'mouse' });
detailsIntent.onPointerLeave();
detailsIntent.onFocus({ currentTarget: { matches: () => true } });
detailsIntent.onBlur();
assert.deepEqual(metadataIntents, ['tmdb:2', null, 'tmdb:2', null], 'Home details hover and keyboard focus warm the displayed title');
const facts = activeCopy().find(n => n.props?.className === 'metaFacts');
assert.ok(facts, 'Year, runtime and rating are grouped as facts');
assert.ok(nodes(facts).some(n => n.type === 'icon-calendar'), 'Year uses a recognizable decorative icon');
assert.ok(nodes(facts).some(n => n.type === 'icon-star'), 'Rating has a distinct icon');
const genreGroup = activeCopy().find(n => n.props?.className === 'genres');
assert.equal(nodes(genreGroup).filter(n => n.props?.className === 'genreSeparator').length, 2, 'Three genres use two decorative middle-dot separators');
assert.ok(nodes(genreGroup).filter(n => n.props?.className === 'genreSeparator').every(n => n.props['aria-hidden'] === 'true'));
assert.equal(tree.find(n => n.props?.className === 'detailsButton').props.variant, 'media-secondary', 'The Details action uses the same filled secondary treatment as other media actions');
assert.equal(tree.find(n => n.props?.className === 'detailsButton').props.size, 'icon-lg', 'Details uses the shared circular media action size');
assert.ok(nodes(tree.find(n => n.props?.className === 'detailsIcon')).some(n => n.type === 'icon-arrow-right'), 'The Details action has a separate arrow transition layer');
assert.ok(tree.some(n => n.type === 'tooltip-content' && n.props.children === 'View details'));

const playButton = tree.find(n => n.type === 'button' && n.props['aria-label'] === 'Play Heart of the Beast');
assert.ok(playButton, 'Renders a named Play button for signed-in users');
playButton.props.onClick({ detail: 1 });
assert.equal(played.length, 1);
assert.equal(played[0].id, 'tmdb:2');
assert.equal(played[0].detailsPath, '/movie/tmdb:2');

// Switch to second featured title manually without changing the switcher's footprint.
const dots = () => tree.find(n => n.props?.className === 'dots');
const switcherWidth = dots().props.style.width;
reducedMotion = true;
tree = nodes(h.render(HomeHero, { items: heroItems }));
assert.equal(tree.find(n => n.props?.['aria-label'] === 'Featured title switcher').props['data-running'], 'false', 'Reduced motion starts with automatic rotation off');
reducedMotion = false;
tree = nodes(h.render(HomeHero, { items: heroItems }));
const secondDot = tree.find(n => n.type === 'button' && n.props['aria-label'] === 'Show featured title 2: Severance');
secondDot.props.onClick();
tree = nodes(h.render(HomeHero, { items: heroItems }));
assert.equal(activeTitle(), 'Heart of the Beast', 'Keep the shown title while the next backdrop decodes');
assert.equal(tree.find(n => n.props?.['aria-label'] === 'Featured title switcher').props['data-running'], 'false', 'Do not start the next timer until the artwork is ready');
assert.equal(tree.filter(n => n.props?.className === 'backdropSlide').length, 2, 'Keep overlapping artwork layers during the transition');
const staleReady = backdropFor(backdrop('sev')).props.onReady;
tree.find(n => n.props?.['aria-label'] === 'Show featured title 1: Heart of the Beast').props.onClick();
tree = nodes(h.render(HomeHero, { items: heroItems }));
staleReady();
tree = nodes(h.render(HomeHero, { items: heroItems }));
assert.equal(activeTitle(), 'Heart of the Beast', 'A superseded decode cannot change the presented title');
tree.find(n => n.props?.['aria-label'] === 'Show featured title 2: Severance').props.onClick();
tree = nodes(h.render(HomeHero, { items: heroItems }));
assert.equal(activeTitle(), 'Severance', 'A decoded title switches immediately');
assert.equal(dots().props.style.width, switcherWidth, 'Indicator container width does not change when a different dot is selected');
assert.equal(tree.find(n => n.props?.['aria-current'] === 'true').props['aria-label'], 'Show featured title 2: Severance');
assert.equal(activeCopy().some(n => n.type === 'hero-wordmark'), false, 'Falls back to visible heading when logo is absent');
assert.ok(tree.some(n => n.props?.className === 'copyPanel' && n.props.inert && n.props['aria-hidden']), 'Outgoing title stays mounted for its fade but is inaccessible');
assert.equal(tree.find(n => n.type === 'intent-link').props.href, '/series/tmdb:10');
assert.equal(tree.find(n => n.props?.['data-home-hero'] !== undefined).props['data-aurora-primary'], backdrop('sev'), 'Updates the Aurora source when the new title is displayed');

// Pause preserves the active slide and progress, then resume allows the fill
// animation to complete and wrap to the next slide.
const rotationButton = () => tree.find(n => n.type === 'button' && /^(Pause|Play) featured titles$/.test(n.props['aria-label'] ?? ''));
const progress = () => nodes(tree.find(n => n.props?.['aria-current'] === 'true')).find(n => n.props?.className === 'progress');
const running = () => tree.find(n => n.props?.['aria-label'] === 'Featured title switcher').props['data-running'];
assert.equal(running(), 'true');
assert.equal(tree.find(n => n.props?.className === 'copy').props.onPointerEnter, undefined, 'Hovering the copy does not pause rotation');
for (const action of ['playButton', 'detailsButton']) {
  tree.find(n => n.props?.className === action).props.onPointerEnter({ pointerType: 'mouse' });
  tree = nodes(h.render(HomeHero, { items: heroItems }));
  assert.equal(running(), 'false', `Hovering ${action} pauses rotation`);
  tree.find(n => n.props?.className === action).props.onPointerLeave();
  tree = nodes(h.render(HomeHero, { items: heroItems }));
  assert.equal(running(), 'true', `Leaving ${action} resumes rotation`);
}
rotationButton().props.onClick();
tree = nodes(h.render(HomeHero, { items: heroItems }));
assert.equal(rotationButton().props['aria-label'], 'Play featured titles');
assert.equal(running(), 'false');
progress().props.onAnimationEnd();
tree = nodes(h.render(HomeHero, { items: heroItems }));
assert.equal(activeTitle(), 'Severance');
rotationButton().props.onClick();
tree = nodes(h.render(HomeHero, { items: heroItems }));
assert.equal(running(), 'true');
pageVisible = false;
tree = nodes(h.render(HomeHero, { items: heroItems }));
assert.equal(running(), 'false', 'Hidden document pauses rotation');
pageVisible = true;
tree = nodes(h.render(HomeHero, { items: heroItems }));
progress().props.onAnimationEnd();
tree = nodes(h.render(HomeHero, { items: heroItems }));
assert.equal(activeTitle(), 'Heart of the Beast', 'Progress completion wraps to first slide');
tree.find(n => n.props?.['aria-label'] === 'Show featured title 2: Severance').props.onClick();
tree = nodes(h.render(HomeHero, { items: heroItems }));

// Keyboard ArrowLeft returns to the first title
const switcher = tree.find(n => n.props?.['aria-label'] === 'Featured title switcher');
let prevented = false;
switcher.props.onKeyDown({ key: 'ArrowLeft', preventDefault() { prevented = true; } });
assert.equal(prevented, true);
tree = nodes(h.render(HomeHero, { items: heroItems }));
assert.equal(activeTitle(), 'Heart of the Beast');
assert.equal(running(), 'false', 'Keyboard navigation stops auto-rotation');

// Logo error falls back to visible title heading
activeCopy().find(n => n.type === 'hero-wordmark').props.onError();
tree = nodes(h.render(HomeHero, { items: heroItems }));
assert.equal(activeCopy().some(n => n.type === 'hero-wordmark'), false, 'Logo failure falls back cleanly to visible title');

// Signed-out users see Sign in to play
authenticated = false;
tree = nodes(h.render(HomeHero, { items: heroItems }));
const signInPlay = tree.find(n => n.type === 'button' && n.props['aria-label'] === 'Sign in to play Heart of the Beast');
assert.ok(signInPlay, 'Prompts guest users to sign in to play');
signInPlay.props.onClick({ detail: 1 });
assert.equal(signInCalls, 1);

h.unmount();
const skeleton = HomeHeroSkeleton();
assert.equal(skeleton.props['data-home-hero'], '', 'The skeleton reserves the same page slot and row overlap as the finished hero');
assert.equal(skeleton.props.className, 'hero');
assert.equal(skeleton.props['aria-busy'], 'true');
assert.ok(nodes(skeleton).some(n => n.props?.className === 'content'), 'Skeleton uses the same responsive content layout');
assert.ok(nodes(skeleton).filter(n => n.type === 'skeleton').every(n => n.props.animated === false), 'Loading disables individual default pulses in favor of a coordinated hero pulse');
const skeletonTree = nodes(skeleton);
const skeletonDescription = nodes(skeletonTree.find(n => n.props?.className === 'skeletonSynopsis'));
assert.deepEqual(skeletonDescription.filter(n => n.type === 'skeleton').map(n => n.props.className), ['h-2.5 w-full', 'h-2.5 w-11/12'], 'The skeleton uses exactly two thinner description lines');
const skeletonControls = skeletonTree.find(n => n.props?.['data-skeleton-controls'] !== undefined);
assert.equal(skeletonControls.props.className, 'controls', 'The skeleton uses the real responsive control container');
const skeletonDotRow = nodes(skeletonControls).find(n => n.props?.className === 'dots');
const loadedDotRow = initialCarousel.find(n => n.props?.className === 'dots');
assert.equal(skeletonDotRow.props.style.width, loadedDotRow.props.style.width, 'The six-title skeleton and loaded carousel have the same width');
const skeletonDots = nodes(skeletonDotRow).filter(n => n.props?.className === 'dotButton');
const loadedDots = nodes(loadedDotRow).filter(n => n.props?.className === 'dotButton');
assert.equal(skeletonDots.length, 6);
assert.deepEqual(skeletonDots.map(n => n.props.style.transform), loadedDots.map(n => n.props.style.transform), 'The skeleton uses identical dot positions');
assert.equal(skeletonDots.filter(n => n.props['aria-current'] === 'true').length, 1);
assert.ok(nodes(skeletonControls).some(n => n.type === 'icon-pause'), 'The skeleton includes a pause affordance');
assert.ok(nodes(skeletonControls).every(n => n.type !== 'button' && !n.props?.onClick), 'Loading controls are not interactive');
h.react.useMemo = calculate => calculate();
// Home navigation and server refresh use the same carousel instance, with
// selection keyed by title so a changed order cannot move the active slide.
const returning = hooks();
returning.react.useSyncExternalStore = h.react.useSyncExternalStore;
const pending = new Promise(() => {});
returning.react.use = () => { throw pending; };
const surface = load('components/home-hero.tsx', { ...heroDependencies, react: returning.react, 'react/jsx-runtime': returning.jsx });
assert.throws(() => returning.render(surface.HomeFeatured, { items: pending }), error => error === pending,
  'Cold Home suspends so the hero skeleton can render');
let accepted = null;
const savedView = { slide: 'series:tmdb:10', rotation: false };
snapshot = { heroItems, heroView: savedView, saveHero: items => { accepted = items; snapshot.heroItems = items; }, saveHeroView() {} };
const fresh = [heroItems[1], heroItems[0]];
const refresh = Promise.resolve(fresh);
const present = () => returning.render(surface.HomeFeatured, { items: refresh });
const cached = present(); returning.flush();
assert.equal(cached.type, surface.HomeHero, 'A warm return renders the cached hero immediately without suspending');
assert.equal(cached.props.items, heroItems);
assert.equal(cached.props.resume, savedView);
const heroHost = hooks();
heroHost.react.useSyncExternalStore = h.react.useSyncExternalStore;
const { HomeHero: ResumingHero } = load('components/home-hero.tsx', { ...heroDependencies, react: heroHost.react, 'react/jsx-runtime': heroHost.jsx });
const restored = heroHost.render(ResumingHero, cached.props);
assert.equal(restored.props['data-hero-restoring'], true);
assert.equal(restored.props['data-aurora-primary'], heroItems[1].background, 'Return to the previously displayed slide');
assert.equal(heroHost.render(ResumingHero, { ...cached.props, items: fresh }).props['data-aurora-primary'], heroItems[1].background,
  'A title remains active across a refresh that reorders the slides');

const React = require('react');
const { renderToString } = require('react-dom/server');
const wrapping = ({ children }) => React.createElement(React.Fragment, null, children);
const serverHero = load('components/home-hero.tsx', {
  ...heroDependencies, react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
  '@/components/ui/button': { Button: wrapping },
  '@/components/ui/tooltip': { Tooltip: wrapping, TooltipTrigger: wrapping, TooltipContent: wrapping },
  '@/components/ui/skeleton': { Skeleton: () => null },
});
const markup = () => renderToString(React.createElement(React.Suspense,
  { fallback: React.createElement(serverHero.HomeHeroSkeleton) }, React.createElement(serverHero.HomeFeatured, { items: pending })));
assert.doesNotMatch(markup(), /data-hero-loading=/, 'React can render the cached carousel under Suspense with a pending refresh');
const warmSnapshot = snapshot;
snapshot = null;
assert.match(markup(), /data-hero-loading=/, 'A cold Home still shows the loading skeleton');
snapshot = warmSnapshot;

queueMicrotask(() => {
  assert.equal(accepted, fresh, 'Replace cached items only after the refresh resolves');
  assert.equal(present().type, cached.type, 'Fresh data keeps the same hero component mounted');
});
const css = require('postcss').parse(require('node:fs').readFileSync('components/home-hero.module.css', 'utf8'));
const rule = selector => css.nodes.find(node => node.type === 'rule' && node.selector === selector);
const property = (selector, name) => rule(selector).nodes.find(node => node.prop === name)?.value;
assert.equal(property('.backdropSlide', 'mix-blend-mode'), 'plus-lighter', 'Overlapping fades do not dip through black');
assert.equal(property('.backdropSlide', 'opacity'), '0');
assert.equal(property('.backdropSlide[data-hero-backdrop-active="true"]', 'opacity'), '1');
assert.equal(property('.hero', '--hero-dissolve-duration'), '600ms');
assert.equal(property('.hero', '--hero-title-enter-duration'), '300ms');
assert.equal(property('.skeletonWordmarkSlot', 'height'), 'calc(var(--hero-wordmark-height) * 1.35)', 'The smaller wordmark shape preserves the loaded wordmark slot');
assert.equal(property('.skeletonSynopsis', 'font-size'), property('.synopsis', 'font-size'), 'The description skeleton shares the loaded text size');
assert.match(property('.skeletonSynopsis', 'grid-template-rows'), /repeat\(2, calc\(1em \* var\(--hero-synopsis-leading\)\)\)/);
assert.equal(property('.hero[data-hero-loading] .content', 'animation'), 'hero-skeleton-pulse 3.2s ease-in-out infinite');
assert.ok(css.nodes.some(node => node.type === 'atrule' && node.params === '(prefers-reduced-motion: reduce)' && node.nodes.some(rule => rule.selector === '.hero[data-hero-loading] .content' && rule.nodes.some(decl => decl.prop === 'animation' && decl.value === 'none'))), 'The skeleton pulse stops when reduced motion is requested');

assert.match(property('.backdropSlide', 'transition'), /opacity var\(--hero-dissolve-duration\) var\(--ease-in-out\)/);
assert.match(property('.copyPanel[data-active="true"]', 'transition'), /opacity var\(--hero-title-enter-duration\) var\(--ease-out\)/);
assert.equal(property('.copyPanel', 'transform'), undefined, 'The title fades without moving');
assert.equal(property('.copyPanel[data-active="true"]', 'transform'), undefined);
assert.ok(css.nodes.some(node => node.type === 'atrule' && node.name === 'starting-style'), 'First-time cached slides still have a transition starting style');
console.log('PASS: home hero selection, decoded artwork transitions, stale request protection, palette sync, stable carousel width, timed switching, pause/resume, reduced motion, logo fallback, and accessibility');
