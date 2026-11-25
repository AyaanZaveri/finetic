const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const h = hooks();
const dependencies = {
    'react/jsx-runtime': h.jsx,
    react: { Suspense: 'suspense' },
    'next/navigation': { redirect: () => { throw Error('Unexpected redirect'); } },
    'next/link': { default: 'link' },
    'lucide-react': { Star: 'star', TvIcon: 'tv' },
    '@/components/ui/badge': { Badge: 'badge' },
};
const { MediaRatingBadge } = load('components/media-page/media-rating-badge.tsx', dependencies);
dependencies['@/components/media-page/media-rating-badge'] = { MediaRatingBadge };
const title = { id: 'tmdb:123', name: 'Public title', type: 'movie', communityRating: 8.26, ratingSource: 'TMDB', voteCount: 1234 };
function find(node, type) {
    if (!node || typeof node !== 'object') return;
    if (node.type === type) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
        const found = find(child, type);
        if (found) return found;
    }
}
function assertTMDB(node) {
    const component = find(node, MediaRatingBadge);
    assert.ok(component, 'The detail page must render its public rating');
    const badge = MediaRatingBadge(component.props);
    assert.equal(badge.props['aria-label'], 'TMDB 8.3 out of 10, 1,234 votes');
    assert.equal(badge.props.children[1].props.children.join(''), 'TMDB 8.3');
}
async function main() {
    const movieDeps = { ...dependencies,
        '@/app/actions': { fetchMediaDetails: async () => title },
        '@/components/media-page/backdrop-transition.module.css': {},
        '@/components/media-page/title-detail.module.css': {},
        '@/components/media-page/title-synopsis': { TitleSynopsis: 'synopsis' },
    };
    for (const [module, name] of [
        ['playback-page-provider', 'PlaybackPageProvider'], ['media-actions', 'MediaActions'],
        ['media-section', 'MediaSection'], ['ui/skeleton', 'Skeleton'],
        ['vibrant-aurora-background', 'VibrantAuroraBackground'], ['hero-wordmark', 'HeroWordmark'],
        ['media-page/backdrop-transition', 'BackdropTransition'], ['media-page/cast-section', 'CastSection'],
        ['media-page/backdrop-image', 'BackdropImage'], ['media-page/poster-image', 'PosterImage'],
        ['media-page/play-button', 'MediaPlayButton'],
    ]) movieDeps[`@/components/${module}`] = { [name]: name };
    const movie = load('app/(main)/movie/[id]/page.tsx', movieDeps);
    const movieView = load('components/media-page/movie-details-view.tsx', movieDeps);
    const page = await movie.default({ params: Promise.resolve({ id: title.id }) });
    const movieProps = page.props.children.props;
    assert.equal(movieProps.movie, title);
    assertTMDB(movieView.MovieDetailsView(movieProps));
    const series = load('app/(main)/series/[id]/page.tsx', {
        ...movieDeps, './_shared/series-data': { getSeriesLayoutData: async () => ({ show: { ...title, type: 'series' }, regularSeasonCount: 2 }) },
    });
    const seriesPage = await series.default({ params: Promise.resolve({ id: title.id }) });
    const seriesView = load('components/media-page/series-overview-view.tsx', movieDeps);
    assertTMDB(seriesView.SeriesOverviewView(seriesPage.props));
    const episode = load('components/media-page/episode-details-view.tsx', {
        ...dependencies, './detail-artwork.module.css': {}, './media-rating-badge': { MediaRatingBadge },
    });
    assertTMDB(episode.EpisodeDetailsView({ showName: title.name, title: 'Pilot', seasonNumber: 1, episodeNumber: 1, ratingMedia: title }));
    assert.equal(MediaRatingBadge({ media: { imdbRating: '7.9', ...title } }).props['aria-label'], 'IMDb 7.9 out of 10', 'IMDb ratings keep their source and never inherit TMDB vote counts');
    assert.equal(MediaRatingBadge({ media: { imdbRating: 'N/A', ...title } }).props['aria-label'], 'TMDB 8.3 out of 10, 1,234 votes');
    for (const score of [undefined, 0, NaN, Infinity, -1, 11]) assert.equal(MediaRatingBadge({ media: { communityRating: score } }), null);
    console.log('PASS: guest movie, series and episode pages display sourced TMDB ratings; IMDb and unrated titles remain accurate.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
