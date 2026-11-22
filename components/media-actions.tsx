"use client";

import { useState, useEffect, useRef } from "react";
import type { MediaItem, StremioStream } from "@/types/stremio";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { LoadingPlaceholder } from "@/components/ui/loading-placeholder";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Search, SearchX, X } from "lucide-react";
import { usePlaybackActions } from "@/contexts/MediaPlayerContext";
import { fetchPlaybackProgress } from "@/app/actions";
import { SearchField } from "@/components/arc/search-field/search-field";
import { ChipGroup } from "@/components/arc/chip-group/chip-group";
import styles from "./media-actions.module.css";
import { StreamSummary } from "@/components/stream-summary";
import { createPlaybackStreamRequest, type StreamWithAddon } from "@/lib/media/fetch-playback-streams";
import { useStreamQueries } from "@/components/stream-query-provider";
import { projectPlaybackDetails } from "@/lib/media/playback-details";
import { safeResumePosition } from "@/lib/media/resume-playback";
import { useAccountAccess } from "@/contexts/account-context";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { desktopBridge } from "@/lib/desktop/bridge";
import { StreamActionsMenu } from "@/components/stream-actions-menu";
import { SignInForStreams } from "@/components/sign-in-for-streams";

interface MediaActionsProps {
  media?: MediaItem;
  movie?: MediaItem;
  streamSelection?: { currentUrl: string | null; onSelect(_stream: StremioStream): void };
}


const RESOLUTION_FILTERS = ["2160p", "1080p", "720p"] as const;

export function MediaActions({ media, movie, streamSelection }: MediaActionsProps) {
  const { authenticated } = useAccountAccess();
  const activeMedia = media ?? movie;
  const queries = useStreamQueries();
  const activeId = activeMedia?.id;
  const activeType = activeMedia?.type;
  const switchingStream = Boolean(streamSelection);
  const [initialStreams] = useState(() => switchingStream && authenticated && activeId && activeType
    ? queries?.peek({ id: activeId, type: activeType }) : undefined);
  const drawerSearch = useRef<HTMLInputElement>(null);
  const { setIsPlayerVisible, playMedia } = usePlaybackActions();
  const [streams, setStreams] = useState<StreamWithAddon[]>(initialStreams?.streams ?? []);
  const [loading, setLoading] = useState(false);
  const [streamError, setStreamError] = useState(false);
  const [streamRetry, setStreamRetry] = useState(0);
  const [hasCheckedStreams, setHasCheckedStreams] = useState(initialStreams?.complete ?? false);
  const [pendingAddons, setPendingAddons] = useState(0);
  const [totalAddons, setTotalAddons] = useState(initialStreams?.total ?? 0);
  const [streamSearchQuery, setStreamSearchQuery] = useState("");
  const [selectedResolutions, setSelectedResolutions] = useState<string[]>([]);
  const libraryItemId = activeMedia?.seriesId || activeId;
  const targetVideoId = activeMedia?.episodeId || activeMedia?.mediaSourceId || activeId;
  const progressKey = `${libraryItemId}:${targetVideoId}`;
  const [savedProgress, setSavedProgress] = useState<{ key: string; position?: number } | null>(null);
  const resumePositionTicks = savedProgress?.key === progressKey ? savedProgress.position : activeMedia?.resumePositionTicks;

  useEffect(() => {
    if (!authenticated || !libraryItemId || switchingStream) return;
    let cancelled = false;

    void (async () => {
      const progress = await fetchPlaybackProgress(
        libraryItemId,
        targetVideoId,
      );
      if (!cancelled) setSavedProgress({ key: progressKey, position: activeType === "series"
        ? safeResumePosition(progress?.resumePositionTicks, progress?.totalDuration, true)
        : progress?.resumePositionTicks });
    })();

    return () => {
      cancelled = true;
    };
  }, [libraryItemId, targetVideoId, progressKey, activeType, authenticated, switchingStream]);

  useEffect(() => {
    if (!authenticated || !activeId || !activeType) return;
    let cancelled = false;
    setStreamError(false);

    const lease = queries?.acquire({ id: activeId, type: activeType });
    const request = lease?.request || createPlaybackStreamRequest(activeId, activeType);
    let firstSnapshot = true;
    const unsubscribe = request.subscribe(snapshot => {
      if (cancelled) return;
      if (firstSnapshot) { setSelectedResolutions([]); firstSnapshot = false; }
      setLoading(!snapshot.complete);
      setHasCheckedStreams(snapshot.complete);
      if (!switchingStream || snapshot.complete || snapshot.streams.length) setStreams(snapshot.streams);
      setTotalAddons(snapshot.total);
      setPendingAddons(snapshot.pending);
    });
    void request.promise.then(() => {
      if (!cancelled) { setLoading(false); setHasCheckedStreams(true); }
    }).catch(error => {
      if (!cancelled) { console.error("Failed to fetch streams:", error); setStreamError(true); setLoading(false); setHasCheckedStreams(true); }
    });
    return () => { cancelled = true; unsubscribe(); lease?.release(); };
  }, [activeId, activeType, queries, authenticated, streamRetry, switchingStream]);

  if (!activeMedia) return null;
  if (!authenticated) return <SignInForStreams />;

  const normalizedSearchQuery = streamSearchQuery.trim().toLowerCase();
  const hasActiveFilters = !switchingStream && selectedResolutions.length > 0;
  const filteredStreams = streams.filter((stream) => {
    const searchableText = [
      getSourceLabel(stream),
      stream.title,
      stream.name,
      stream.addonName,
      stream.behaviorHints?.filename,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const resolution = detectStreamResolution(searchableText);
    const searchIndex = resolution === "2160p" ? `${searchableText} 2160p 4k uhd` : searchableText;

    if (
      normalizedSearchQuery &&
      !searchIndex.includes(normalizedSearchQuery)
    ) {
      return false;
    }

    if (hasActiveFilters) {
      if (
        !resolution ||
        !selectedResolutions.includes(resolution)
      ) {
        return false;
      }
    }


    return true;
  });
  const isAddonLoading = loading && totalAddons > 0 && pendingAddons > 0;

  const handlePlay = async (stream: StremioStream) => {
    if (!activeMedia) return;

    const streamUrl = stream.url || stream.externalUrl || undefined;
    if (!streamUrl) return;
    if (streamSelection) {
      streamSelection.onSelect(stream);
      return;
    }
    const isEpisode =
      activeMedia.type === "series" &&
      !!activeMedia.seriesId &&
      !!activeMedia.episodeId;

    await playMedia({
      details: projectPlaybackDetails({ ...activeMedia, id: activeMedia.seriesId || activeMedia.id, name: activeMedia.showName || activeMedia.name }),
      detailsLoaded: true,
      id: isEpisode ? activeMedia.seriesId! : activeMedia.id,
      name: isEpisode
        ? activeMedia.episodeTitle || activeMedia.name
        : activeMedia.name,
      type: activeMedia.type,
      resumePositionTicks,
      streamUrl,
      mediaSourceId: isEpisode ? activeMedia.episodeId : activeMedia.id,
      seriesId: isEpisode ? activeMedia.seriesId : undefined,
      showName: isEpisode
        ? activeMedia.showName || activeMedia.name
        : undefined,
      episodeTitle: isEpisode
        ? activeMedia.episodeTitle || activeMedia.name
        : undefined,
      seasonNumber: isEpisode ? activeMedia.seasonNumber : undefined,
      episodeNumber: isEpisode ? activeMedia.episodeNumber : undefined,
      backdropUrl: activeMedia.background || activeMedia.poster,
      requestHeaders: stream.behaviorHints?.proxyHeaders?.request,
      subtitleFilename: stream.behaviorHints?.filename,
      subtitleVideoSize: stream.behaviorHints?.videoSize,
    });
    setIsPlayerVisible(true);
  };

  function getSourceLabel(stream: StremioStream) {
    if (stream.name) return stream.name;
    if (stream.url || stream.externalUrl) {
      try {
        return new URL(stream.url || stream.externalUrl || "").hostname;
      } catch {
        return "Stream";
      }
    }
    return "Unknown source";
  }

  function detectStreamResolution(text: string) {
    if (/(2160p|4k|uhd)/i.test(text)) return "2160p";
    if (/1080p/i.test(text)) return "1080p";
    if (/720p/i.test(text)) return "720p";
    if (/480p/i.test(text)) return "480p";
    return null;
  }

  const formatVideoSize = (sizeInBytes?: number) =>
    typeof sizeInBytes === "number"
      ? `${(sizeInBytes / 1024 ** 3).toFixed(2)} GB`
      : null;

  const showStreamLoader = isAddonLoading || (switchingStream && (loading || !hasCheckedStreams));
  const streamStatus = showStreamLoader ? (
    <>
      <Loader2 aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />
      {isAddonLoading
        ? <span>{pendingAddons} add-on{pendingAddons === 1 ? "" : "s"} loading</span>
        : <span className="sr-only">Loading streams</span>}
    </>
  ) : hasCheckedStreams || streams.length > 0 ? (
    <span>{filteredStreams.length} stream{filteredStreams.length === 1 ? "" : "s"}{switchingStream ? "" : " found"}</span>
  ) : null;

  return (
    <div className={styles.root} data-stream-picker={switchingStream || undefined}>
      {switchingStream ? (
        <InputGroup className="backdrop-blur-none [--text-input-fill:var(--stream-card-surface)]">
          <InputGroupInput ref={drawerSearch} type="search" aria-label="Search streams" placeholder="Search streams"
            autoComplete="off" value={streamSearchQuery} onChange={event => setStreamSearchQuery(event.target.value)}
            className="[&::-webkit-search-cancel-button]:appearance-none" />
          <InputGroupAddon align="inline-start"><Search aria-hidden="true" /></InputGroupAddon>
          <InputGroupAddon align="inline-end" className="shrink-0">
            <span className="flex items-center gap-1.5">
              {streamSearchQuery && (
                <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => {
                  setStreamSearchQuery("");
                  drawerSearch.current?.focus();
                }}>
                  <X aria-hidden="true" />
                </InputGroupButton>
              )}
              <InputGroupText role="status" className="whitespace-nowrap text-xs">{streamStatus}</InputGroupText>
            </span>
          </InputGroupAddon>
        </InputGroup>
      ) : totalAddons > 0 && (
        <div className={styles.toolbar}>
          <div className={styles.controls}>
            <div className={styles.search}>
              <SearchField
                label="Search streams"
                hideLabel
                value={streamSearchQuery}
                onValueChange={setStreamSearchQuery}
                placeholder="Find the least broken stream..."
                autoComplete="off"
              />
            </div>
            <fieldset className={styles.facet}>
              <legend className="sr-only">Resolution</legend>
              <ChipGroup
                label="Filter by resolution"
                multiple
                className={styles.chips}
                options={RESOLUTION_FILTERS.map((resolution) => ({
                  value: resolution,
                  label: resolution,
                }))}
                value={selectedResolutions}
                onValueChange={setSelectedResolutions}
              />
            </fieldset>
          </div>
          <div className={styles.feedback} role="status">
            <span className={styles.loading}>{streamStatus}</span>
          </div>
        </div>
      )}

      {filteredStreams.length > 0 && (
        <div className={styles.results}>
          <div className={styles.streamList}>
            {filteredStreams.map((stream, index) => {
              const streamUrl = stream.url || stream.externalUrl;
              const filePath = stream.url?.split(/[?#]/, 1)[0];
              const downloadUrl = filePath && /^https?:\/\//i.test(filePath)
                && !/\.(m3u8|mpd)$/i.test(filePath) && !desktopBridge() ? stream.url : undefined;
              const current = Boolean(streamUrl && streamUrl === streamSelection?.currentUrl);
              const row = (
                <button
                  type="button"
                  className={styles.streamRow}
                  disabled={!streamUrl}
                  aria-current={current || undefined}
                  aria-label={`Play ${getSourceLabel(stream)}${stream.title ? `: ${stream.title}` : ""}`}
                  onClick={() => handlePlay(stream)} draggable={false}
                >
                  <StreamSummary stream={stream} fallbackLabel={getSourceLabel(stream)} />
                  {(stream.behaviorHints?.filename ||
                    stream.behaviorHints?.videoSize) && (
                    <span className={styles.streamFile}>
                      {stream.behaviorHints?.filename}
                      {formatVideoSize(stream.behaviorHints?.videoSize) && (
                        <span className={styles.streamSize}>
                          {stream.behaviorHints?.filename && (
                            <> <span aria-hidden="true">·</span> </>
                          )}
                          {formatVideoSize(stream.behaviorHints?.videoSize)}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              );
              return (
                <div key={index} className={styles.streamEntry}>
                  {streamSelection ? row : (
                    <StreamActionsMenu label={getSourceLabel(stream)} url={streamUrl} downloadUrl={downloadUrl} filename={stream.behaviorHints?.filename}>
                      {row}
                    </StreamActionsMenu>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loading && streams.length === 0 && (
        <LoadingPlaceholder className={styles.results}>
          <div className={styles.streamList}>
            {Array.from({ length: switchingStream ? 12 : 6 }, (_, item) => (
              <div key={item} className={styles.streamSkeleton}>
                <div className={`${styles.streamName} ${styles.streamSkeletonLine}`}>
                  <Skeleton className="h-3.5 w-12" />
                </div>
                <div className={`${styles.streamTitle} ${styles.streamSkeletonLine}`}>
                  <Skeleton className="h-3 w-2/5 max-w-32" />
                </div>
                <div className={`${styles.streamTitle} ${styles.streamSkeletonLine}`}>
                  <Skeleton className="h-3 w-3/5 max-w-48" />
                </div>
              </div>
            ))}
          </div>
        </LoadingPlaceholder>
      )}

      {filteredStreams.length === 0 &&
        ((!loading && hasCheckedStreams) || streams.length > 0) && (
          <Empty className={styles.emptyState}>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX className="size-5" />
              </EmptyMedia>
              <EmptyTitle>
                {loading
                  ? "No matching streams yet"
                  : normalizedSearchQuery || hasActiveFilters
                  ? "Your filters were a little too powerful"
                  : streamError ? "Could not load streams"
                  : totalAddons === 0 ? "No stream add-ons connected"
                  : "No streams crawled out of hiding"}
              </EmptyTitle>
              <EmptyDescription>
                {loading
                  ? "More addons are still loading. Try adjusting your search or resolution filters."
                  : normalizedSearchQuery || hasActiveFilters
                  ? "Loosen the search/filters a bit and you should find the least broken stream."
                  : streamError ? "Your add-ons could not complete this lookup. Try again."
                  : totalAddons === 0 ? "Connect a stream add-on in Settings to find sources."
                  : "Your add-ons returned no streams for this episode or title."}
              </EmptyDescription>
            </EmptyHeader>
            {!loading && !normalizedSearchQuery && !hasActiveFilters && (streamError || totalAddons > 0) && (
              <Button variant="secondary" size="sm" onClick={() => {
                queries?.invalidate({ id: activeId!, type: activeType! });
                setStreamRetry(value => value + 1);
              }}>Retry</Button>
            )}
          </Empty>
        )}
    </div>
  );
}
