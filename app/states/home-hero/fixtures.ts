import type { HomeCatalogSection } from "@/lib/home-catalogs";
import type { HomeHeroItem } from "@/lib/home-hero";
import type { MediaItem } from "@/types/stremio";
import movieData from "@/app/states/movie-detail/movie.json";
import seriesData from "@/app/states/movie-detail/pluribus.json";
import type { StateId } from "./states";

export interface HomeHeroPublicData {
    heroItems: HomeHeroItem[];
    sections: HomeCatalogSection[];
}

const fallbackMovie: HomeHeroItem = {
    id: movieData.movie.id,
    type: "movie",
    name: movieData.movie.name,
    description: movieData.movie.description,
    year: movieData.movie.year,
    poster: movieData.movie.poster,
    background: movieData.movie.background,
    logo: movieData.movie.logo,
    communityRating: movieData.movie.communityRating,
    ratingSource: movieData.movie.ratingSource,
    voteCount: movieData.movie.voteCount,
    runtime: movieData.movie.runtime,
    genres: [...movieData.movie.genres],
};

const fallbackSeries: HomeHeroItem = {
    id: seriesData.show.id,
    type: "series",
    name: seriesData.show.name,
    description: seriesData.show.description,
    year: seriesData.show.year,
    releaseInfo: seriesData.show.releaseInfo,
    poster: seriesData.show.poster,
    background: seriesData.show.background,
    logo: seriesData.show.logo,
    communityRating: seriesData.show.communityRating,
    ratingSource: seriesData.show.ratingSource,
    voteCount: seriesData.show.voteCount,
    genres: [...seriesData.show.genres],
};

const fallbackHeroItems: HomeHeroItem[] = [
    fallbackMovie,
    fallbackSeries,
    ...movieData.recommendations.slice(0, 2).map(item => ({ ...item, type: "movie" as const })),
    ...seriesData.recommendations.slice(0, 2).map(item => ({ ...item, type: "series" as const })),
];

const fallbackSections: HomeCatalogSection[] = [
    {
        key: "fallback-movies",
        sectionName: "Trending movies",
        mediaItems: [fallbackMovie, ...movieData.recommendations.slice(0, 9).map(item => ({ ...item, type: "movie" as const }))],
    },
    {
        key: "fallback-series",
        sectionName: "Trending TV shows",
        mediaItems: [fallbackSeries, ...seriesData.recommendations.slice(0, 9).map(item => ({ ...item, type: "series" as const }))],
    },
];

const CONTINUE_WATCHING_PROGRESS = [42, 68, 24, 83];

export function resolveWorkbenchCatalogs(publicData?: HomeHeroPublicData): {
    heroItems: HomeHeroItem[];
    sections: HomeCatalogSection[];
    continueWatching: MediaItem[];
} {
    const heroItems = publicData?.heroItems.length ? publicData.heroItems : fallbackHeroItems;
    const sections = publicData?.sections.length ? publicData.sections : fallbackSections;
    const continueWatching: MediaItem[] = heroItems.slice(0, 4).map((item, index) => {
        const progressPercent = CONTINUE_WATCHING_PROGRESS[index % CONTINUE_WATCHING_PROGRESS.length];
        if (item.type === "series") {
            const seasonNumber = 1;
            const episodeNumber = index + 2;
            return {
                ...item,
                progressPercent,
                progressLabel: `S${seasonNumber} • E${episodeNumber}`,
                seasonNumber,
                episodeNumber,
                mediaSourceId: `${item.id}:${seasonNumber}:${episodeNumber}`,
                seriesId: item.id,
                showName: item.name,
            };
        }
        return {
            ...item,
            progressPercent,
            resumePositionTicks: 2400 + index * 900,
        };
    });

    return { heroItems, sections, continueWatching };
}

export function heroFixture(
    id: StateId,
    publicData?: HomeHeroPublicData,
): {
    items: HomeHeroItem[];
    authenticated: boolean;
} {
    const { heroItems } = resolveWorkbenchCatalogs(publicData);
    const primary = heroItems[0] ?? fallbackMovie;
    const secondary = heroItems[1] ?? fallbackSeries;
    const firstSeries = heroItems.find(item => item.type === "series") ?? fallbackSeries;
    const restAfterSeries = heroItems.filter(item => !(item.type === firstSeries.type && item.id === firstSeries.id));

    switch (id) {
    case "featured-set":
        return { items: heroItems, authenticated: true };
    case "single-title":
        return { items: [primary], authenticated: true };
    case "empty":
        return { items: [], authenticated: true };
    case "minimal-metadata":
        return {
            items: [
                {
                    id: primary.id,
                    type: primary.type,
                    name: primary.name,
                    background: primary.background,
                    poster: primary.poster,
                },
            ],
            authenticated: true,
        };
    case "long-synopsis":
        return {
            items: [
                {
                    ...primary,
                    name: `${primary.name}: Extended Collector's Edition`,
                    logo: undefined,
                    description:
                        primary.description && primary.description.length > 180
                            ? primary.description
                            : `${primary.description ? `${primary.description} ` : ""}When every alliance breaks down under pressure, the remaining crew must trace a buried trail across three cities before the final deadline closes in and reshapes everything they thought they knew.`,
                },
                secondary,
            ],
            authenticated: true,
        };
    case "series-wordmark":
        return { items: [firstSeries, ...restAfterSeries], authenticated: true };
    case "no-logo":
        return {
            items: [
                { ...primary, logo: undefined },
                { ...secondary, logo: undefined },
            ],
            authenticated: true,
        };
    case "broken-logo":
        return {
            items: [
                {
                    ...primary,
                    logo: "https://image.tmdb.org/t/p/original/missing-wordmark-fixture-404.png",
                },
                secondary,
            ],
            authenticated: true,
        };
    case "guest":
        return { items: heroItems, authenticated: false };
    }
}
