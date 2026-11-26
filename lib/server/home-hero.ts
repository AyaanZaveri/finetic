import "server-only";

import { cinemetaTitleArtwork, publicArtworkUrl } from "@/lib/artwork";
import { selectHomeHeroItems, type HomeHeroItem } from "@/lib/home-hero";
import { cinemetaCatalog } from "@/lib/cinemeta";
import { hasTMDBDiscovery } from "@/lib/discovery";
import { getTMDBFeaturedTitles } from "@/lib/tmdb-discovery";
import type { MetadataProvider } from "@/lib/server/metadata-provider";
import { getTMDBArtwork } from "@/lib/tmdb-artwork";

const HERO_LOGO_TIMEOUT_MS = 1600;

async function resolveHeroLogo(
    item: HomeHeroItem,
    provider: MetadataProvider,
): Promise<string | undefined> {
    const existing = publicArtworkUrl(item.logo);
    if (existing) return existing;
    if (item.type !== "movie" && item.type !== "series") return undefined;

    const fallback = cinemetaTitleArtwork(item.id, "logo");
    if (provider === "cinemeta") return fallback;

    const lookup = getTMDBArtwork(item.id, item.type, "logo")
        .then((logo) => publicArtworkUrl(logo) ?? fallback)
        .catch(() => fallback);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<string | undefined>((resolve) => {
        timer = setTimeout(() => resolve(fallback), HERO_LOGO_TIMEOUT_MS);
    });

    try {
        return await Promise.race([lookup, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

export async function enrichHomeHeroItems(
    items: HomeHeroItem[],
    provider: MetadataProvider = "auto",
): Promise<HomeHeroItem[]> {
    if (!items.length) return [];

    return Promise.all(
        items.map(async (item) => {
            const logo = await resolveHeroLogo(item, provider);
            return logo && logo !== item.logo ? { ...item, logo } : item;
        }),
    );
}

/** This is a watch-first surface. A year alone cannot tell us whether a
 * current-year title has premiered, so require an actual release date. */
function hasPremiered(item: HomeHeroItem, today: string): boolean {
    const value = item.released || item.releaseInfo;
    const date = typeof value === "string" ? value.slice(0, 10) : undefined;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const timestamp = Date.parse(date);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date && date <= today;
}

export async function loadHomeHeroItems(): Promise<HomeHeroItem[] | null> {
    const useTMDB = await hasTMDBDiscovery();
    const today = new Date().toISOString().slice(0, 10);
    const settled = await Promise.allSettled((["movie", "series"] as const).map(type =>
        useTMDB ? getTMDBFeaturedTitles(type) : cinemetaCatalog(type),
    ));
    const sources = settled.flatMap(result => result.status === "fulfilled" ? [{
        items: result.value.filter(item => hasPremiered(item, today)
            && (useTMDB || (Number(item.imdbRating) > 0 && Number(item.imdbRating) <= 10))),
    }] : []);
    const candidates = selectHomeHeroItems(sources);
    if (!candidates.length && settled.some(result => result.status === "rejected")) return null;
    return enrichHomeHeroItems(candidates, useTMDB ? "tmdb" : "cinemeta");
}
