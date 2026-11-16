import "server-only";
import { getTMDBArtwork } from "@/lib/tmdb-artwork";
import { publicArtworkUrl } from "@/lib/artwork";

type ArtworkRecord = { id: string; type: string; seriesId?: string; poster?: string; background?: string; logo?: string };

/** Resolve once with metadata, then send public image URLs to the browser.
 * Existing TMDB URLs need no additional lookup. Credentials never leave here. */
export async function resolveMediaArtwork<T extends ArtworkRecord>(item: T, logo = false): Promise<T> {
    if (item.type !== "movie" && item.type !== "series") return item;
    const id = item.seriesId || item.id;
    const [poster, background, wordmark] = await Promise.all([
        publicArtworkUrl(item.poster) || getTMDBArtwork(id, item.type, "poster"),
        publicArtworkUrl(item.background) || (logo ? getTMDBArtwork(id, item.type, "backdrop") : undefined),
        publicArtworkUrl(item.logo) || (logo ? getTMDBArtwork(id, item.type, "logo") : undefined),
    ]);
    return { ...item, poster, background, logo: wordmark };
}

/** Bound upstream fan-out for large add-on catalogs. */
export async function resolveArtworkList<T extends ArtworkRecord>(items: T[], logo = false): Promise<T[]> {
    return mapArtwork(items, item => resolveMediaArtwork(item, logo));
}

async function mapArtwork<T>(items: T[], resolve: (_item: T) => Promise<T>): Promise<T[]> {
    const results = new Array<T>(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(6, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await resolve(items[index]);
        }
    }));
    return results;
}
