"use client";

import { ArtworkImage, ArtworkPlaceholder } from "@/components/artwork-image";

import { preloadPlayer } from "@/lib/preload-tools";

import React from "react";
import { IntentLink } from "@/components/intent-link";
import { Play } from "lucide-react";
import { usePlaybackActions } from "@/contexts/MediaPlayerContext";
import type { Episode } from "@/app/actions/tv-shows";
import { buildEpisodePath } from "@/lib/series-route";
import styles from "./media-card.module.css";
import artworkStyles from "./media-page/detail-artwork.module.css";
import { WatchedIndicator } from "@/components/watched-indicator";

export function EpisodeCard({
  episode,
  seriesId,
}: {
  episode: Episode;
  seriesId: string;
}) {
  const { playMedia, setIsPlayerVisible } = usePlaybackActions();
  const [pressed, setPressed] = React.useState(false);

  const linkHref = buildEpisodePath(seriesId, episode.season, episode.episode);
  const imageUrl = episode.thumbnail;

  const handlePlayClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    await playMedia({
      detailsPath: linkHref,
      animateEntrance: e.detail > 0,
      id: seriesId,
      name: episode.title || `Episode ${episode.episode}`,
      type: "series",
      mediaSourceId: episode.id,
      seriesId,
      episodeTitle: episode.title || `Episode ${episode.episode}`,
      seasonNumber: episode.season,
      episodeNumber: episode.episode,
      resumePositionTicks: episode.resumePositionTicks,
      backdropUrl: episode.thumbnail,
    });
    setIsPlayerVisible(true);
  };

  return (
    <div className={styles.card + " cursor-pointer select-none w-64"}>
      <div className={artworkStyles.surface + " " + styles.frame + " relative w-full border overflow-hidden aspect-video"}
        data-pressed={pressed || undefined}
        onPointerDown={event => { if (event.button === 0) setPressed(true); }}
        onPointerUp={() => setPressed(false)} onPointerLeave={() => setPressed(false)} onPointerCancel={() => setPressed(false)}>
        <IntentLink href={linkHref} draggable={false} className="absolute inset-0">
          {imageUrl ? (
            <ArtworkImage
              src={imageUrl}
              loading="lazy"
              className={styles.artwork + " absolute inset-0 block w-full h-full object-contain"}
              draggable="false"
              alt={episode.title || "Episode"}
            />
          ) : (
            <ArtworkPlaceholder className="w-full h-full" aria-hidden="true" />
          )}
        </IntentLink>

        <WatchedIndicator id={seriesId} type="series" videoId={episode.id} />

        {/* Play button overlay */}
        <div className={styles.playOverlay + " absolute inset-0 z-30 flex items-center justify-center"}>
            <button
              type="button"
              aria-label={"Play " + (episode.title || "Episode " + episode.episode)}
              onClick={handlePlayClick}
            onPointerEnter={preloadPlayer}
            onFocus={preloadPlayer}
              className={styles.playButton + " rounded-full p-3"} draggable={false}
            >
              <Play className="h-6 w-6 text-white fill-white" />
            </button>
        </div>
      </div>
      <IntentLink href={linkHref} draggable={false}>
        <div className="px-1">
          <div className="mt-2.5 text-sm font-medium text-foreground line-clamp-2">
            {episode.title}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            S{episode.season} &bull; E{episode.episode}
          </div>
        </div>
      </IntentLink>
    </div>
  );
}
