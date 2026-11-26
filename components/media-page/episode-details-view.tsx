import { MediaRatingBadge } from "./media-rating-badge";
import { ContentRatingBadge } from "./content-rating-badge";
import { RottenTomatoesRatingBadge } from "./rotten-tomatoes-rating-badge";
import type { MediaItem } from "@/types/stremio";
import artworkStyles from "./detail-artwork.module.css";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { TvIcon } from "lucide-react";
import { IntentLink } from "@/components/intent-link";

// Shared by real details and the inert sample so responsive geometry stays aligned.
export function EpisodeDetailsView({
  titleId, showHref, showName, title, seasonNumber, episodeNumber,
  released, rating, ratingMedia, thumbnail, actions, description, inertSample = false,
}: {
  titleId?: string;
  inertSample?: boolean;
  showHref?: string;
  showName: string;
  title: string;
  seasonNumber: number;
  episodeNumber: number;
  released?: string;
  rating?: string;
  ratingMedia?: Pick<MediaItem, "imdbRating" | "communityRating" | "ratingSource" | "voteCount" | "contentRating" | "rottenTomatoesRating">;
  thumbnail: ReactNode;
  actions: ReactNode;
  description?: ReactNode;
}) {
  return (
    <section
      aria-labelledby={titleId}
      className="@container"
    >
      <div className="grid min-w-0 gap-6 @4xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] @4xl:items-start @4xl:gap-8">
        <div className={`${artworkStyles.surface} relative mx-auto aspect-video w-full max-w-xl overflow-hidden rounded-lg bg-muted @4xl:mx-0 @4xl:mt-6 @4xl:max-w-none`}>
          {thumbnail}
        </div>

        <div className="flex min-w-0 flex-col gap-6 text-start">
          <div className="flex min-w-0 flex-col items-center gap-3 text-center @4xl:items-start @4xl:text-start">
            <nav
              aria-label="Episode context"
              className="flex min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm font-medium text-muted-foreground @4xl:justify-start"
            >
              {showHref ? <IntentLink
                href={showHref}
                draggable={false}
                className="inline-flex min-w-0 max-w-full items-center gap-2 transition-colors hover:text-foreground"
              >
                <TvIcon aria-hidden="true" className="relative -top-[0.5px] size-3.5 shrink-0" />
                <span className="min-w-0 break-words">{showName}</span>
              </IntentLink> : <span className="inline-flex min-w-0 max-w-full items-center gap-2">
                <TvIcon aria-hidden="true" className="relative -top-[0.5px] size-3.5 shrink-0" />
                <span className="min-w-0 break-words">{showName}</span>
              </span>}
            </nav>

            <h1
              id={titleId}
              className="min-w-0 break-words text-3xl font-semibold leading-tight text-foreground text-balance @lg:text-4xl @5xl:text-5xl"
            >
              {`${episodeNumber}. ${title}`}
            </h1>

            <div className="flex flex-wrap items-center justify-center gap-2 @4xl:justify-start">
              <Badge
                variant="secondary"
              >
                S{seasonNumber} • E{episodeNumber}
              </Badge>
              {released && (
                <Badge
                  variant="secondary"
                >
                  {new Date(released).getFullYear()}
                </Badge>
              )}
              <MediaRatingBadge media={ratingMedia ?? { imdbRating: rating }} inertSample={inertSample} />
              <RottenTomatoesRatingBadge score={ratingMedia?.rottenTomatoesRating} />
              <ContentRatingBadge rating={ratingMedia?.contentRating} series />
            </div>
            {actions}
          </div>

          {/* Keep room for three lines and the disclosure row in both the sample and loaded details. */}
          <div className="min-h-[calc(3lh+2.75rem)] text-base leading-relaxed">
            {description}
          </div>
        </div>
      </div>
    </section>
  );
}
