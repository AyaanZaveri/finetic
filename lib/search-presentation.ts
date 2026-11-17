import type { MediaItem } from "@/types/stremio";

export type SearchMediaFilter = "all" | "movie" | "series" | "person";

export interface SearchPersonItem {
    id: string;
    type: "person";
    name: string;
    poster?: string;
    department?: string;
    knownFor: string[];
}

export interface SearchResultPage {
    results: (MediaItem | SearchPersonItem)[];
    totalPages: number;
    totalResults: number;
}

export interface SearchResultSet {
    page: number;
    all: SearchResultPage;
    movie: SearchResultPage;
    series: SearchResultPage;
    person: SearchResultPage;
}

export function searchMediaFilter(value?: string): SearchMediaFilter {
    return value === "movie" || value === "series" || value === "person" ? value : "all";
}

export function searchPageUrl(query: string, filter: SearchMediaFilter = "all") {
    const params = new URLSearchParams({ q: query });
    if (filter !== "all") params.set("type", filter);
    return `/search?${params}`;
}
