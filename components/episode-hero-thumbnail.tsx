"use client";

import { ProgressiveEpisodeStill } from "@/components/progressive-episode-still";
import { episodeHeroStillUrl } from "@/lib/artwork";
import { ArtworkImage, ArtworkPlaceholder } from "@/components/artwork-image";

import { useMemo, useState } from "react";

interface EpisodeHeroThumbnailProps {
  thumbnail?: string;
  released?: string;
  title: string;
}

export function EpisodeHeroThumbnail({
  thumbnail,
  released,
  title,
}: EpisodeHeroThumbnailProps) {
  const [failedSrc, setFailedSrc] = useState<string | undefined>();

  const releaseDate = useMemo(
    () => (released ? new Date(released) : null),
    [released]
  );
  const releaseTimestamp = releaseDate?.getTime();
  const hasValidReleaseDate =
    typeof releaseTimestamp === "number" && !Number.isNaN(releaseTimestamp);
  const isUpcoming = hasValidReleaseDate && releaseTimestamp > Date.now();
  const hasUsableThumbnail = Boolean(thumbnail) && failedSrc !== thumbnail;

  const formattedReleaseDate =
    hasValidReleaseDate && releaseDate
      ? releaseDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null;

  if (isUpcoming) {
    return (
      <div className="flex h-full w-full items-center justify-center border border-border/70 bg-gradient-to-br from-accent via-accent to-accent/70 px-6 text-center text-sm font-medium text-foreground/85">
        This episode is still in the oven. Serving starts{" "}
        {formattedReleaseDate ? `on ${formattedReleaseDate}` : "soon"}.
      </div>
    );
  }

  if (!hasUsableThumbnail) {
    return <ArtworkPlaceholder label="Episode image unavailable" aria-label={`${title}: episode image unavailable`} className="h-full w-full" />;
  }

  const hero = episodeHeroStillUrl(thumbnail);
  if (hero && thumbnail && hero !== thumbnail) {
    return <ProgressiveEpisodeStill key={`${thumbnail}|${hero}`} preview={thumbnail} source={hero} title={title} />;
  }

  return (
    <ArtworkImage
      draggable={false}
      src={thumbnail}
      alt={title}
      waitForDecode
      className="h-full w-full object-cover"
      onError={() => setFailedSrc(thumbnail)}
    />
  );
}
