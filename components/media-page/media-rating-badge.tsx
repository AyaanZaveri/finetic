import { Badge } from "@/components/ui/badge";
import { Star } from "lucide-react";
import type { MediaItem } from "@/types/stremio";

type RatingMedia = Pick<MediaItem, "imdbRating" | "communityRating" | "ratingSource" | "voteCount">;

export function MediaRatingBadge({ media, inertSample = false }: { media: RatingMedia; inertSample?: boolean }) {
    const imdb = Number(media.imdbRating);
    const hasIMDb = Number.isFinite(imdb) && imdb > 0 && imdb <= 10;
    const score = hasIMDb ? imdb : media.communityRating;
    if (score == null || !Number.isFinite(score) || score <= 0 || score > 10) return null;

    const source = hasIMDb ? "IMDb" : media.ratingSource || "Rating";
    const count = !hasIMDb && typeof media.voteCount === "number" && Number.isSafeInteger(media.voteCount) && media.voteCount > 0
        ? media.voteCount : undefined;
    const label = `${source} ${score.toFixed(1)} out of 10${count ? `, ${count.toLocaleString("en-US")} vote${count === 1 ? "" : "s"}` : ""}`;

    return (
        <Badge variant="secondary" className={hasIMDb ? "gap-0 pl-1 pr-2" : undefined} aria-label={label} title={label}>
            {hasIMDb ? (
                // The original SVG includes IMDb's required clear space.
                <span className="relative flex h-4 w-9 shrink-0 items-center" aria-hidden="true">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {!inertSample && <img src="/logo/imdb-black.svg" alt="" width={36} height={20} className="h-auto w-9 dark:hidden" />}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {!inertSample && <img src="/logo/imdb-gold.svg" alt="" width={36} height={20} className="hidden h-auto w-9 dark:block" />}
                </span>
            ) : <Star aria-hidden="true" className="size-3 fill-yellow-400 text-yellow-400" />}
            <span className="tabular-nums">{hasIMDb ? score.toFixed(1) : `${source} ${score.toFixed(1)}`}</span>
        </Badge>
    );
}
