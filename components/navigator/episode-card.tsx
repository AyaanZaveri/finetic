"use client";


import { Tv } from "lucide-react";
import { buildEpisodePath, toEpisodeNavigationPath } from "@/lib/series-route";
import { ResultCard, ResultMeta, formatCardRuntime } from "./result-card";

interface EpisodeCardProps {
  episode: {
    id: string;
    name: string;
    episodeNumber?: number;
    seasonNumber?: number;
    overview?: string;
    runtime?: number;
    seriesId?: string;
    seriesName?: string;
    showName?: string;
    thumbnail?: string;
  };
  className?: string;
  index?: number;
  onClick?: () => void;
}

export function EpisodeCard({
  episode,
  className,
  index = 0,
  onClick,
}: EpisodeCardProps) {
  const href =
    episode.seriesId &&
    episode.seasonNumber != null &&
    episode.episodeNumber != null
      ? buildEpisodePath(
          episode.seriesId,
          episode.seasonNumber,
          episode.episodeNumber,
        )
      : toEpisodeNavigationPath(episode.id);
  return (
    <ResultCard
      className={className}
      index={index}
      title={episode.name}
      subtitle={episode.seriesName || episode.showName}
      icon={Tv}
      image={episode.thumbnail}
      imageAspect="landscape"
      artworkPath={href}
      href={onClick ? undefined : href}
      onClick={onClick}
      metadata={
        <>
          <ResultMeta>Episode</ResultMeta>
          {episode.seasonNumber != null && episode.episodeNumber != null && (
            <ResultMeta>
              S{episode.seasonNumber} · E{episode.episodeNumber}
            </ResultMeta>
          )}
          {episode.runtime ? (
            <ResultMeta>{formatCardRuntime(episode.runtime)}</ResultMeta>
          ) : null}
        </>
      }
      description={
        episode.overview && (
          <span className="line-clamp-2">{episode.overview}</span>
        )
      }
    />
  );
}
