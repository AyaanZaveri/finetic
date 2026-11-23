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
    const trimmed = query.trim();
    const types: ("movie" | "series")[] = type === "person" || page !== 1 || !trimmed ? []
        : type ? [type] : ["movie", "series"];
    const [primary = [], secondary = []] = await Promise.all(types.map(kind => signal
        ? cinemetaCatalog(kind, trimmed, signal)
        : cinemetaSearch(kind, trimmed)));
    // Cinemeta ranks each catalog independently. Keep the top match from
    // both catalogs in the shortlist so movie hits don't crowd out TV shows.
    const results = [];
    for (let index = 0; index < Math.max(primary.length, secondary.length); index++) {
        if (primary[index]) results.push(primary[index]);
        if (secondary[index]) results.push(secondary[index]);
    }
    return { results, page, totalPages: results.length ? 1 : 0, totalResults: results.length, provider: "Cinemeta" as const };
}
