export const groups = [
    { title: "Movie", states: [
        { id: "ready", label: "Full movie" },
        { id: "loading", label: "Loading" },
        { id: "not-found", label: "Movie not found" },
        { id: "error", label: "Load failure" },
    ] },
    { title: "TV show · Pluribus", states: [
        { id: "series-ready", label: "Full TV show" },
        { id: "series-guest", label: "TV show · Signed out" },
        { id: "series-resume", label: "TV show · Resume episode" },
        { id: "series-no-logo", label: "TV show · No title artwork" },
        { id: "series-no-backdrop", label: "TV show · No backdrop" },
        { id: "series-no-artwork", label: "TV show · No artwork" },
        { id: "series-episodes-loading", label: "TV show · Episodes loading" },
        { id: "series-episodes-empty", label: "TV show · No episodes" },
    ] },
    { title: "Account", states: [
        { id: "guest", label: "Signed out" },
        { id: "resume", label: "Resume movie" },
        { id: "watched", label: "Watched movie" },
    ] },
    { title: "Artwork", states: [
        { id: "no-logo", label: "No title artwork" },
        { id: "no-backdrop", label: "No backdrop" },
        { id: "no-poster", label: "No poster" },
        { id: "no-artwork", label: "No artwork" },
    ] },
    { title: "Details", states: [
        { id: "no-rating", label: "No rating" },
        { id: "partial-details", label: "Incomplete metadata" },
        { id: "no-cast", label: "No cast" },
        { id: "cast-loading", label: "Cast pending" },
    ] },
    { title: "Recommendations", states: [
        { id: "recommendations-loading", label: "Loading" },
        { id: "recommendations-empty", label: "Empty" },
    ] },
] as const;

export type StateId = typeof groups[number]["states"][number]["id"];
export const states: ReadonlyArray<{id: StateId; label: string}> = groups.flatMap(group => [...group.states]);
export function readState(value: string | null): StateId {
    return states.find(state => state.id === value)?.id ?? "ready";
}
