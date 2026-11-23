import "server-only";
import { cache } from "react";
import { cinemetaCatalog, cinemetaSearch } from "@/lib/cinemeta";
import { getTMDBHomeRows, searchTMDBCatalog } from "@/lib/tmdb-discovery";
import { getTMDBToken } from "@/lib/tmdb-credentials";
import type { HomeCatalogResult, InitialHomeCatalog } from "@/lib/home-catalogs";

export const hasTMDBDiscovery = cache(async () => Boolean(await getTMDBToken()));

export function cinemetaHomeRows(only?: ReadonlySet<string>, signal?: AbortSignal): InitialHomeCatalog[] {
    return (["movie", "series"] as const).flatMap(type => {
        const key = `cinemeta-${type}`;
        if (only && !only.has(key)) return [];
        const sectionName = type === "movie" ? "Popular Movies" : "Popular TV Shows";
        const result = cinemetaCatalog(type, undefined, signal).then((items): HomeCatalogResult => ({
            status: "ready", section: { key, sectionName, mediaItems: items.slice(0, 20) },
        })).catch((): HomeCatalogResult => ({ status: "error" }));
        return [{ key, sectionName, retry: { feed: key }, result }];
    });
}

export async function discoveryHomeFeed(feed: string, signal: AbortSignal) {
    const selected = new Set([feed]);
    if (feed.startsWith("cinemeta-")) return cinemetaHomeRows(selected, signal)[0];
    if (await hasTMDBDiscovery()) return getTMDBHomeRows(selected, signal).rows[0];
}

export async function searchDiscovery(query: string, signal?: AbortSignal, type?: "movie" | "series" | "person", page = 1) {
    if (await hasTMDBDiscovery()) {
        return { ...await searchTMDBCatalog(query, signal, type, page), provider: "TMDB" as const };
    }
    const types = type ? [type] : ["movie", "series"] as const;
    const batches = query.trim() && type !== "person" && page === 1
        ? await Promise.all(types.map(kind => kind === "person" ? [] : signal
            ? cinemetaCatalog(kind, query.trim(), signal)
            : cinemetaSearch(kind, query.trim())))
        : [];
    const results = batches.flat();
    return { results, page, totalPages: results.length ? 1 : 0, totalResults: results.length, provider: "Cinemeta" as const };
}
