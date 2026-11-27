"use client";

import artworkStyles from "./media-page/detail-artwork.module.css";

import { ArtworkImage } from "@/components/artwork-image";

import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { acquireSeriesSeason, peekSeriesSeason } from "@/lib/media/series-season";
import { useMetadataIntent, useSeasonMetadataIntent } from "@/components/metadata-preload";
import { safeResumePosition } from "@/lib/media/resume-playback";
import { observeCarouselControls } from "@/lib/media/carousel-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CarouselAction } from "@/components/carousel-action";
import { LoadingPlaceholder } from "@/components/ui/loading-placeholder";
import { Skeleton } from "@/components/ui/skeleton";
import { Select } from "@/components/arc/select/select";
import {
  fetchSeasons,
  fetchEpisodes,
  type Season,
  type Episode,
} from "@/app/actions/tv-shows";
import type { PlaybackProgressState } from "@/app/actions/media";
import { IntentLink } from "@/components/intent-link";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { ScrollArea, ScrollBar } from "./ui/scroll-area";
import { buildEpisodePath } from "@/lib/series-route";
import { episodeThumbnailUrl, episodeHeroStillUrl } from "@/lib/artwork";
import type { StremioVideo } from "@/types/stremio";
import { usePlaybackActions } from "@/contexts/MediaPlayerContext";
import cardStyles from "./media-card.module.css";
import styles from "./season-episodes.module.css";
import { WatchedIndicator } from "@/components/watched-indicator";

interface SeasonEpisodesProps {
  showId: string;
  prefetchedVideos?: StremioVideo[];
  initialSeasons?: Season[];
  /** All episodes and seasons are supplied, including a possible empty result. */
  prefetchedComplete?: boolean;
  previewPlayback?: boolean;
  currentSeasonNumber?: number;
  currentEpisodeNumber?: number;
  hasEpisodeRoute?: boolean;
  progress?: PlaybackProgressState | null;
  progressEpisode?: { season: number; episode: number };
}

// Cache episodes per series+season key
const episodesCache = new Map<string, Episode[]>();
const seasonsCache = new Map<string, Season[]>();

function getInitialSeasonState(showId: string, currentSeasonNumber?: number) {
  const cachedSeasons = seasonsCache.get(showId);
  const selectedSeason =
    currentSeasonNumber ??
    (cachedSeasons && cachedSeasons.length > 0 ? cachedSeasons[0].number : null);

  return {
    seasons: cachedSeasons ?? [],
    selectedSeason,
    loading: !cachedSeasons,
  };
}

function getInitialEpisodesState(showId: string, selectedSeason: number | null) {
  if (selectedSeason === null) {
    return [];
  }
  const cacheKey = `${showId}:${selectedSeason}`;
  return episodesCache.get(cacheKey) ?? [];
}

function normalizeVideosToEpisodes(
  showId: string,
  videos?: StremioVideo[]
): Episode[] {
  if (!videos?.length) return [];

  return videos
    .map((video) => {
      const season = video.season ?? 1;
      const episode = video.episode ?? 1;
      return {
        id: video.id || `${showId}:${season}:${episode}`,
        title: video.title || video.name || `Episode ${episode}`,
        season,
        episode,
        overview: video.overview,
        thumbnail: episodeThumbnailUrl(video.thumbnail, showId, season, episode),
        released: video.released,
        resumePositionTicks:
          typeof video.resumePositionTicks === "number"
            ? video.resumePositionTicks
            : undefined,
        progressPercent:
          typeof video.progressPercent === "number"
            ? video.progressPercent
            : undefined,
      };
    })
    .sort((a, b) => {
      if (a.season !== b.season) {
        if (a.season === 0) return 1;
        if (b.season === 0) return -1;
        return a.season - b.season;
      }
      return a.episode - b.episode;
    });
}

function episodesToSeasons(episodes: Episode[]): Season[] {
  const seasonMap = new Map<number, number>();
  for (const episode of episodes) {
    seasonMap.set(episode.season, (seasonMap.get(episode.season) || 0) + 1);
  }

  return Array.from(seasonMap.entries())
    .sort(([a], [b]) => {
      if (a === 0) return 1;
      if (b === 0) return -1;
      return a - b;
    })
    .map(([number, episodeCount]) => ({
      number,
      name: number === 0 ? "Special" : `Season ${number}`,
      episodeCount,
    }));
}

export function SeasonEpisodesPlaceholder({ hasEpisodeRoute = false }: { hasEpisodeRoute?: boolean }) {
  return (
    <LoadingPlaceholder className={`${styles.root} mt-3`} data-episode-overview={!hasEpisodeRoute || undefined}>
      <div className={`${styles.seasonHeader} mb-6 flex items-center justify-between gap-4 px-1`}>
        <Skeleton className="h-9 w-48 max-w-full" />
        <div className={`${styles.carouselControls} flex gap-2`}>
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="size-8 rounded-full" />
        </div>
      </div>
      <div
        className={`${styles.placeholderTrack} flex gap-4 overflow-hidden px-1 ${hasEpisodeRoute ? "mb-4" : "mb-8"}`}
      >
        {[1, 2, 3, 4, 5].map((item) => (
          <div key={item} className={`${styles.placeholderCard} w-72 shrink-0 space-y-3 py-2`}>
            <Skeleton className="aspect-video w-full rounded-lg" />
            <div className="space-y-3">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-6 w-16" />
            </div>
          </div>
        ))}
      </div>
    </LoadingPlaceholder>
  );
}

export const SeasonEpisodes = React.memo(function SeasonEpisodes({
  showId,
  prefetchedVideos,
  initialSeasons,
  prefetchedComplete = false,
  previewPlayback = false,
  currentSeasonNumber,
  currentEpisodeNumber,
  hasEpisodeRoute = !!currentEpisodeNumber,
  progress,
  progressEpisode,
}: SeasonEpisodesProps) {
  const prefetchedEpisodes = useMemo(
    () => normalizeVideosToEpisodes(showId, prefetchedVideos),
    [showId, prefetchedVideos]
  );
  const hasPrefetchedEpisodes = prefetchedEpisodes.length > 0;
  const prefetchedSeasons = useMemo(
    () => initialSeasons?.length ? [...initialSeasons].sort((a, b) =>
      a.number === b.number ? 0 : a.number === 0 ? 1 : b.number === 0 ? -1 : a.number - b.number
    ) : episodesToSeasons(prefetchedEpisodes),
    [prefetchedEpisodes, initialSeasons]
  );

  const hasPrefetchedSeasons = prefetchedComplete || prefetchedSeasons.length > 0;
  const initialSeasonState = hasPrefetchedSeasons
    ? {
        seasons: prefetchedSeasons,
        selectedSeason:
          currentSeasonNumber ??
          (prefetchedSeasons.length > 0 ? prefetchedSeasons[0].number : null),
        loading: false,
      }
    : getInitialSeasonState(showId, currentSeasonNumber);

  const initialEpisodes = hasPrefetchedEpisodes || prefetchedComplete
    ? initialSeasonState.selectedSeason === null
      ? []
      : prefetchedEpisodes.filter(
          (episode) => episode.season === initialSeasonState.selectedSeason
        )
    : getInitialEpisodesState(showId, initialSeasonState.selectedSeason);

  const [seasons, setSeasons] = useState<Season[]>(initialSeasonState.seasons);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(
    initialSeasonState.selectedSeason
  );
  const seasonIntent = useSeasonMetadataIntent(showId, selectedSeason, previewPlayback || prefetchedComplete);
  const [loading, setLoading] = useState(initialSeasonState.loading);
  const [episodes, setEpisodes] = useState<Episode[]>(initialEpisodes);
  const [episodesLoading, setEpisodesLoading] = useState(!prefetchedComplete && initialSeasonState.selectedSeason !== null && initialEpisodes.length === 0);
  const [episodeError, setEpisodeError] = useState<string | null>(null);
  const [episodeRetry, setEpisodeRetry] = useState(0);
  const resumePosition = safeResumePosition(progress?.resumePositionTicks, progress?.totalDuration, true);
  const episodesBottomSpacingClass = hasEpisodeRoute ? "mb-4" : "mb-8";
  const lastScrolledEpisodeRef = useRef<string | null>(null);
  const pointerSelectionRef = useRef<string | null>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [carouselPosition, setCarouselPosition] = useState({ overflow: false, start: true, end: true });

  useLayoutEffect(() => {
    const track = episodesLoading ? null : scrollContentRef.current;
    const viewport = track?.closest('[data-slot="scroll-area"]')
      ?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]') ?? null;
    viewportRef.current = viewport;
    if (!viewport) {
      setCarouselPosition(previous => previous.overflow ? { overflow: false, start: true, end: true } : previous);
      return;
    }
    return observeCarouselControls(viewport, next => setCarouselPosition(previous =>
      previous.overflow === next.overflow && previous.start === next.start && previous.end === next.end ? previous : next));
  }, [episodesLoading, episodes, selectedSeason]);

  useEffect(() => {
    if (hasPrefetchedSeasons) {
      setLoading(false);
      setSeasons(prefetchedSeasons);
      const initial =
        currentSeasonNumber ??
        (prefetchedSeasons.length > 0 ? prefetchedSeasons[0].number : null);
      setSelectedSeason(initial);
      return;
    }

    let cancelled = false;

    const loadSeasons = async () => {
      const cacheKey = showId;
      if (seasonsCache.has(cacheKey)) {
        const cached = seasonsCache.get(cacheKey)!;
        if (cancelled) return;
        setLoading(false);
        setSeasons(cached);
        const initial =
          currentSeasonNumber ??
          (cached.length > 0 ? cached[0].number : null);
        setSelectedSeason(initial);
        return;
      }

      setLoading(true);
      try {
        const seasonsData = await fetchSeasons(showId);
        if (cancelled) return;
        seasonsCache.set(cacheKey, seasonsData);
        setSeasons(seasonsData);
        const initial =
          currentSeasonNumber ??
          (seasonsData.length > 0 ? seasonsData[0].number : null);
        setSelectedSeason(initial);
      } catch (error) {
        console.error("Failed to fetch seasons:", error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadSeasons();

    return () => {
      cancelled = true;
    };
  }, [showId, currentSeasonNumber, hasPrefetchedSeasons, prefetchedSeasons]);

  useEffect(() => {
    if (currentSeasonNumber === undefined) {
      return;
    }

    setSelectedSeason((previousSeason) =>
      previousSeason === currentSeasonNumber
        ? previousSeason
        : currentSeasonNumber
    );
  }, [currentSeasonNumber]);

  useEffect(() => {
    if (selectedSeason === null) {
      setEpisodes([]);
      setEpisodesLoading(false);
      return;
    }

    const seasonEpisodes = prefetchedEpisodes.filter(episode => episode.season === selectedSeason);
    // Embedded add-on metadata can have titles and dates without TMDB stills.
    // Keep it visible, but resolve the selected season instead of treating it as complete.
    if (prefetchedComplete || (seasonEpisodes.length > 0 && seasonEpisodes.every(episode =>
      episode.thumbnail || (episode.released && Date.parse(episode.released) > Date.now())
    ))) {
      setEpisodes(seasonEpisodes);
      setEpisodesLoading(false);
      return;
    }

    let cancelled = false;
    let request: ReturnType<typeof acquireSeriesSeason> | undefined;
    const cacheKey = `${showId}:${selectedSeason}`;
    const warmed = peekSeriesSeason(showId, selectedSeason);
    if (warmed) {
      setEpisodes(warmed.length ? warmed : seasonEpisodes);
      setEpisodeError(null);
      setEpisodesLoading(false);
      return;
    }
    if (episodesCache.has(cacheKey)) {
      setEpisodes(episodesCache.get(cacheKey)!);
      setEpisodesLoading(false);
      return;
    }

    const loadEpisodes = async () => {
      setEpisodesLoading(true);
      try {
        request = /^tmdb:[1-9]\d*$/.test(showId) ? acquireSeriesSeason(showId, selectedSeason) : undefined;
        const episodesData = request ? await request.promise : await fetchEpisodes(showId, selectedSeason);
        if (cancelled) return;
        setEpisodeError(null);
        if (!/^tmdb:/.test(showId)) {
          episodesCache.set(cacheKey, episodesData);
          if (episodesCache.size > 48) episodesCache.delete(episodesCache.keys().next().value!);
        }
        setEpisodes(episodesData.length ? episodesData : seasonEpisodes);
      } catch (error) {
        if (!cancelled) {
          setEpisodes(seasonEpisodes);
          setEpisodeError(`${showId}:${selectedSeason}`);
          console.error("Failed to fetch episodes:", error);
        }
      } finally {
        if (!cancelled) {
          setEpisodesLoading(false);
        }
      }
    };

    loadEpisodes();

    return () => {
      cancelled = true;
      request?.release();
    };
  }, [showId, selectedSeason, hasPrefetchedEpisodes, prefetchedEpisodes, episodeRetry, prefetchedComplete]);

  useLayoutEffect(() => {
    if (selectedSeason !== currentSeasonNumber) {
      lastScrolledEpisodeRef.current = null;
      return;
    }
    if (
      episodesLoading ||
      currentSeasonNumber === undefined ||
      !currentEpisodeNumber
    ) {
      return;
    }

    const key = `${currentSeasonNumber}:${currentEpisodeNumber}`;
    const identity = `${showId}:${key}`;
    if (lastScrolledEpisodeRef.current === identity) {
      return;
    }

    const element = scrollContentRef.current?.querySelector<HTMLElement>(`[data-episode-key="${key}"]`);
    const viewport = viewportRef.current;
    if (!element || !viewport) return;
    const animateSelection = pointerSelectionRef.current === identity;
    pointerSelectionRef.current = null;
    const offset = element.getBoundingClientRect().left - viewport.getBoundingClientRect().left;
    viewport.scrollBy({
      left: offset - (viewport.clientWidth - element.clientWidth) / 2,
      behavior: episodeScrollBehavior(animateSelection),
    });
    lastScrolledEpisodeRef.current = identity;
  }, [episodes, episodesLoading, showId, currentSeasonNumber, currentEpisodeNumber, selectedSeason]);

  const handleEpisodeSelection = useCallback((event: React.MouseEvent<HTMLAnchorElement>, key: string) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const identity = `${showId}:${key}`;
    pointerSelectionRef.current = event.detail > 0 && identity !== lastScrolledEpisodeRef.current
      ? identity : null;
  }, [showId]);

  const scrollEpisodes = (direction: -1 | 1, keyboard: boolean) => {
    viewportRef.current?.scrollBy({ left: direction * 300, behavior: episodeScrollBehavior(!keyboard) });
  };

  if (loading) {
    return <SeasonEpisodesPlaceholder hasEpisodeRoute={hasEpisodeRoute} />;
  }

  if (seasons.length === 0) {
    return (
      <div className="mt-3 text-muted-foreground">No seasons available</div>
    );
  }

  return (
    <div data-episode-overview={!hasEpisodeRoute || undefined} className={`${styles.root} mt-3`}>
      <div className={`${styles.seasonHeader} mb-6 flex flex-wrap items-center justify-between gap-4 px-1`}>
        <div className={`${styles.seasonSelect} w-48 min-w-0 max-w-full`}>
          <Select
            label="Season"
            className={styles.seasonTrigger}
            hideLabel
            value={selectedSeason?.toString() ?? ""}
            onOptionIntent={seasonIntent}
            onValueChange={(value) => {
              const season = Number(value);
              const warmed = peekSeriesSeason(showId, season);
              if (warmed?.length) {
                setEpisodes(warmed);
                setEpisodeError(null);
                setEpisodesLoading(false);
              }
              setSelectedSeason(season);
            }}
            placeholder="Select season"
            options={seasons.map((season) => ({
              value: season.number.toString(),
              label: season.name,
            }))}
          />
        </div>
        {!episodesLoading && carouselPosition.overflow && <div className={`${styles.carouselControls} ms-auto flex shrink-0 items-center gap-2`}>
          <CarouselAction
            size="icon-sm"
            aria-label="Scroll left"
            disabled={carouselPosition.start}
            onClick={event => scrollEpisodes(-1, event.detail === 0)}
          >
            <ChevronLeft className="h-4 w-4" />
          </CarouselAction>
          <CarouselAction
            size="icon-sm"
            aria-label="Scroll right"
            disabled={carouselPosition.end}
            onClick={event => scrollEpisodes(1, event.detail === 0)}
          >
            <ChevronRight className="h-4 w-4" />
          </CarouselAction>
        </div>}
      </div>

      {episodesLoading ? (
        <LoadingPlaceholder>
          <ScrollArea className={`${styles.episodeScroll} w-full whitespace-nowrap -ml-3`}>
            <div
              ref={scrollContentRef}
              className={`${styles.episodeTrack} flex w-max space-x-4 ${episodesBottomSpacingClass} px-4`}
            >
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className={`${styles.episodeCard} shrink-0 w-72`}>
                  <div className={`${styles.episodeBody} space-y-3 py-2`}>
                    <div className={`${artworkStyles.surface} relative aspect-video rounded-lg overflow-hidden bg-muted`}>
                      <Skeleton className="w-full h-full" />
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-full" />
                      <Skeleton className="h-4 w-5/6" />
                      <div className="flex items-center gap-2 mt-2.5">
                        <Skeleton className="h-6 w-16 rounded-md" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <ScrollBar orientation="horizontal" className="opacity-0" />
          </ScrollArea>
        </LoadingPlaceholder>
      ) : episodes.length === 0 ? (
        episodeError === `${showId}:${selectedSeason}` ? (
          <div role="alert" className="mb-4 flex items-center gap-3 text-sm text-muted-foreground">
            <span>Couldn’t load this season</span>
            <Button variant="secondary" size="sm" onClick={() => setEpisodeRetry(value => value + 1)}>Try again</Button>
          </div>
        ) : <div className="text-muted-foreground">
          No episodes found for this season
        </div>
      ) : (
        <ScrollArea className={`${styles.episodeScroll} w-full rounded-md -ml-3`}>
          <div
            ref={scrollContentRef}
            className={`${styles.episodeTrack} flex w-max space-x-4 ${episodesBottomSpacingClass} px-4`}
          >
            {episodes.map((episode) => {
              const saved = progress && (episode.id === progress.videoId ||
                (episode.season === progressEpisode?.season && episode.episode === progressEpisode.episode));
              return (
                <EpisodeCard
                  key={episode.id}
                  episode={saved ? {
                    ...episode,
                    progressPercent: progress.progressPercent ?? episode.progressPercent,
                    resumePositionTicks: resumePosition,
                  } : episode}
                  showId={showId}
                  onSelect={handleEpisodeSelection}
                  previewPlayback={previewPlayback}
                  isActive={
                    selectedSeason === currentSeasonNumber &&
                    episode.season === currentSeasonNumber &&
                    episode.episode === currentEpisodeNumber
                  }
                />
              );
            })}
          </div>
          <ScrollBar orientation="horizontal" className="opacity-0" />
        </ScrollArea>
      )}
    </div>
  );
});

function episodeScrollBehavior(animate: boolean): ScrollBehavior {
  return animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "instant";
}

const EpisodeCard = React.memo(function EpisodeCard({
  episode,
  showId,
  onSelect,
  previewPlayback = false,
  isActive = false,
}: {
  episode: Episode;
  showId: string;
  onSelect: (event: React.MouseEvent<HTMLAnchorElement>, key: string) => void;
  isActive?: boolean;
  previewPlayback?: boolean;
}) {
  const { playMedia } = usePlaybackActions();
  const metadataIntent = useMetadataIntent({ id: showId, type: "series", name: episode.title, seriesId: showId,
    seasonNumber: episode.season, episodeNumber: episode.episode, mediaSourceId: episode.id,
    backdropUrl: episodeHeroStillUrl(episode.thumbnail) });
  const handlePlay = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (previewPlayback) return;
    void playMedia({
      id: showId,
      name: episode.title || "Episode " + episode.episode,
      type: "series",
      seriesId: showId,
      mediaSourceId: episode.id,
      episodeTitle: episode.title || "Episode " + episode.episode,
      seasonNumber: episode.season,
      episodeNumber: episode.episode,
      resumePositionTicks: episode.resumePositionTicks,
      backdropUrl: episode.thumbnail,
    });
  };
  const thumbnail = episodeThumbnailUrl(episode.thumbnail, showId, episode.season, episode.episode);
  const [imageFailure, setImageFailure] = useState<{ source?: string; attempts: number } | null>(null);
  const failedAttempts = imageFailure && imageFailure.source === thumbnail ? imageFailure.attempts : 0;
  const imageSrc = thumbnail && failedAttempts === 1
    ? `${thumbnail}${thumbnail.includes("?") ? "&" : "?"}retry=1`
    : thumbnail;

  const formatDate = useCallback((dateString: string | undefined) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, []);
  const releaseDate = episode.released ? new Date(episode.released) : null;
  const releaseTimestamp = releaseDate?.getTime();
  const hasValidReleaseDate =
    typeof releaseTimestamp === "number" && !Number.isNaN(releaseTimestamp);
  const isUpcoming = hasValidReleaseDate && releaseTimestamp > Date.now();
  const hasUsableThumbnail = Boolean(thumbnail) && failedAttempts < 2;
  const formattedReleaseDate = formatDate(episode.released);
  const episodeKey = `${episode.season}:${episode.episode}`;

  return (
    <div
      className={cardStyles.card + " " + styles.episodeCard + " relative shrink-0 w-72 group"}
      data-upcoming={isUpcoming || undefined}
      data-episode-id={episode.id}
      data-episode-key={episodeKey}
    >
      <IntentLink
        href={buildEpisodePath(showId, episode.season, episode.episode)}
        className="block"
        draggable={false}
        scroll={false}
        onClick={event => onSelect(event, episodeKey)}
        onPointerEnter={event => { if (!previewPlayback && !isUpcoming && event.pointerType === "mouse") metadataIntent.start(); }}
        onPointerLeave={metadataIntent.cancel}
        onFocus={event => { if (!previewPlayback && !isUpcoming && event.currentTarget.matches(":focus-visible")) metadataIntent.start(); }}
        onBlur={metadataIntent.cancel}
        aria-current={isActive || undefined}
      >
        <div className={`${styles.episodeBody} space-y-3 py-2`}>
          {/* Episode Thumbnail */}
          <div
            data-episode-artwork=""
            className={`${artworkStyles.surface} ${cardStyles.frame} relative aspect-video overflow-hidden ${isUpcoming ? "bg-gradient-to-br from-accent via-accent to-accent/70 border border-border/70" : "bg-muted"} ${isActive ? "ring-2 ring-primary ring-offset-3 ring-offset-background" : ""}`}
          >
            {isUpcoming ? (
              <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm font-medium text-foreground/85">
                This episode is still in the oven. Serving starts{" "}
                {formattedReleaseDate ? `on ${formattedReleaseDate}` : "soon"}.
              </div>
            ) : hasUsableThumbnail ? (
              <ArtworkImage
                draggable={false}
                src={imageSrc}
                loading="lazy"
                alt={episode.title || "Episode thumbnail"}
                className={cardStyles.artwork + " absolute inset-0 block w-full h-full object-contain"}
                onError={() => setImageFailure({ source: thumbnail, attempts: failedAttempts + 1 })}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                <Play className="h-12 w-12" />
              </div>
            )}


            <WatchedIndicator
              id={showId}
              type="series"
              videoId={episode.id}
              aboveProgress={typeof episode.progressPercent === "number" && episode.progressPercent > 0}
            />

            {typeof episode.progressPercent === "number" &&
            episode.progressPercent > 0 ? (
              <div className="absolute inset-x-2 bottom-2 h-1.5 rounded-full bg-white/30 backdrop-blur-sm overflow-hidden pointer-events-none">
                <div
                  className="h-full rounded-full bg-white/80 transition-all"
                  style={{ width: `${episode.progressPercent}%` }}
                />
              </div>
            ) : null}
          </div>

          {/* Episode Info */}
          <div className={`${styles.episodeInfo} space-y-2`}>
            <h3 className="font-semibold text-base leading-tight line-clamp-2 group-hover:text-primary transition-colors break-words pt-1">
              {episode.title || "Untitled episode"}
            </h3>

            {episode.overview && (
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3 break-words">
                {episode.overview}
              </p>
            )}

            <div className="flex items-center gap-2 flex-wrap mt-2.5">
              <Badge variant="outline" className="text-xs bg-sidebar">
                S{episode.season} &bull; E{episode.episode}
              </Badge>
              {formattedReleaseDate && (
                <Badge variant="outline" className="text-xs bg-sidebar">
                  {formattedReleaseDate}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </IntentLink>
      {!isUpcoming && (
        <div className={cardStyles.playOverlay + " " + styles.episodePlayOverlay + " absolute inset-x-0 top-2 aspect-video flex items-center justify-center rounded-lg"}>
          <button
            type="button"
            aria-label={"Play " + (episode.title || "Episode " + episode.episode)}
            onClick={handlePlay}
            onPointerEnter={event => { if (!previewPlayback && event.pointerType === "mouse") metadataIntent.start(); }}
            onPointerLeave={metadataIntent.cancel}
            onFocus={event => { if (!previewPlayback && event.currentTarget.matches(":focus-visible")) metadataIntent.start(); }}
            onBlur={metadataIntent.cancel}
            className={cardStyles.playButton + " relative rounded-full p-3 backdrop-blur-md"} draggable={false}
          >
            <Play aria-hidden="true" className="h-6 w-6 text-white fill-white" />
          </button>
        </div>
      )}
    </div>
  );
});
