import "server-only";

import { cinemetaTitleArtwork, publicArtworkUrl } from "@/lib/artwork";
import type { HomeHeroItem } from "@/lib/home-hero";
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
