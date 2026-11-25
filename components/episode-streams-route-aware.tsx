"use client";

import { useMemo, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MediaActions } from "@/components/media-actions";
import { Button } from "@/components/ui/button";
import type { MediaItem, StremioVideo } from "@/types/stremio";
import { acquireSeriesSeason } from "@/lib/media/series-season";
import { useAccountAccess } from "@/contexts/account-context";
import { SignInForStreams } from "@/components/sign-in-for-streams";

interface EpisodeStreamsRouteAwareProps {
  show: MediaItem;
  prefetchedVideos?: StremioVideo[];
}

function toPositiveInt(value: string | undefined, minimum = 1): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : undefined;
}

export function EpisodeStreamsRouteAware({
  show,
  prefetchedVideos,
}: EpisodeStreamsRouteAwareProps) {
  const { authenticated } = useAccountAccess();
  const params = useParams<{ season?: string; episode?: string }>();
  const seasonNumber = useMemo(
    () => toPositiveInt(params?.season, 0),
    [params?.season]
  );
  const episodeNumber = useMemo(
    () => toPositiveInt(params?.episode),
    [params?.episode]
  );

  const key = `${show.id}:${seasonNumber}`;
  const [loaded, setLoaded] = useState<{ key: string; episodes: StremioVideo[] } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!authenticated || prefetchedVideos || !/^tmdb:[1-9]\d*$/.test(show.id) || seasonNumber === undefined) return;
    let cancelled = false;
    const request = acquireSeriesSeason(show.id, seasonNumber);
    void request.promise.then(episodes => {
      if (!cancelled) { setLoaded({ key, episodes }); setFailedKey(null); }
    }).catch(() => { if (!cancelled) setFailedKey(key); });
    return () => { cancelled = true; request.release(); };
  }, [key, show.id, seasonNumber, prefetchedVideos, retry, authenticated]);
  const videos = prefetchedVideos ?? (loaded?.key === key ? loaded.episodes : undefined);

  const episodeMedia = useMemo(() => {
    if (seasonNumber === undefined || !episodeNumber || !videos?.length) {
      return null;
    }

    const selectedEpisode = videos.find(
      (video) =>
        video.season === seasonNumber && video.episode === episodeNumber
    );

    if (!selectedEpisode?.id) {
      return null;
    }

    const selectedEpisodeTitle =
      selectedEpisode.title ||
      selectedEpisode.name ||
      `Episode ${episodeNumber}`;

    return {
      ...show,
      id: selectedEpisode.id,
      seriesId: show.id,
      showName: show.name,
      episodeId: selectedEpisode.id,
      episodeTitle: selectedEpisodeTitle,
      seasonNumber,
      episodeNumber,
      type: "series",
      name: selectedEpisodeTitle,
      description: selectedEpisode.overview || show.description,
      poster: selectedEpisode.thumbnail || show.poster,
    } satisfies MediaItem;
  }, [seasonNumber, episodeNumber, videos, show]);

  if (!authenticated) return <div className="mt-6 w-full"><SignInForStreams /></div>;

  if (!episodeMedia) {
    return failedKey === key ? <div role="alert" className="mt-6 flex items-center gap-3 text-sm text-muted-foreground">
      <span>Couldn’t load stream options</span><Button variant="secondary" size="sm" onClick={() => { setFailedKey(null); setRetry(value => value + 1); }}>Try again</Button>
    </div> : null;
  }

  return (
    <div className="mt-6 w-full">
      <MediaActions media={episodeMedia} />
    </div>
  );
}
