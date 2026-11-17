import type { SearchResult } from "@/types/stremio";

/** Select the strongest matches first, then group that shortlist. The first
 * occurrence of each type determines its position; never fill category quotas
 * with weaker matches from further down TMDB's ranking. */
export function groupSearchSuggestions(results: SearchResult[], limit = 6): SearchResult[] {
    const seen = new Set<string>();
    const groups = new Map<string, SearchResult[]>();
    let count = 0;
    for (const item of results) {
        if (count >= limit) break;
        if (!["movie", "series", "person"].includes(item.type)) continue;
        const key = `${item.type}:${item.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const group = groups.get(item.type) || [];
        group.push(item);
        groups.set(item.type, group);
        count++;
    }
    return [...groups.values()].flat();
}
