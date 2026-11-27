// Native WKWebView regression check: actual React card markup + Tailwind CSS.
// Uses local images only; starts no server and does not access a user profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { compile } = require('@tailwindcss/node');

async function run() {
    if (process.platform !== 'darwin') {
        console.log('SKIP: image layout regression requires macOS WKWebView.');
        return;
    }
    const root = path.resolve(__dirname, '..');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'navigator-image-layout-'));
    const image = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'app/icon1.png')).toString('base64');
    const passthrough = ({ children }) => React.createElement('div', null, children);
    function load(file) {
        const context = { exports: {}, URL, URLSearchParams, require(name) {
            if (name.endsWith('.module.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
            if (name === 'next/link') return ({ children, prefetch, scroll, ...props }) => React.createElement('a', props, children);
            if (name === '@/components/intent-link') return { IntentLink: ({ children, ...props }) => React.createElement('a', props, children) };
            if (name === 'next/navigation') return { useRouter: () => ({ push() {} }) };
            if (name === '@/contexts/MediaPlayerContext') return { usePlaybackActions: () => ({}) };
            if (name === '@/lib/preload-tools') return { preloadPlayer() {} };
            if (name === '@/components/continue-watching-warmup') return { useContinueWatchingWarmup: () => null };
            if (name === '@/components/home-palette-provider') return { useHomePaletteScene: () => null };
            if (name === '@/lib/media/series-season') return {};
            if (name === '@/lib/artwork') return { mediaArtwork: () => ({ poster: image, background: image }), episodeThumbnailUrl: value => value, backdropVariantUrl: value => value, episodeHeroStillUrl: value => value, detailPosterUrl: value => value };
            if (name === '@/components/metadata-preload') return { useMetadataIntent: () => ({ start() {}, cancel() {} }), useSeasonMetadataIntent: () => () => {} };
            if (name === '@/lib/series-route') return { buildEpisodePath: () => '/series/fixture/1/1' };
            if (name === './ui/scroll-area') return { ScrollArea: passthrough, ScrollBar: () => null };
            if (name.startsWith('@/app/actions')) return {};
            if (name === '@/components/artwork-image') return load('components/artwork-image.tsx');
            if (name === '@/lib/utils') return { cn: (...values) => values.filter(Boolean).join(' ') };
            if (name.startsWith('@/components/')) return new Proxy({}, { get: () => passthrough });
            return require(name);
        }};
        vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
            fileName: file,
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
        }).outputText, context);
        return context.exports;
    }
    const { MediaCard } = load('components/media-card.tsx');
    const { EpisodeCard } = load('components/episode-card.tsx');
    const { SeasonEpisodes } = load('components/season-episodes.tsx');
    const { EpisodeHeroThumbnail } = load('components/episode-hero-thumbnail.tsx');
    const { PosterImage } = load('components/media-page/poster-image.tsx');
    const item = { id: 'tt123', name: 'Fixture', type: 'movie' };
    const episode = { id: 'tt123:1:1', season: 1, episode: 1, title: 'Fixture', thumbnail: image };
    const cases = [
        ['home poster', React.createElement(MediaCard, { item })],
        ['full-width poster', React.createElement(MediaCard, { item, fullWidth: true })],
        ['continue watching', React.createElement(MediaCard, { item, continueWatching: true })],
        ['episode card', React.createElement(EpisodeCard, { episode, seriesId: 'tt123' })],
        ['season episode', React.createElement(SeasonEpisodes, { showId: 'tt123', prefetchedVideos: [episode] })],
        ['episode hero', React.createElement('div', { className: 'relative aspect-video w-full' }, React.createElement(EpisodeHeroThumbnail, { thumbnail: image, title: 'Fixture' }))],
        ['detail poster', React.createElement('div', { className: 'aspect-square w-full' }, React.createElement(PosterImage, { posterImage: image, name: 'Fixture' }))],
    ];
    // Hidden test windows do not trigger lazy images on older WebKit versions.
    // Loading behavior is separate from the card geometry being exercised.
    const markup = cases.map(([name, element]) => `<section data-case="${name}" style="width:288px">${renderToStaticMarkup(element)}</section>`).join('').replaceAll('loading="lazy"', 'loading="eager"');
    const candidates = [...markup.matchAll(/class="([^"]+)"/g)].flatMap(match => match[1].split(/\s+/));
    const compiler = await compile('@import "tailwindcss";', { base: root, onDependency() {} });
    const html = path.join(temporary, 'cards.html');
    fs.writeFileSync(html, `<style>${compiler.build(candidates)}</style>${markup}`);
    const executable = path.join(temporary, 'layout-check');
    try {
        execFileSync('clang', ['-fobjc-arc', '-framework', 'Cocoa', '-framework', 'WebKit', path.join(__dirname, 'webkit-image-layout.m'), '-o', executable]);
        const measurements = JSON.parse(execFileSync(executable, [html], { encoding: 'utf8', timeout: 30000 }));
        assert.equal(measurements.length, cases.length);
        for (const result of measurements) {
            assert.ok(result.natural.width > 0, `${result.name}: local fixture must load`);
            assert.ok(result.frame.width > 0 && result.frame.height > 0, `${result.name}: frame must have size`);
            assert.ok(Math.abs(result.frame.width - result.image.width) <= 1 && Math.abs(result.frame.height - result.image.height) <= 1,
                `${result.name}: image ${result.image.width}×${result.image.height} overflows frame ${result.frame.width}×${result.frame.height}`);
            console.log(`PASS: ${result.name} image fits ${result.frame.width}×${result.frame.height} in WKWebView`);
        }
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
