"use client";

import { useParams } from "next/navigation";
import { useSeriesOverviewPlayback } from "@/components/series-overview-playback";
import { SeasonEpisodes } from "@/components/season-episodes";
import type { StremioVideo, MediaItem } from "@/types/stremio";

interface SeriesEpisodesRouteAwareProps {
  showId: string;
  prefetchedVideos?: StremioVideo[];
  prefetchedSeasons?: MediaItem["seasons"];
}

function toPositiveInt(value: string | undefined, minimum = 1): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) return undefined;
  return parsed;
}

export function SeriesEpisodesRouteAware({
  showId,
  prefetchedVideos,
  prefetchedSeasons,
}: SeriesEpisodesRouteAwareProps) {
  const params = useParams<{ season?: string; episode?: string }>();
  const playback = useSeriesOverviewPlayback();
  const hasEpisodeRoute = params?.episode !== undefined;
  const overviewTarget = hasEpisodeRoute ? undefined : playback?.target;

  return (
    <SeasonEpisodes
      showId={showId}
      prefetchedVideos={prefetchedVideos}
      initialSeasons={prefetchedSeasons}
      currentSeasonNumber={toPositiveInt(params?.season, 0) ?? overviewTarget?.seasonNumber}
      currentEpisodeNumber={toPositiveInt(params?.episode) ?? overviewTarget?.episodeNumber}
      hasEpisodeRoute={hasEpisodeRoute}
      progress={playback?.progress}
      progressEpisode={playback?.progressEpisode}
    />
  );
}
