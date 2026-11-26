import { publicArtworkUrl } from "@/lib/artwork";
import { formatRuntime } from "@/lib/format-runtime";
import { releaseYear } from "@/lib/media/release-year";
import type { MediaItem } from "@/types/stremio";

export type HomeHeroItem = MediaItem;
export const HOME_HERO_ITEM_LIMIT = 6;

export interface HomeHeroSource {
  items: MediaItem[];
}

export interface HeroMetadata {
  rating?: {
    value: string;
    source: string;
    label: string;
  };
  year?: string;
  runtime?: string;
  genres: string[];
}

/**
 * Interleave featured titles across the leading home rows so the spotlight
 * mixes movies and series without repeating a title or picking items that
 * lack widescreen backdrop artwork.
 */
export function selectHomeHeroItems(
    sources: HomeHeroSource[],
    maxItems = HOME_HERO_ITEM_LIMIT,
): HomeHeroItem[] {
    if (!Array.isArray(sources) || maxItems <= 0) return [];

    const queues = sources.map((source) => {
        const eligible = (Array.isArray(source.items) ? source.items : []).flatMap<HomeHeroItem>((item) => {
            if (!item || (item.type !== "movie" && item.type !== "series")) return [];
            const name = typeof item.name === "string" ? item.name.trim() : "";
            const background = publicArtworkUrl(item.background);
            if (!name || !background) return [];
            return [{ ...item, name, background }];
        });
        return { eligible, cursor: 0 };
    });

    const selected: HomeHeroItem[] = [];
    const seen = new Set<string>();

    while (selected.length < maxItems) {
        let addedInPass = false;
        for (const queue of queues) {
            while (queue.cursor < queue.eligible.length) {
                const candidate = queue.eligible[queue.cursor++];
                const key = `${candidate.type}:${candidate.id}`;
                if (seen.has(key)) continue;
                seen.add(key);
                selected.push(candidate);
                addedInPass = true;
                break;
            }
            if (selected.length >= maxItems) break;
        }
        if (!addedInPass) break;
    }

    return selected;
}

export function heroDetailsHref(item: Pick<MediaItem, "id" | "type">): string {
    return item.type === "series" ? `/series/${item.id}` : `/movie/${item.id}`;
}

export function formatHeroMetadata(item: Pick<
  MediaItem,
  "imdbRating" | "communityRating" | "ratingSource" | "voteCount" | "year" | "releaseInfo" | "runtime" | "genres"
>): HeroMetadata {
    const imdb = Number(item.imdbRating);
    const hasImdb = Number.isFinite(imdb) && imdb > 0 && imdb <= 10;
    const score = hasImdb ? imdb : item.communityRating;
    let rating: HeroMetadata["rating"];
    if (typeof score === "number" && Number.isFinite(score) && score > 0 && score <= 10) {
        const source = hasImdb ? "IMDb" : item.ratingSource || "Rating";
        const value = score.toFixed(1);
        const votes = !hasImdb && typeof item.voteCount === "number" && Number.isSafeInteger(item.voteCount) && item.voteCount > 0
            ? `, ${item.voteCount.toLocaleString("en-US")} vote${item.voteCount === 1 ? "" : "s"}`
            : "";
        rating = {
            value,
            source,
            label: `${source} ${value} out of 10${votes}`,
        };
    }

    const parsedYear = releaseYear(item.year, item.releaseInfo);
    const year = typeof parsedYear === "number" ? String(parsedYear) : undefined;
    const runtime = formatRuntime(item.runtime);
    const genres = Array.isArray(item.genres)
        ? item.genres
            .map((genre) => (typeof genre === "string" ? genre.trim() : ""))
            .filter(Boolean)
            .slice(0, 3)
        : [];

    return { rating, year, runtime, genres };
}
