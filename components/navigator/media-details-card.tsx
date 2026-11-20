"use client";

import { Film, Tv, Star } from "lucide-react";
import { RottenTomatoesIcon } from "../icons/rotten-tomatoes";
import { navigatorTitlePath } from "@/lib/navigator-title-path";
import { ResultCard, ResultMeta, formatCardRuntime } from "./result-card";

interface MediaDetailsCardProps {
  media: {
    id: string;
    name: string;
    type: "Movie" | "Series" | "Episode";
    year?: number;
    overview?: string;
    rating?: string;
    ratingSource?: string;
    runtime?: number;
    genres?: string[];
    cast?: string[];
    communityRating?: number;
    criticRating?: number;
    poster?: string;
    thumbnail?: string;
    background?: string;
    seriesName?: string;
    showName?: string;
    seasonNumber?: number;
    episodeNumber?: number;
  };
  className?: string;
  index?: number;
  onClick?: () => void;
}

export function MediaDetailsCard({
  media,
  className,
  index = 0,
  onClick,
}: MediaDetailsCardProps) {
  const href = navigatorTitlePath(media.id, media.type, media.seasonNumber, media.episodeNumber);
  return (
    <ResultCard
      className={className}
      index={index}
      title={media.name}
      subtitle={media.type === "Episode" ? media.seriesName || media.showName : undefined}
      icon={media.type === "Movie" ? Film : Tv}
      image={media.type === "Episode" ? media.thumbnail : media.poster}
      poster={media.poster}
      background={media.background}
      imageAspect={media.type === "Episode" ? "landscape" : "portrait"}
      artworkPath={href}
      loadArtwork
      href={onClick ? undefined : href}
      onClick={onClick}
      metadata={
        <>
          <ResultMeta>{media.type}</ResultMeta>
          {media.type === "Episode" && media.seasonNumber != null && media.episodeNumber != null && (
            <ResultMeta>S{media.seasonNumber} · E{media.episodeNumber}</ResultMeta>
          )}
          {media.year && <ResultMeta>{media.year}</ResultMeta>}
          {media.communityRating != null && (
            <ResultMeta>
              <Star className="fill-yellow-400 text-yellow-400" />
              {media.communityRating.toFixed(1)}
            </ResultMeta>
          )}
          {media.criticRating != null && (
            <ResultMeta>
              <RottenTomatoesIcon size={12} />
              {media.criticRating}%
            </ResultMeta>
          )}
          {media.ratingSource !== "TMDB" && media.rating && <ResultMeta>{media.rating}</ResultMeta>}
          {media.runtime ? (
            <ResultMeta>{formatCardRuntime(media.runtime)}</ResultMeta>
          ) : null}
          {media.genres?.slice(0, 3).map((genre) => (
            <ResultMeta key={genre}>{genre}</ResultMeta>
          ))}
        </>
      }
      description={
        <>
          {media.cast && media.cast.length > 0 && (
            <span className="block">
              {media.cast.slice(0, 3).join(", ")}
              {media.cast.length > 3 && ` +${media.cast.length - 3} more`}
            </span>
          )}
          {media.overview && (
            <span className="line-clamp-2">{media.overview}</span>
          )}
        </>
      }
    />
  );
}
