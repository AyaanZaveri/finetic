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
const { ContentRatingBadge } = load('components/media-page/content-rating-badge.tsx', dependencies);
const { RottenTomatoesRatingBadge } = load('components/media-page/rotten-tomatoes-rating-badge.tsx', dependencies);
dependencies['@/components/media-page/media-rating-badge'] = { MediaRatingBadge };
dependencies['@/components/media-page/content-rating-badge'] = { ContentRatingBadge };
dependencies['@/components/media-page/rotten-tomatoes-rating-badge'] = { RottenTomatoesRatingBadge };
const title = { id: 'tmdb:123', name: 'Public title', type: 'movie', communityRating: 8.26, ratingSource: 'TMDB', voteCount: 1234,
    contentRating: { value: 'PG-13', region: 'US' }, rottenTomatoesRating: 93 };
const show = { ...title, type: 'series', contentRating: { value: 'TV-14', region: 'US' } };
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
    assert.equal([badge.props.children[1].props.children].flat().join(''), 'TMDB 8.3');
}
function assertCertification(node, value) {
    const badge = find(node, ContentRatingBadge);
    assert.ok(badge, 'The detail page must render its age rating');
    assert.equal(ContentRatingBadge(badge.props).props.children, value);
    assert.equal(ContentRatingBadge(badge.props).props.variant, 'outline');
    const critic = find(node, RottenTomatoesRatingBadge);
    assert.ok(critic, 'The detail page includes its critic rating');
    assert.equal(RottenTomatoesRatingBadge(critic.props).props['aria-label'], 'Rotten Tomatoes critics: 93%');
}
async function main() {
    const companyCalls = [];
    const companies = [{ id: 11073, name: 'Sony Pictures Television', logo: 'https://image.tmdb.org/t/p/w300/sony.png' }];
    const movieDeps = { ...dependencies,
        '@/app/actions': { fetchMediaDetails: async () => title },
        '@/lib/tmdb-discovery': {
            getTMDBMovieCollection: async () => null,
            getTMDBProductionCompanies: async (id, type) => { companyCalls.push({ id, type }); return companies; },
        },
        '@/components/media-page/movie-collection-section': { MovieCollectionSection: 'movie-collection' },
        '@/components/media-page/production-companies-section': { ProductionCompaniesSection: 'production-companies' },
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
    assertCertification(movieView.MovieDetailsView(movieProps), 'PG-13');
    const movieCompanies = movieProps.companies.props.children;
    assert.equal(movieProps.companies.type, 'suspense', 'Movie company lookup must not block detail rendering');
    assert.equal((await movieCompanies.type(movieCompanies.props)).props.companies, companies);
    assert.deepEqual(companyCalls.at(-1), { id: title.id, type: 'movie' });
    const series = load('app/(main)/series/[id]/page.tsx', {
        ...movieDeps, './_shared/series-data': { getSeriesLayoutData: async () => ({ show, regularSeasonCount: 2 }) },
    });
    const seriesPage = await series.default({ params: Promise.resolve({ id: title.id }) });
    const seriesView = load('components/media-page/series-overview-view.tsx', movieDeps);
    assertTMDB(seriesView.SeriesOverviewView(seriesPage.props));
    assertCertification(seriesView.SeriesOverviewView(seriesPage.props), 'TV-14');
    const layoutDeps = {
        ...movieDeps,
        './_shared/series-data': { getSeriesLayoutData: async () => ({ show: { ...show, id: 'tt20', tmdbId: 20 }, regularSeasonCount: 2 }) },
        '@/components/series-episodes-route-aware': { SeriesEpisodesRouteAware: 'episodes' },
        '@/components/series-overview-playback': { SeriesOverviewPlaybackProvider: 'series-playback' },
        '@/components/episode-streams-route-aware': { EpisodeStreamsRouteAware: 'streams' },
    };
    const { default: SeriesLayout } = load('app/(main)/series/[id]/layout.tsx', layoutDeps);
    const layout = await SeriesLayout({ params: Promise.resolve({ id: 'tt20' }), children: seriesPage });
    const frame = layout.props.children;
    const tvCompanies = frame.props.companies.props.children;
    assert.equal(frame.props.companies.type, 'suspense', 'Show company lookup must not block detail rendering');
    assert.equal((await tvCompanies.type(tvCompanies.props)).props.companies, companies);
    assert.deepEqual(companyCalls.at(-1), { id: 'tmdb:20', type: 'series' });
    const frameTree = frame.type(frame.props);
    const sections = frameTree.props.children;
    assert.ok(sections.indexOf(frame.props.cast) < sections.indexOf(frame.props.companies));
    assert.ok(sections.indexOf(frame.props.companies) < sections.indexOf(frame.props.recommendations));

    const episode = load('components/media-page/episode-details-view.tsx', {
        ...dependencies, './detail-artwork.module.css': {}, './media-rating-badge': { MediaRatingBadge }, './content-rating-badge': { ContentRatingBadge },
        './rotten-tomatoes-rating-badge': { RottenTomatoesRatingBadge },
    });
    const episodeView = episode.EpisodeDetailsView({ showName: title.name, title: 'Pilot', seasonNumber: 1, episodeNumber: 1, ratingMedia: show });
    assertTMDB(episodeView);
    assertCertification(episodeView, 'TV-14');
    assert.equal(find(episodeView, ContentRatingBadge).props.series, true);
    const imdbBadge = MediaRatingBadge({ media: { imdbRating: '7.9', ...title } });
    assert.equal(imdbBadge.props['aria-label'], 'IMDb 7.9 out of 10', 'IMDb ratings keep their source and never inherit TMDB vote counts');
    assert.equal(imdbBadge.props.children[0].props.children[0].props.src, '/logo/imdb-black.svg');
    assert.equal(imdbBadge.props.children[0].props.children[1].props.src, '/logo/imdb-gold.svg');
    assert.equal(imdbBadge.props.children[1].props.children, '7.9');
    assert.equal(MediaRatingBadge({ media: { imdbRating: 'N/A', ...title } }).props['aria-label'], 'TMDB 8.3 out of 10, 1,234 votes');
    for (const score of [undefined, 0, NaN, Infinity, -1, 11]) assert.equal(MediaRatingBadge({ media: { communityRating: score } }), null);
    for (const score of [undefined, NaN, -1, 101, 1.5]) assert.equal(RottenTomatoesRatingBadge({ score }), null);
    assert.equal(RottenTomatoesRatingBadge({ score: 0 }).props['aria-label'], 'Rotten Tomatoes critics: 0%');
    assert.equal(RottenTomatoesRatingBadge({ score: 59 }).props.children[0].props.src, '/logo/tomatometer-rotten.svg');
    assert.equal(RottenTomatoesRatingBadge({ score: 60 }).props.children[0].props.src, '/logo/tomatometer-fresh.svg');
    console.log('PASS: guest movie, series and episode pages display sourced TMDB ratings; IMDb and unrated titles remain accurate.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
