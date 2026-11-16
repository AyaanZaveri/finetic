const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const artwork = load('lib/artwork.ts', {}, { URLSearchParams });
const small = 'https://image.tmdb.org/t/p/w500/still.jpg';
const large = 'https://image.tmdb.org/t/p/w1280/still.jpg';
assert.equal(artwork.episodeHeroStillUrl(small), large);
assert.equal(artwork.episodeHeroStillUrl(large), large);
assert.equal(artwork.episodeHeroStillUrl('https://other.test/w500/image.jpg'), 'https://other.test/w500/image.jpg');
assert.equal(artwork.episodeHeroStillUrl(undefined), undefined);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; return { promise: new Promise(yes => resolve = yes), resolve }; };
const mount = () => {
    const h = hooks();
    const { ProgressiveEpisodeStill } = load('components/progressive-episode-still.tsx', {
        react: h.react, 'react/jsx-runtime': h.jsx,
        '@/components/artwork-image': { ArtworkPlaceholder: 'placeholder' },
        './progressive-episode-still.module.css': {},
    });
    return { h, render: () => h.render(ProgressiveEpisodeStill, { preview: small, source: large, title: 'The Roundup' }) };
};
(async () => {
    const heroHooks = hooks();
    const { EpisodeHeroThumbnail } = load('components/episode-hero-thumbnail.tsx', {
        react: heroHooks.react, 'react/jsx-runtime': heroHooks.jsx,
        '@/components/artwork-image': { ArtworkImage: 'image', ArtworkPlaceholder: 'placeholder' },
        '@/components/progressive-episode-still': { ProgressiveEpisodeStill: 'progressive' },
    });
    const props = { title: 'Star Potential', released: '2025-04-27' };
    let heroTree = heroHooks.render(EpisodeHeroThumbnail, props);
    assert.equal(heroTree.type, 'placeholder', 'A released episode without artwork is not upcoming');
    heroTree = heroHooks.render(EpisodeHeroThumbnail, { ...props, thumbnail: 'https://other.test/still.jpg' });
    heroTree.props.onError();
    assert.equal(heroHooks.render(EpisodeHeroThumbnail, { ...props, thumbnail: 'https://other.test/still.jpg' }).type, 'placeholder', 'A failed still is not an upcoming episode');
    assert.equal(heroHooks.render(EpisodeHeroThumbnail, { title: 'Unknown date' }).type, 'placeholder');
    assert.equal(heroHooks.render(EpisodeHeroThumbnail, { ...props, released: '2999-04-27' }).type, 'div', 'Future dates retain the upcoming notice');
    heroHooks.unmount();
    const cold = mount(); let tree = cold.render();
    const [preview, high] = tree.props.children;
    assert.equal(preview.props.src, small); assert.equal(high.props.src, large);
    assert.equal(preview.props['aria-hidden'], 'true'); assert.equal(high.props.alt, 'The Roundup');
    assert.equal(high.props.fetchPriority, 'high');
    preview.props.ref({ complete: true, naturalWidth: 500 });
    const decoding = deferred(); const image = { complete: false, naturalWidth: 1280, decode: () => decoding.promise };
    high.props.ref(image); high.props.onLoad({ currentTarget: image });
    assert.equal(cold.render().props['data-episode-hero-state'], 'loading', 'Keep the preview while sharp pixels decode');
    decoding.resolve(); await tick(); tree = cold.render();
    assert.equal(tree.props['data-episode-hero-state'], 'sharp');
    assert.equal(tree.props.children[1].props['data-animate'], true, 'Only a real low-to-high upgrade fades');
    high.props.ref(null); cold.h.unmount();

    const warm = mount(); tree = warm.render();
    tree.props.children[0].props.ref({ complete: true, naturalWidth: 500 });
    tree.props.children[1].props.ref({ complete: true, naturalWidth: 1280, decode: async () => {} });
    await tick(); tree = warm.render();
    assert.equal(tree.props['data-episode-hero-state'], 'sharp');
    assert.equal(tree.props.children[1].props['data-animate'], undefined, 'Cached high resolution is immediate');
    tree.props.children[1].props.ref(null); warm.h.unmount();

    const failed = mount(); tree = failed.render();
    tree.props.children[1].props.onError(); tree = failed.render();
    assert.equal(tree.props['data-episode-hero-state'], 'preview', 'High-resolution failure retains usable low-resolution pixels');
    tree.props.children[0].props.onError(); assert.equal(failed.render().type, 'placeholder'); failed.h.unmount();

    const cachedErrors = mount(); tree = cachedErrors.render();
    tree.props.children[0].props.ref({ complete: true, naturalWidth: 0 });
    tree.props.children[1].props.ref({ complete: true, naturalWidth: 0 });
    assert.equal(cachedErrors.render().type, 'placeholder', 'Cached failures before hydration cannot leave broken pixels or a permanent loading state');
    cachedErrors.h.unmount();

    const abandoned = mount(); tree = abandoned.render(); const pending = deferred();
    const old = { complete: false, naturalWidth: 1280, decode: () => pending.promise };
    tree.props.children[1].props.ref(old); tree.props.children[1].props.onLoad({ currentTarget: old });
    tree.props.children[1].props.ref(null); abandoned.h.unmount(); const before = abandoned.h.updates;
    pending.resolve(); await tick(); assert.equal(abandoned.h.updates, before, 'Late decoding cannot reveal the previous episode');
    const css = fs.readFileSync('components/progressive-episode-still.module.css', 'utf8');
    assert.match(css, /transition: opacity 150ms var\(--ease-out\)/);
    assert.match(css, /prefers-reduced-motion: reduce[\s\S]*transition: none/);
    console.log('PASS: separate hero URLs, decoded progressive replacement, instant warm hits, high-resolution fallback, stale decode isolation and reduced motion.');
})().catch(error => { console.error(error); process.exitCode = 1; });
