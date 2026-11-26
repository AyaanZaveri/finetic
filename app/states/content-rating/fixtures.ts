import type { MediaItem, StremioVideo } from "@/types/stremio";
import type { WatchHistoryRequest, WatchStatusInput } from "@/lib/watch-history";

export const groups = [
    { id: "movie", title: "Movie details", states: [
        { id: "movie-rated", label: "PG-13 · IMDb" },
        { id: "movie-critics", label: "IMDb + Rotten Tomatoes" },
        { id: "movie-rotten", label: "Rotten score (mock)" },
        { id: "movie-tmdb", label: "TMDB fallback" },
        { id: "movie-unavailable", label: "Age rating unavailable" },
    ] },
    { id: "series", title: "Series details", states: [
        { id: "series-rated", label: "TV-MA · IMDb" },
        { id: "series-critics", label: "IMDb + Rotten Tomatoes" },
        { id: "series-unavailable", label: "Age rating unavailable" },
    ] },
    { id: "episode", title: "Episode details", states: [
        { id: "episode-rated", label: "TV-MA · IMDb" },
        { id: "episode-critics", label: "IMDb + Rotten Tomatoes" },
        { id: "episode-unavailable", label: "Age rating unavailable" },
    ] },
] as const;

export type StateId = typeof groups[number]["states"][number]["id"];
export const states: ReadonlyArray<{ id: StateId; label: string }> = groups.flatMap(group => [...group.states]);
export const readState = (value: string | null): StateId => states.find(state => state.id === value)?.id ?? "movie-rated";

const movie: MediaItem = {
    id: "tmdb:812583", imdbId: "tt14364480", tmdbId: 812583, type: "movie",
    name: "Wake Up Dead Man: A Knives Out Mystery", year: 2025, runtime: "145 min",
    description: "When young priest Jud Duplenticy is sent to assist charismatic firebrand Monsignor Jefferson Wicks, it’s clear that all is not well in the pews. Detective Benoit Blanc investigates a seemingly impossible murder.",
    poster: "https://image.tmdb.org/t/p/w500/iV9LM8aUb83BjCCx2RUnKE5sSQg.jpg",
    background: "https://image.tmdb.org/t/p/w1280/fiRDzpcJe7qz3yIR43hdXIE3NHv.jpg",
    logo: "https://image.tmdb.org/t/p/original/cT7ZcQDZqY0gGRLfevRXR5baEha.png",
    imdbRating: "7.3", communityRating: 7.213, ratingSource: "TMDB", voteCount: 3129,
    contentRating: { value: "PG-13", region: "US" },
    genres: ["Thriller", "Mystery", "Comedy"], director: ["Rian Johnson"], writer: ["Rian Johnson"],
};

export const episode: StremioVideo = {
    id: "tmdb:225171:1:1", title: "We Is Us", season: 1, episode: 1,
    overview: "An astronomer's discovery turns the planet upside down. Carol Sturka, a curmudgeonly novelist, is terrified by this strange new world.",
    released: "2025-11-06",
    thumbnail: "https://image.tmdb.org/t/p/w780/5abqAAPKjFDqmNwLb0sCtGlS8aj.jpg",
    runtime: 57,
};

const show: MediaItem = {
    id: "tmdb:225171", imdbId: "tt22202452", tmdbId: 225171, type: "series",
    name: "Pluribus", year: 2025, releaseInfo: "2025-11-06",
    description: "The most miserable person on Earth must save the world from happiness.",
    poster: "https://image.tmdb.org/t/p/w500/z7Nga7Q9IGFWs5OEduY2gGFxnX3.jpg",
    background: "https://image.tmdb.org/t/p/w1280/ulm1ex4JFYJByyaPyqTr47MFyEQ.jpg",
    logo: "https://image.tmdb.org/t/p/original/qUMaG3ZB32GXtXMMjz7pkxehz26.png",
    imdbRating: "7.9", communityRating: 7.9, ratingSource: "TMDB", voteCount: 1225,
    contentRating: { value: "TV-MA", region: "US" },
    genres: ["Drama", "Sci-Fi & Fantasy"],
    seasons: [{ number: 1, name: "Season 1", episodeCount: 9 }],
    videos: [episode],
};

export function fixture(id: StateId): MediaItem {
    const title = id.startsWith("movie-") ? movie : show;
    return {
        ...title,
        contentRating: id.endsWith("-unavailable") ? undefined : title.contentRating,
        imdbRating: id === "movie-tmdb" ? undefined : title.imdbRating,
        // Mock critic scores are independent of the configured MDBList key.
        rottenTomatoesRating: id === "movie-rotten" ? 42 : id.endsWith("-critics") ? title.type === "movie" ? 93 : 98 : undefined,
    };
}

export function watchHistoryFixture() {
    const watched = new Map<string, boolean>();
    return {
        fetchItems: async (requests: WatchHistoryRequest[]) => Object.fromEntries(requests.map(request => [
            `${request.type}:${request.id}`, { movieWatched: watched.get(request.id) ?? false, watchedEpisodeIds: [] },
        ])),
        saveStatus: async (input: WatchStatusInput) => {
            watched.set(input.id, input.watched);
            return { movieWatched: input.watched, watchedEpisodeIds: [] };
        },
    };
}
