"use client";

import { Play } from "lucide-react";
import { parseSeriesRouteId } from "@/lib/series-route";
import { navigatorTitlePath } from "@/lib/navigator-title-path";
import { ResultCard, ResultMeta } from "./result-card";

interface PlayMediaCardProps {
  result: {
    success: boolean;
    action?: string;
    mediaId?: string;
    mediaSourceId?: string;
    seriesId?: string;
    mediaName?: string;
    mediaType?: "Movie" | "Series" | "Episode";
    streamUrl?: string;
    showName?: string;
    episodeTitle?: string;
    thumbnail?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    message?: string;
  };
  className?: string;
  index?: number;
}

export function PlayMediaCard({
  result,
  className,
  index = 0,
}: PlayMediaCardProps) {
  if (!result.success) return null;
  const episode = result.mediaType === "Episode";
  const target = parseSeriesRouteId(result.mediaSourceId || result.mediaId || result.seriesId || "");
  const season = result.seasonNumber ?? target.season;
  const episodeNumber = result.episodeNumber ?? target.episode;
  const image = result.thumbnail;
  const title = episode
    ? result.episodeTitle || (episodeNumber != null ? `Episode ${episodeNumber}` : "Episode")
    : result.mediaName || "Media";
  const showName = result.showName || result.mediaName;
  const titleId = episode ? result.seriesId || target.seriesId : result.mediaId;
  const href = result.success && titleId && result.mediaType
    ? navigatorTitlePath(titleId, result.mediaType, season, episodeNumber)
    : undefined;
  return (
    <ResultCard
      className={className}
      index={index}
      title={title}
      subtitle={episode && showName !== title ? showName : undefined}
      icon={Play}
      image={image}
      imageAspect={episode ? "landscape" : "portrait"}
      href={href}
      loadArtwork
      metadata={
        <>
          <ResultMeta>{result.mediaType || "Media"}</ResultMeta>
          {episode &&
            season != null &&
            episodeNumber != null && (
              <ResultMeta>
                S{season} · E{episodeNumber}
              </ResultMeta>
            )}
          {result.streamUrl && <ResultMeta>Stream ready</ResultMeta>}
        </>
      }
    />
  );
}
