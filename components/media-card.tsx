"use client";

import { useMetadataIntent } from "@/components/metadata-preload";
import { projectPlaybackDetails } from "@/lib/media/playback-details";

import { ArtworkImage, ArtworkPlaceholder } from "@/components/artwork-image";

import { preloadPlayer } from "@/lib/preload-tools";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useHomePaletteScene } from "@/components/home-palette-provider";
import { mediaArtwork, backdropVariantUrl } from "@/lib/artwork";
import { IntentLink } from "@/components/intent-link";
import type { MediaItem } from "@/types/stremio";
import { Play } from "lucide-react";
import { usePlaybackActions } from "@/contexts/MediaPlayerContext";
import { buildEpisodePath, parseSeriesRouteId } from "@/lib/series-route";
import styles from "./media-card.module.css";
import { WatchedIndicator } from "@/components/watched-indicator";
import { MediaCardMenu, type CardPlayback } from "@/components/media-card-menu";
import { useContinueWatchingWarmup } from "@/components/continue-watching-warmup";

export function MediaCard({
  item,
  continueWatching = false,
  fullWidth = false,
  subtitleContent,
  titleLines = 1,
  revealArtwork = true,
  onRemovalIntent,
}: {
  item: MediaItem;
  continueWatching?: boolean;
  fullWidth?: boolean;
  subtitleContent?: React.ReactNode;
  titleLines?: 1 | 2;
  revealArtwork?: boolean;
  onRemovalIntent?: (_animate: boolean) => (() => void) | undefined;
}) {
  const { playMedia, setIsPlayerVisible } = usePlaybackActions();
  const originalTitleId = item.seriesId || (item.type === "series" ? parseSeriesRouteId(item.id).seriesId : item.id);
  const [historyIdentity, setHistoryIdentity] = useState<{ source: string; id: string } | null>(null);
  const historyId = historyIdentity?.source === originalTitleId ? historyIdentity.id : originalTitleId;
  const resolveHistoryId = useCallback((id: string) => setHistoryIdentity({ source: originalTitleId, id }), [originalTitleId]);
  const rawVideoId = item.mediaSourceId || item.episodeId;
  const historyVideoId = rawVideoId && (rawVideoId === originalTitleId || rawVideoId.startsWith(`${originalTitleId}:`))
    ? historyId + rawVideoId.slice(originalTitleId.length) : rawVideoId;
  const homeScene = useHomePaletteScene();
  const paletteOwner = useRef(Symbol("home-card"));
  useEffect(() => {
    const owner = paletteOwner.current;
    return () => homeScene?.release(owner);
  }, [homeScene, item.id, item.type, item.seriesId, continueWatching]);

  let linkHref = "";
  if (
    continueWatching &&
    item.type === "series" &&
    typeof item.seasonNumber === "number" &&
    typeof item.episodeNumber === "number"
  ) {
    linkHref = buildEpisodePath(item.id, item.seasonNumber, item.episodeNumber);
  } else if (item.type === "movie") {
    linkHref = `/movie/${item.id}`;
  } else if (item.type === "series") {
    linkHref = `/series/${item.id}`;
  } else {
    linkHref = `/movie/${item.id}`;
  }

  const artwork = mediaArtwork(item);
  const metadataIntent = useMetadataIntent({ ...item, details: item, backdropUrl: artwork.background });
  const warmup = useContinueWatchingWarmup();
  const cancelWarmup = useRef<(() => void) | null>(null);
  const warmOnIntent = () => {
    metadataIntent.start();
    if (!continueWatching) return;
    cancelWarmup.current?.();
    cancelWarmup.current = warmup?.intent(item) ?? null;
  };
  useEffect(() => () => { cancelWarmup.current?.(); }, [item.id, item.mediaSourceId]);
  // Search already supplies an exact TMDB poster. Reusing it avoids another
  // metadata request per card and preserves posters in the title's own language.
  const suppliedPoster = item.poster?.startsWith("https://image.tmdb.org/t/p/") ? item.poster : undefined;
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const backdrop = backdropVariantUrl(artwork.background, 780);
  const imageUrl = (continueWatching ? [backdrop, artwork.poster] : [suppliedPoster, artwork.poster])
    .find((source): source is string => !!source && !failedImages.includes(source));
  const failImage = useCallback(() => {
    if (imageUrl) setFailedImages(previous => previous.includes(imageUrl) ? previous : [...previous, imageUrl]);
  }, [imageUrl]);
  const imageSrcSet = continueWatching && imageUrl === backdrop && artwork.background?.startsWith("https://image.tmdb.org/t/p/")
    ? ([300, 780, 1280] as const).map(width => `${backdropVariantUrl(artwork.background, width)} ${width}w`).join(", ") : undefined;
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const [loadedLogo, setLoadedLogo] = useState<{ src: string; late: boolean } | null>(null);
  const pendingLogo = useRef<string | null>(null);
  const finishLogo = useCallback((late: boolean) => {
    const src = artwork.logo;
    if (src) setLoadedLogo(previous => previous?.src === src ? previous : { src, late });
  }, [artwork.logo]);
  const attachLogo = useCallback((image: HTMLImageElement | null) => {
    // Cached logos can finish before React attaches the load listener.
    if (!image || !artwork.logo) return;
    if (!image.complete) pendingLogo.current = artwork.logo;
    else if (image.naturalWidth > 0) finishLogo(pendingLogo.current === artwork.logo);
  }, [artwork.logo, finishLogo]);
  const [pressed, setPressed] = useState(false);
  const subtitle = continueWatching
    ? item.progressLabel ||
      (item.type === "movie"
        ? (typeof item.year === "number" && item.year >= 1888
            ? item.year.toString()
            : item.releaseInfo || "")
        : item.releaseInfo || "")
    : (typeof item.year === "number" && item.year >= 1888
        ? item.year.toString()
        : item.releaseInfo || "");

  const progressPercent = continueWatching && typeof item.progressPercent === "number" && Number.isFinite(item.progressPercent)
    ? Math.min(100, Math.max(0, item.progressPercent)) : null;

  const playCard = async (options?: CardPlayback, animateEntrance = true) => {
    if (item) {
      const episode = options?.videoId ? parseSeriesRouteId(options.videoId) : null;
      await playMedia({
        details: projectPlaybackDetails({ ...item, id: item.seriesId || item.id, name: item.showName || item.name }),
        detailsPath: linkHref,
        animateEntrance,
        id: options?.titleId || item.id,
        name: item.episodeTitle || item.name,
        type: item.type,
        resumePositionTicks: options ? options.resumePosition : item.resumePositionTicks,
        streamUrl: item.streamUrl,
        streamRequest: continueWatching ? warmup?.claim(item) : undefined,
        mediaSourceId: options?.videoId || item.mediaSourceId,
        seriesId: item.type === "series" ? options?.titleId || item.seriesId || item.id : undefined,
        showName: item.type === "series" ? item.showName || item.name : undefined,
        episodeTitle:
          item.type === "series" ? item.episodeTitle : undefined,
        seasonNumber: episode?.season ?? item.seasonNumber,
        episodeNumber: episode?.episode ?? item.episodeNumber,
        backdropUrl: artwork.background,
        subtitleFilename: item.subtitleFilename,
        subtitleVideoSize: item.subtitleVideoSize,
      });
      setIsPlayerVisible(true);
    }
  };

  const handlePlayClick = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    await playCard(undefined, e.detail > 0);
  };

  return (
    <MediaCardMenu item={item} continueWatching={continueWatching} detailsHref={linkHref} onPlay={playCard} onResolvedId={resolveHistoryId} onRemovalIntent={onRemovalIntent}>
    <div
      data-continue-watching={continueWatching || undefined}
      data-reveal-artwork={revealArtwork || undefined}
      onPointerEnter={event => {
        if (event.pointerType !== "mouse" || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
        warmOnIntent();
        homeScene?.hover(paletteOwner.current, {
          primary: continueWatching ? artwork.background : artwork.poster,
          fallback: continueWatching ? artwork.poster : artwork.background,
        });
      }}
      onPointerDownCapture={event => {
        if (event.button === 0 && event.isPrimary !== false) setPressed(true);
      }}
      onPointerUpCapture={() => setPressed(false)}
      onPointerCancelCapture={() => setPressed(false)}
      onPointerLeave={() => { setPressed(false); homeScene?.leave(paletteOwner.current); cancelWarmup.current?.(); metadataIntent.cancel(); }}
      onBlurCapture={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) { setPressed(false); cancelWarmup.current?.(); metadataIntent.cancel(); } }}
      onFocusCapture={event => {
        // Pointer clicks focus links too; only keyboard focus selects instantly.
        if (!(event.target instanceof Element) || !event.target.matches(":focus-visible")) return;
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        warmOnIntent();
        homeScene?.focus(paletteOwner.current, {
          primary: continueWatching ? artwork.background : artwork.poster,
          fallback: continueWatching ? artwork.poster : artwork.background,
        });
      }}
      className={`${styles.card} relative cursor-pointer select-none ${
        continueWatching ? "w-80" : fullWidth ? "w-full" : "w-36"
      }`}
    >
      <IntentLink href={linkHref} scroll={false} draggable={false}
        className={`${styles.detailsLink} absolute inset-0 z-10`}
        aria-label={`View details for ${item.name || "Untitled"}`} />
      <div className={`${styles.surface} relative w-full ${continueWatching ? "aspect-video" : "aspect-[2/3]"}`}
        data-pressed={pressed || undefined}>
        <div className={`${styles.frame} absolute inset-0 overflow-hidden`}>
          {/* Definite bounds keep WebKit image heights inside the poster frame. */}
          <div className={`${styles.artworkBounds} absolute inset-0`}>
            {imageUrl ? (
              <ArtworkImage
                reveal={revealArtwork ? true : "late"}
                src={imageUrl}
                srcSet={imageSrcSet}
                sizes={continueWatching ? "320px" : undefined}
                width={continueWatching ? 320 : 144}
                height={continueWatching ? 180 : 216}
                loading="lazy"
                data-prefetch-artwork={continueWatching ? "" : undefined}
                onUnavailable={failImage}
                alt=""
                className={`${styles.artwork} block w-full h-full object-cover`}
                draggable={false}
              />
            ) : (
              <ArtworkPlaceholder className="w-full h-full" aria-hidden="true" />
            )}
          </div>

          {continueWatching && artwork.logo && failedLogo !== artwork.logo ? (
            <div data-logo-ready={loadedLogo?.src === artwork.logo ? "" : undefined}
              data-logo-late={loadedLogo?.src === artwork.logo && loadedLogo.late ? "" : undefined}
              className={`${styles.wordmark} absolute inset-0 z-25 pointer-events-none flex items-center justify-center px-6`}>
              <img
                ref={attachLogo}
                src={artwork.logo}
                loading="lazy"
                decoding="async"
                fetchPriority="low"
                onLoad={() => finishLogo(true)}
                onError={() => setFailedLogo(artwork.logo!)}
                alt=""
                aria-hidden="true"
                className="max-h-[36%] max-w-[78%] w-auto object-contain drop-shadow-[0_4px_14px_rgba(0,0,0,0.95)]"
                draggable={false}
              />
            </div>
          ) : null}
        </div>
        {/* Play button overlay */}
        <div className={`${styles.playOverlay} absolute inset-0 z-30 flex items-center justify-center`}>
          <button
            type="button"
            aria-label={`Play ${item.episodeTitle || item.name}`}
            onClick={handlePlayClick}
            onPointerEnter={preloadPlayer}
            onFocus={preloadPlayer}
            className={`${styles.playButton} relative z-40 rounded-full p-3 backdrop-blur-md`} draggable={false}
          >
            <Play className="h-6 w-6 text-white fill-white" aria-hidden="true" />
          </button>
        </div>
        <div className={`${styles.status} pointer-events-none absolute inset-0 z-40`}>
          <WatchedIndicator
            id={historyId}
            type={item.type}
            videoId={historyVideoId || (item.type === "series" && item.seasonNumber !== undefined && item.episodeNumber !== undefined
              ? `${historyId}:${item.seasonNumber}:${item.episodeNumber}` : undefined)}
            aboveProgress={progressPercent !== null}
          />

          {progressPercent !== null ? (
            <div role="progressbar" aria-label={`${item.name} playback progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent} aria-valuetext={item.progressLabel || undefined} className="absolute inset-x-2 bottom-2 z-40 h-1.5 rounded-full bg-white/30 backdrop-blur-sm overflow-hidden pointer-events-none">
              <div
                className="h-full rounded-full bg-white/80"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          ) : null}
        </div>
      </div>
      <div className="px-1">
        <div className={`mt-2.5 text-sm font-medium text-foreground ${titleLines === 2 ? "line-clamp-2 break-words leading-snug" : "truncate"}`}>
          {item.name}
        </div>
        <div className={`text-xs text-muted-foreground mt-0.5 ${continueWatching ? "min-h-4" : ""}`}>
          {subtitleContent ?? subtitle}
        </div>
      </div>
    </div>
    </MediaCardMenu>
  );
}
