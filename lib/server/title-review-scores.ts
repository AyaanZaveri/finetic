import "server-only";
import { cinemetaMetadata } from "@/lib/cinemeta";
import { getMDBListKey } from "@/lib/mdblist-credentials";
import type { MediaItem } from "@/types/stremio";

type TitleType = "movie" | "series";

function imdbScore(value: unknown): string | undefined {
    if (typeof value !== "string" && typeof value !== "number") return undefined;
    const score = Number(value);
    return Number.isFinite(score) && score > 0 && score <= 10 ? score.toFixed(1) : undefined;
}

function criticScore(value: unknown): number | undefined {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100 ? value : undefined;
}

async function mdblistScores(id: string, type: TitleType, key: string, signal: AbortSignal) {
    try {
        const mediaType = type === "movie" ? "movie" : "show";
        const params = new URLSearchParams({ apikey: key });
        const response = await fetch(`https://api.mdblist.com/imdb/${mediaType}/${id}?${params}`, {
            redirect: "error", signal, headers: { Accept: "application/json" }, next: { revalidate: 86400 },
        });
        if (!response.ok) return undefined;
        const data = await response.json();
        if (data?.ids?.imdb !== id || data.type !== mediaType || !Array.isArray(data.ratings)) return undefined;
        return {
            imdbRating: imdbScore(data.ratings.find((rating: { source?: string } | null) => rating?.source === "imdb")?.value),
            rottenTomatoesRating: criticScore(data.ratings.find((rating: { source?: string } | null) => rating?.source === "tomatoes")?.value),
        };
    } catch {
        return undefined;
    }
}

/** The title ID is the only lookup key. Reviews are optional, and never
 * replace the selected metadata provider's title, artwork or episode list. */
export async function enrichTitleReviewScores(item: MediaItem, signal?: AbortSignal): Promise<MediaItem> {
    if (item.type !== "movie" && item.type !== "series") return item;
    const id = item.imdbId || item.id;
    if (!/^tt\d+$/.test(id)) return item;
    const existingIMDb = imdbScore(item.imdbRating);
    const needsIMDb = !existingIMDb && item.ratingSource === "TMDB";
    const key = await getMDBListKey();
    if (!needsIMDb && !key) return item;

    const deadline = AbortSignal.timeout(1500);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const [imdb, mdb] = await Promise.all([
        needsIMDb ? cinemetaMetadata(item.type, id, combined).then(meta => imdbScore(meta?.imdbRating)).catch(() => undefined) : undefined,
        key ? mdblistScores(id, item.type, key, combined) : undefined,
    ]);
    const score = existingIMDb ?? imdb ?? mdb?.imdbRating;
    return {
        ...item,
        ...(score !== undefined ? { imdbRating: score } : {}),
        ...(mdb?.rottenTomatoesRating !== undefined ? { rottenTomatoesRating: mdb.rottenTomatoesRating } : {}),
    };
}
