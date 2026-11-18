"use client";


import { Film, Tv, User } from "lucide-react";
import { ResultCard, ResultMeta } from "./result-card";

interface NavigationCardProps {
  result: {
    success: boolean;
    action?: string;
    url?: string;
    mediaName?: string;
    seriesName?: string;
    verified?: boolean;
    execution?: string;
    mediaType?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    poster?: string | null;
    thumbnail?: string | null;
    background?: string | null;
    message?: string;
    error?: string;
  };
  className?: string;
  index?: number;
}

export function NavigationCard({
  result,
  className,
  index = 0,
}: NavigationCardProps) {
  const mediaType = result.mediaType?.toLowerCase();
  const episode = mediaType === "episode" ||
    result.episodeNumber != null ||
    /(?:\/\d+\/\d+(?:[?#]|$)|[?&]episode=\d+)/.test(result.url || "");
  return (
    <ResultCard
      className={className}
      index={index}
      title={
        result.success
          ? result.mediaName || "Opening title…"
          : "Navigation failed"
      }
      icon={mediaType === "person" ? User : mediaType === "movie" ? Film : Tv}
      subtitle={result.seriesName}
      image={(episode ? result.thumbnail : result.poster)}
      imageAspect={episode ? "landscape" : "portrait"}
      href={
        result.success &&
        result.url?.startsWith("/") &&
        !result.url.startsWith("//")
          ? result.url
          : undefined
      }
      metadata={
        <>
          {result.verified && <ResultMeta>Verified</ResultMeta>}
          {result.execution && <ResultMeta>{result.execution === "completed" ? "Opened" : "Opening"}</ResultMeta>}
          {result.mediaType && <ResultMeta>{result.mediaType}</ResultMeta>}
          {result.seasonNumber != null && result.episodeNumber != null && (
            <ResultMeta>
              S{result.seasonNumber} · E{result.episodeNumber}
            </ResultMeta>
          )}
        </>
      }
      error={!result.success ? result.error : undefined}
    />
  );
}
