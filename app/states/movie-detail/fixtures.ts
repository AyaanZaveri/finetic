import type { MediaItem } from "@/types/stremio";
import type { CastMember } from "@/lib/cast";
import data from "./movie.json";
import pluribus from "./pluribus.json";
import type { StateId } from "./states";

export function fixture(id: StateId) {
    const movie: MediaItem = { ...data.movie, type: "movie" };
    if (id === "no-logo" || id === "no-artwork") delete movie.logo;
    if (id === "no-backdrop" || id === "no-artwork") delete movie.background;
    if (id === "no-poster" || id === "no-artwork") delete movie.poster;
    if (id === "no-rating") {
        delete movie.communityRating;
        delete movie.voteCount;
    }
    if (id === "partial-details") {
        delete movie.runtime;
        delete movie.year;
        delete movie.description;
        delete movie.genres;
        delete movie.director;
        delete movie.writer;
    }
    const cast: CastMember[] = id === "no-cast" || id === "cast-loading" ? [] : data.cast;
    const recommendations: MediaItem[] = id === "recommendations-empty" ? [] :
        data.recommendations.map(item => ({ ...item, type: "movie" }));
    return { movie, cast, recommendations };
}


import type { WatchHistoryRequest, WatchStatusInput } from "@/lib/watch-history";

export function seriesFixture(id: StateId) {
    const show: MediaItem = { ...pluribus.show, type: "series" };
    if (id === "series-no-logo" || id === "series-no-artwork") delete show.logo;
    if (id === "series-no-backdrop" || id === "series-no-artwork") delete show.background;
    if (id === "series-no-artwork") delete show.poster;
    return {
        show,
        cast: pluribus.cast as CastMember[],
        recommendations: pluribus.recommendations.map(item => ({ ...item, type: "series" as const })),
        regularSeasonCount: show.seasons?.filter(season => season.number > 0).length ?? 0,
        episodes: id === "series-episodes-empty" ? [] : show.videos,
    };
}

export function accountFixture(id: StateId) {
    const overrides = new Map<string, boolean>();
    return {
        progress: id === "series-resume"
            ? { resumePositionTicks: 1100, totalDuration: 3000, videoId: pluribus.show.videos[2].id, progressPercent: 37 }
            : id === "resume" ? { resumePositionTicks: 2532, totalDuration: 8700, videoId: data.movie.id } : null,
        fetchItems: async (requests: WatchHistoryRequest[]) => Object.fromEntries(requests.map(item => [
            `${item.type}:${item.id}`, {
                movieWatched: overrides.get(item.id) ?? (item.id === data.movie.id && id === "watched"),
                watchedEpisodeIds: [],
            },
        ])),
        saveStatus: async (input: WatchStatusInput) => {
            overrides.set(input.id, input.watched);
            return { movieWatched: input.watched, watchedEpisodeIds: [] };
        },
    };
}
