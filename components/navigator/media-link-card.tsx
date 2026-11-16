"use client";


import { Film, Tv, Star } from "lucide-react";
import { RottenTomatoesIcon } from "../icons/rotten-tomatoes";
import { navigatorTitlePath } from "@/lib/navigator-title-path";
import { ResultCard, ResultMeta, formatCardRuntime } from "./result-card";

interface MediaLinkCardProps {
  item: {
    id: string;
    name?: string;
    title?: string;
    seriesId?: string;
    seriesName?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    type?: "Movie" | "Series" | "Episode" | "movie" | "series" | "episode";
    year?: number;
    communityRating?: number;
    criticRating?: number;
    officialRating?: string;
    runtime?: number;
    overview?: string;
    rating?: number;
    poster?: string;
    thumbnail?: string;
    background?: string;
    releaseInfo?: string | null;
    source?: string;
    roles?: string[];
    addonName?: string | null;
    catalogName?: string | null;
  };
  className?: string;
  index?: number;
}

export function MediaLinkCard({
  item,
  className,
  index = 0,
}: MediaLinkCardProps) {
  const title = item.name || item.title || "Untitled";
  const type =
    item.type?.toLowerCase() ||
    (item.episodeNumber != null ? "episode" : "unknown");
  const episode = type === "episode";
  const href = navigatorTitlePath(episode ? item.seriesId || item.id : item.id, type, item.seasonNumber, item.episodeNumber);
  const release =
    item.releaseInfo && (episode || !item.year) ? item.releaseInfo : item.year;
  return (
    <ResultCard
      className={className}
      index={index}
      title={title}
      subtitle={episode ? item.seriesName : undefined}
      icon={type === "movie" ? Film : Tv}
      image={episode ? item.thumbnail : item.poster}
      imageAspect={episode ? "landscape" : "portrait"}
      href={href}
      metadata={
        <>
          <ResultMeta>
            {type === "movie"
              ? "Movie"
              : episode
                ? "Episode"
                : type === "series"
                  ? "Series"
                  : "Media"}
          </ResultMeta>
          {episode &&
            item.seasonNumber != null &&
            item.episodeNumber != null && (
              <ResultMeta>
                S{item.seasonNumber} · E{item.episodeNumber}
              </ResultMeta>
            )}
          {release && <ResultMeta>{release}</ResultMeta>}
          {item.roles?.slice(0, 2).map(role => <ResultMeta key={role}>{role}</ResultMeta>)}
          {item.criticRating != null && (
            <ResultMeta>
              <RottenTomatoesIcon size={12} />
              {item.criticRating}%
            </ResultMeta>
          )}
          {item.communityRating != null && (
            <ResultMeta>
              <Star className="fill-yellow-400 text-yellow-400" />
              {item.communityRating.toFixed(1)}
            </ResultMeta>
          )}
          {item.officialRating && (
            <ResultMeta>{item.officialRating}</ResultMeta>
          )}
          {item.runtime ? (
            <ResultMeta>{formatCardRuntime(item.runtime)}</ResultMeta>
          ) : null}
        </>
      }
    />
  );
}
