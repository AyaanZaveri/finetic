export const groups = [
    {
        title: "Data",
        states: [
            { id: "featured-set", label: "Featured carousel" },
            { id: "single-title", label: "Single title" },
            { id: "minimal-metadata", label: "Minimal metadata" },
            { id: "long-synopsis", label: "Long title & synopsis" },
            { id: "empty", label: "No hero (empty)" },
        ],
    },
    {
        title: "Artwork",
        states: [
            { id: "series-wordmark", label: "TV show wordmark" },
            { id: "no-logo", label: "Text fallback (no logo)" },
            { id: "broken-logo", label: "Broken logo fallback" },
        ],
    },
    {
        title: "Account",
        states: [
            { id: "guest", label: "Signed out (guest)" },
        ],
    },
] as const;

export type StateId = typeof groups[number]["states"][number]["id"];
export const states: ReadonlyArray<{ id: StateId; label: string }> = groups.flatMap(group => [...group.states]);

export function readState(value: string | null): StateId {
    return states.find(state => state.id === value)?.id ?? "featured-set";
}
