const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { load, hooks } = require('./test-support/react-hooks.cjs');

const dependencies = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  'next/link': ({ prefetch, scroll, ...props }) => {
    assert.equal(scroll, false, 'Card navigation must let the shell reset to the hero instead of Next scrolling the poster into view');
    return React.createElement('a', props);
  },
  '@/lib/preload-tools': { preloadPlayer() {} },
  '@/components/metadata-preload': { useMetadataIntent: () => ({ start() {}, cancel() {} }) },
  '@/components/home-palette-provider': { useHomePaletteScene: () => null },
  '@/lib/media/playback-details': require('./test-support/playback-context.cjs').details,
  '@/lib/artwork': { mediaArtwork: () => ({ poster: '/poster.jpg', background: '/still.jpg' }), backdropVariantUrl: url => url },
  '@/lib/series-route': load('lib/series-route.ts'),
  '@/contexts/MediaPlayerContext': { usePlaybackActions: () => ({}) },
  '@/components/media-card-menu': { MediaCardMenu: ({ children }) => children },
  '@/components/watched-indicator': { WatchedIndicator: () => null },
  './media-card.module.css': new Proxy({}, { get: (_, key) => key === '__esModule' ? false : key }),
};
const imageDependencies = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
  './artwork-image.module.css': { image: 'image', reveal: 'reveal', pending: 'pending', fallback: 'fallback' },
};
const artwork = load('components/artwork-image.tsx', imageDependencies);
dependencies['@/components/artwork-image'] = artwork;
const { MediaCard } = load('components/media-card.tsx', dependencies);
for (const continueWatching of [false, true]) {
  const html = renderToStaticMarkup(React.createElement(MediaCard, {
    item: { id: 'tt123', name: 'Fixture', type: 'movie' }, continueWatching,
  }));
  assert.match(html, /data-artwork-state="loading"/, `${continueWatching ? 'Continue watching' : 'Poster'} artwork must have a visible loading surface before download/hydration`);
}
console.log('PASS: card artwork reserves an opaque loading surface before image requests complete.');

const cardHooks = hooks();
const cardFixture = load('components/media-card.tsx', {
  ...dependencies, react: { ...React, ...cardHooks.react }, 'react/jsx-runtime': cardHooks.jsx,
  '@/components/artwork-image': { ArtworkImage: 'artwork-image', ArtworkPlaceholder: 'artwork-placeholder' },
});
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  const children = [node.props?.children].flat(Infinity).filter(Boolean);
  return [node, ...children.flatMap(nodes)];
}
const posterProps = { item: { id: 'tmdb:236182', type: 'series', name: 'Amazing Race Finland',
  poster: 'https://image.tmdb.org/t/p/w500/u17FjBbauOJailVQC1siM9yGfDw.jpg' } };
let card = cardHooks.render(cardFixture.MediaCard, posterProps);
let poster = nodes(card).find(node => node.type === 'artwork-image');
assert.equal(poster.props.waitForDecode, false, 'Ordinary posters retain their existing reveal behavior');
assert.equal(poster.props.src, posterProps.item.poster, 'Search cards keep the same exact poster as suggestions');
poster.props.onUnavailable();
card = cardHooks.render(cardFixture.MediaCard, posterProps);
poster = nodes(card).find(node => node.type === 'artwork-image');
assert.equal(poster.props.src, '/poster.jpg', 'A failed supplied poster falls back to the canonical resolver');
poster.props.onUnavailable();
card = cardHooks.render(cardFixture.MediaCard, posterProps);
assert.ok(!nodes(card).some(node => node.type === 'artwork-image'), 'Exhausted sources stop without a retry loop');
card = cardHooks.render(cardFixture.MediaCard, { item: { ...posterProps.item, poster: 'https://image.tmdb.org/t/p/w500/new.jpg' } });
assert.equal(nodes(card).find(node => node.type === 'artwork-image').props.src, 'https://image.tmdb.org/t/p/w500/new.jpg', 'New metadata can recover a failed card');
cardHooks.unmount();
console.log('PASS: supplied TMDB posters, canonical fallback, exhausted-source termination, and changed-poster recovery');

const resumeHooks = hooks();
const resumeCard = load('components/media-card.tsx', {
  ...dependencies, react: { ...React, ...resumeHooks.react }, 'react/jsx-runtime': resumeHooks.jsx,
  '@/lib/artwork': load('lib/artwork.ts'),
  '@/components/artwork-image': { ArtworkImage: 'artwork-image' },
});
const resumeProps = { ...posterProps, continueWatching: true, item: {
  ...posterProps.item, background: 'https://image.tmdb.org/t/p/original/wide.jpg',
  logo: 'https://image.tmdb.org/t/p/original/logo.png',
} };
const findResumeImage = (props) => nodes(resumeHooks.render(resumeCard.MediaCard, props)).find(node => node.type === 'artwork-image');
assert.equal(findResumeImage({ ...resumeProps, revealArtwork: false }).props.reveal, true,
  'Continue Watching uses the same first-paint reveal as episode cards, including cached metadata');
assert.equal(findResumeImage(resumeProps).props.waitForDecode, true,
  'Continue Watching must not start its backdrop fade before pixels are decoded');
const cachedLogoProps = { ...resumeProps, revealArtwork: false };
const logo = () => nodes(resumeHooks.render(resumeCard.MediaCard, cachedLogoProps)).find(node => node.type === 'img');
const wordmark = () => nodes(resumeHooks.render(resumeCard.MediaCard, cachedLogoProps)).find(node => node.props?.className?.includes('wordmark'));
logo().props.ref({ complete: false, naturalWidth: 0 });
assert.equal(wordmark().props['data-logo-ready'], undefined, 'The wordmark stays hidden while its image loads');
const loadedLogo = { complete: true, naturalWidth: 500 };
logo().props.onLoad({ currentTarget: loadedLogo });
assert.equal(wordmark().props['data-logo-ready'], '', 'A delayed wordmark on a cached card must still reveal');
logo().props.ref(loadedLogo);
assert.equal(wordmark().props['data-logo-ready'], '', 'Reattaching a decoded wordmark does not interrupt its fade');
const warmLogoProps = { ...cachedLogoProps, item: { ...cachedLogoProps.item, logo: 'https://image.tmdb.org/t/p/original/warm-logo.png' } };
const warmLogo = () => nodes(resumeHooks.render(resumeCard.MediaCard, warmLogoProps)).find(node => node.type === 'img');
const warmImage = { complete: true, naturalWidth: 500 };
warmLogo().props.ref(warmImage);
warmLogo().props.onLoad({ currentTarget: warmImage });
const warmWordmark = nodes(resumeHooks.render(resumeCard.MediaCard, warmLogoProps)).find(node => node.props?.className?.includes('wordmark'));
assert.equal(warmWordmark.props['data-logo-ready'], '');
assert.equal(warmWordmark.props['data-logo-ready'], '', 'A cached logo has the same ready state as a new logo');
assert.match(findResumeImage(resumeProps).props.srcSet, /w780\/wide.jpg 780w/);
findResumeImage(resumeProps).props.onUnavailable();
const resumePoster = findResumeImage(resumeProps);
assert.equal(resumePoster?.props.src, resumeProps.item.poster, 'A broken backdrop falls back to the poster');
assert.equal(resumePoster.props.srcSet, undefined, 'Do not send the failed backdrop variants with the poster');
const cinemetaBackdrop = 'https://images.metahub.space/background/medium/tt123/img';
const cinemetaImage = findResumeImage({ ...resumeProps, item: { ...resumeProps.item, background: cinemetaBackdrop } });
assert.equal(cinemetaImage.props.src, cinemetaBackdrop);
assert.equal(cinemetaImage.props.srcSet, undefined, 'Cinemeta backdrops use a single source');
resumeHooks.unmount();

const h = hooks();
const { ArtworkImage } = load('components/artwork-image.tsx', {
  ...imageDependencies, react: { ...React, ...h.react }, 'react/jsx-runtime': h.jsx,
}, { window: { innerHeight: 800, innerWidth: 1200 } });
let loaded = 0;
const props = { src: '/first.jpg', alt: 'Poster', width: 144, height: 216, onLoad() { loaded++; } };
let image = h.render(ArtworkImage, props);
assert.equal(image.type, 'img', 'Preserve the existing image node and geometry');
assert.equal(image.props['data-artwork-state'], 'loading');
assert.match(image.props.className, /pending/);
assert.equal(image.props.width, 144);
const staleLoad = image.props.onLoad;
image.props.onLoad({ currentTarget: {} });
assert.equal(loaded, 1);
image = h.render(ArtworkImage, props);
assert.equal(image.props['data-artwork-state'], 'ready', 'Reveal immediately on load, with no timeout or decode wait');
assert.doesNotMatch(image.props.className, /pending/);
assert.match(image.props.className, /reveal/, 'Loaded images fade over their reserved surface');
image = h.render(ArtworkImage, { ...props, reveal: false });
assert.equal(image.props['data-artwork-state'], 'ready', 'Disabling a reveal retains the decoded image state');
assert.doesNotMatch(image.props.className, /reveal/, 'Search images never replay their reveal when a card moves between segment orders');
const next = { ...props, src: '/second.jpg' };
image = h.render(ArtworkImage, next);
assert.equal(image.props['data-artwork-state'], 'loading', 'A reused card must show a skeleton for its new URL');
staleLoad({ currentTarget: {} });
image = h.render(ArtworkImage, next);
assert.equal(image.props['data-artwork-state'], 'loading', 'A stale request cannot reveal a newer source');
image.props.onError({ currentTarget: {} });
image = h.render(ArtworkImage, next);
assert.equal(image.props['data-artwork-state'], 'error');
assert.equal(image.type.name, 'ArtworkPlaceholder');
assert.equal(image.type(image.props).props.role, 'img');
assert.match(image.props['aria-label'], /unavailable/);
const cached = { ...props, src: '/cached.jpg' };
const externalRef = { current: null };
image = h.render(ArtworkImage, { ...cached, ref: externalRef });
const cachedImage = { complete: true, naturalWidth: 500 };
image.props.ref(cachedImage);
assert.equal(externalRef.current, cachedImage, 'Forward the actual image to hero overscroll and contrast sampling');
h.flush();
image = h.render(ArtworkImage, { ...cached, ref: externalRef });
assert.equal(image.props['data-artwork-state'], 'ready', 'Recover a cache load that completed before hydration');
image.props.ref(null);
assert.equal(externalRef.current, null, 'Detach the external image ref on cleanup');
image = h.render(ArtworkImage, { ...props, src: '/offscreen.jpg' });
image.props.onLoad({ currentTarget: { getBoundingClientRect: () => ({ top: 900, bottom: 1100, left: 0, right: 200 }) } });
image = h.render(ArtworkImage, { ...props, src: '/offscreen.jpg' });
assert.equal(image.props['data-artwork-state'], 'ready');
assert.doesNotMatch(image.props.className, /reveal/, 'Offscreen loads do not spend frames on an unseen fade');
let cachedFailures = 0;
const cachedFailure = { ...props, src: '/cached-failure.jpg', onUnavailable: () => cachedFailures++ };
image = h.render(ArtworkImage, cachedFailure);
image.props.ref({ complete: true, naturalWidth: 0 });
image = h.render(ArtworkImage, cachedFailure);
assert.equal(image.props['data-artwork-state'], 'error', 'A failure before hydration must not leave an endless loading surface');
assert.equal(cachedFailures, 1, 'A broken cached source also advances its parent to the next image');
image = h.render(ArtworkImage, { ...cached, srcSet: '/larger.jpg 780w', sizes: '320px' });
assert.equal(image.props['data-artwork-state'], 'loading', 'Responsive source changes reset the loading treatment too');
image = h.render(ArtworkImage, { ...props, src: '' });
assert.equal(image.props['data-artwork-state'], 'error');
h.unmount();

const css = require('postcss').parse(require('node:fs').readFileSync('components/artwork-image.module.css', 'utf8'));
const pending = css.nodes.find(node => node.selector === '.pending');
assert.ok(pending.nodes.some(node => node.prop === 'background-color' && node.value === 'var(--accent)'), 'Pending images must paint an opaque themed skeleton');
assert.ok(pending.nodes.some(node => node.prop === 'opacity' && node.value === '0'), 'Hold pixels until load, then fade them in');
assert.ok(css.nodes.some(node => node.selector === '.reveal' && node.nodes.some(decl => decl.prop === 'animation' && /300ms/.test(decl.value))), 'Use a finite 300ms reveal');
assert.ok(css.nodes.some(node => node.type === 'atrule' && node.params === '(prefers-reduced-motion: reduce)'), 'Keep the reveal gentle with reduced motion');
console.log('PASS: source changes, stale events, immediate load, pre-hydration cache hits, failures and missing images.');

const backdropHooks = hooks();
let overscroll;
const { BackdropImage } = load('components/media-page/backdrop-image.tsx', {
  react: backdropHooks.react, 'react/jsx-runtime': backdropHooks.jsx,
  '@/components/artwork-image': { ArtworkImage: 'artwork-image' },
  './use-backdrop-overscroll': { useBackdropOverscroll: (ref, source) => { overscroll = { ref, source }; } },
});
const backdropProps = { name: 'Fixture', backdropImage: '/hero.jpg' };
let heroBackdrop = backdropHooks.render(BackdropImage, backdropProps);
assert.equal(heroBackdrop.type, 'artwork-image');
assert.equal(heroBackdrop.props.waitForDecode, true, 'Title hero uses the shared decoded-image reveal');
assert.equal(heroBackdrop.props.ref, overscroll.ref, 'Keep the overscroll image ref connected');
assert.equal(heroBackdrop.props.fetchPriority, 'high');
assert.ok('data-header-backdrop' in heroBackdrop.props, 'Keep header contrast sampling connected');
heroBackdrop.props.onUnavailable();
assert.equal(backdropHooks.render(BackdropImage, backdropProps).type, 'div', 'Failed hero uses the original unadorned fallback');
assert.equal(overscroll.source, '', 'Failed hero removes overscroll artwork');
assert.equal(backdropHooks.render(BackdropImage, { ...backdropProps, backdropImage: '/new-hero.jpg' }).type, 'artwork-image');
backdropHooks.unmount();

const { AvatarImage } = load('components/ui/avatar.tsx', {
  react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
  '@radix-ui/react-avatar': { Image: 'radix-avatar-image' },
  '@/components/artwork-image': { ArtworkImage: 'artwork-image' },
  '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
});
const avatar = AvatarImage({ src: '/portrait.jpg', alt: 'Person' });
assert.equal(avatar.props.src, '/portrait.jpg', 'Keep the Radix avatar preloader and error fallback');
assert.equal(avatar.props.asChild, true);
assert.equal(avatar.props.children.type, 'artwork-image');
assert.equal(avatar.props.children.props.waitForDecode, true, 'Cast and add-on avatars use the actual decoded-image fade');
assert.equal(avatar.props.children.props.style.backgroundColor, 'transparent', 'Preserve transparent icons');

// A real decode can finish long after load. Keep the wordmark hidden until
// the decode resolves, deduplicate ref/load notifications and ignore stale work.
(async () => {
  const fixture = hooks();
  const { MediaCard } = load('components/media-card.tsx', {
    ...dependencies, react: { ...React, ...fixture.react }, 'react/jsx-runtime': fixture.jsx,
    '@/lib/artwork': load('lib/artwork.ts'),
    '@/components/artwork-image': { ArtworkImage: 'artwork-image' },
  });
  const render = (props = resumeProps) => nodes(fixture.render(MediaCard, props));
  const getImage = props => render(props).find(node => node.type === 'img');
  const getWordmark = props => render(props).find(node => node.props?.className?.includes('wordmark'));
  let finish, calls = 0;
  const image = { complete: true, naturalWidth: 500, decode: () => { calls++; return new Promise(resolve => { finish = resolve; }); } };
  getImage().props.ref(image);
  getImage().props.onLoad({ currentTarget: image });
  assert.equal(calls, 1, 'Ref and load share one decode');
  assert.equal(getWordmark().props['data-logo-ready'], undefined, 'Load alone cannot expose the undecoded logo');
  finish(); await Promise.resolve();
  assert.equal(getWordmark().props['data-logo-ready'], '', 'Decoded logo can start the opacity transition');
  let finishOld;
  const oldProps = { ...resumeProps, item: { ...resumeProps.item, logo: 'https://image.tmdb.org/t/p/original/old.png' } };
  const nextProps = { ...resumeProps, item: { ...resumeProps.item, logo: 'https://image.tmdb.org/t/p/original/new.png' } };
  const oldImage = { complete: true, naturalWidth: 500, decode: () => new Promise(resolve => { finishOld = resolve; }) };
  const oldRef = getImage(oldProps).props.ref;
  oldRef(oldImage); oldRef(null);
  getImage(nextProps).props.ref({ complete: true, naturalWidth: 500 });
  finishOld(); await Promise.resolve();
  assert.equal(getWordmark(nextProps).props['data-logo-ready'], '', 'A stale decode cannot replace the current logo');
  fixture.unmount();
  console.log('PASS: decoded logo readiness, duplicate notification protection and stale decode cancellation');
})().catch(error => { console.error(error); process.exitCode = 1; });

// The native load event and cached-image ref may precede actual decoding.
(async () => {
  const fixture = hooks();
  const { ArtworkImage } = load('components/artwork-image.tsx', {
    ...imageDependencies, react: { ...React, ...fixture.react }, 'react/jsx-runtime': fixture.jsx,
  }, { window: { innerHeight: 800, innerWidth: 1200 } });
  const props = { src: '/continue-watching.jpg', waitForDecode: true };
  const render = (value = props) => fixture.render(ArtworkImage, value);
  let finish, calls = 0;
  const image = { complete: true, naturalWidth: 780, src: props.src,
    decode: () => { calls++; return new Promise(resolve => { finish = resolve; }); } };
  render().props.ref(image);
  render().props.onLoad({ currentTarget: image });
  assert.equal(calls, 1, 'Ref and load must share the same backdrop decode');
  assert.equal(render().props['data-artwork-state'], 'loading', 'Do not start the fade on an undecoded image');
  finish(); await Promise.resolve();
  assert.equal(render().props['data-artwork-state'], 'ready');
  assert.equal(render().props['data-artwork-revealing'], '', 'Decoded pixels trigger the reveal');
  let finishOld;
  const old = { ...props, src: '/old.jpg' }, next = { ...props, src: '/new.jpg' };
  const oldRef = render(old).props.ref;
  oldRef({ ...image, src: old.src, decode: () => new Promise(resolve => { finishOld = resolve; }) });
  oldRef(null);
  render(next).props.ref({ complete: true, naturalWidth: 780, src: next.src });
  finishOld(); await Promise.resolve();
  assert.equal(render(next).props['data-artwork-state'], 'ready', 'A replaced source cannot overwrite newer readiness');
  const rejected = { ...props, src: '/decode-rejected.jpg' };
  render(rejected).props.ref({ complete: true, naturalWidth: 780, src: rejected.src, decode: () => Promise.reject(Error('decode unavailable')) });
  await Promise.resolve();
  assert.equal(render(rejected).props['data-artwork-state'], 'ready', 'A successfully loaded image must not remain hidden if decode rejects');
  fixture.unmount();
  console.log('PASS: Continue Watching backdrop waits for decoding, deduplicates load/ref, and ignores stale decodes');
})().catch(error => { console.error(error); process.exitCode = 1; });
