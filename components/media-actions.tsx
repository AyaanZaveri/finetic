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
import { ActivityTextShimmer } from "@/components/motion-primitives/activity-text-shimmer";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronRight, Layers, Puzzle, Search, SearchX, X } from "lucide-react";
import { usePlaybackActions } from "@/contexts/MediaPlayerContext";
import { fetchPlaybackProgress } from "@/app/actions";
import { Select } from "@/components/arc/select/select";
import styles from "./media-actions.module.css";
import drawerStyles from "./player-selection-controls.module.css";
import floatingSurface from "@/components/arc/floating-surface.module.css";
import accountDrawerStyles from "@/components/account-ui/drawer.module.css";
import { StreamSummary } from "@/components/stream-summary";
import { createPlaybackStreamRequest, type PlaybackStreamSnapshot, type StreamWithAddon } from "@/lib/media/fetch-playback-streams";
import { getAddonStreamErrorMessage } from "@/lib/media/fetch-addon-streams";
import { useStreamQueries } from "@/components/stream-query-provider";
import { projectPlaybackDetails } from "@/lib/media/playback-details";
import { safeResumePosition } from "@/lib/media/resume-playback";
import { useAccountAccess } from "@/contexts/account-context";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { desktopBridge } from "@/lib/desktop/bridge";
import { StreamActionsMenu } from "@/components/stream-actions-menu";
import { SignInForStreams } from "@/components/sign-in-for-streams";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { getStreamFilterTags } from "@/lib/media/stream-release-info";
import { matchesStreamFilters } from "@/lib/media/stream-filter-options";
import { StreamFilterPopover } from "@/components/stream-filter-popover";

interface MediaActionsProps {
  media?: MediaItem;
  movie?: MediaItem;
  preview?: boolean;
  previewStreams?: PlaybackStreamSnapshot;
  streamSelection?: { currentUrl: string | null; onSelect(_stream: StremioStream): void };
  pickerContainer?: HTMLElement | null;
}


const PREVIEW_COUNT = 3;
const RESULT_BATCH_SIZE = 40;

export function MediaActions({ media, movie, streamSelection, preview = false, previewStreams, pickerContainer }: MediaActionsProps) {
  const { authenticated } = useAccountAccess();
  const activeMedia = media ?? movie;
  const queries = useStreamQueries();
  const activeId = activeMedia?.id;
  const activeType = activeMedia?.type;
  const switchingStream = Boolean(streamSelection);
  const [initialStreams] = useState(() => preview ? previewStreams : switchingStream && authenticated && activeId && activeType
    ? queries?.peek({ id: activeId, type: activeType }) : undefined);
  const drawerSearch = useRef<HTMLInputElement>(null);
  const { setIsPlayerVisible, playMedia } = usePlaybackActions();
  const [streams, setStreams] = useState<StreamWithAddon[]>(initialStreams?.streams ?? []);
  const [loading, setLoading] = useState(preview && initialStreams?.complete === false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamRetry, setStreamRetry] = useState(0);
  const [hasCheckedStreams, setHasCheckedStreams] = useState(initialStreams?.complete ?? preview);
  const [pendingAddons, setPendingAddons] = useState(preview ? initialStreams?.pending ?? 0 : 0);
  const [totalAddons, setTotalAddons] = useState(initialStreams?.total ?? 0);
  const [streamSearchQuery, setStreamSearchQuery] = useState("");
  const [selectedAddon, setSelectedAddon] = useState("all");
  const [streamFilters, setStreamFilters] = useState<string[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMounted, setDrawerMounted] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState(false);
  const [titleDrawerContainer, setTitleDrawerContainer] = useState<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(RESULT_BATCH_SIZE);
  const drawerClose = useRef<HTMLButtonElement>(null);
  const afterClose = useRef<(() => void) | null>(null);
  const pickerResults = useRef<HTMLDivElement>(null);
  const nextBatchStart = useRef<number | null>(null);
  const libraryItemId = activeMedia?.seriesId || activeId;
  const targetVideoId = activeMedia?.episodeId || activeMedia?.mediaSourceId || activeId;
  const progressKey = `${libraryItemId}:${targetVideoId}`;
  const [savedProgress, setSavedProgress] = useState<{ key: string; position?: number } | null>(null);
  const resumePositionTicks = savedProgress?.key === progressKey ? savedProgress.position : activeMedia?.resumePositionTicks;

  useEffect(() => {
    if (preview || !authenticated || !libraryItemId || switchingStream) return;
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
  }, [libraryItemId, targetVideoId, progressKey, activeType, authenticated, switchingStream, preview]);

  useEffect(() => {
    if (preview || !authenticated || !activeId || !activeType) return;
    let cancelled = false;
    setStreamError(null);

    const lease = queries?.acquire({ id: activeId, type: activeType });
    const request = lease?.request || createPlaybackStreamRequest(activeId, activeType);
    let firstSnapshot = true;
    const unsubscribe = request.subscribe(snapshot => {
      if (cancelled) return;
      if (firstSnapshot) {
        setSelectedAddon("all");
        setStreamFilters([]);
        setStreamSearchQuery("");
        setVisibleCount(RESULT_BATCH_SIZE);
        firstSnapshot = false;
      }
      setLoading(!snapshot.complete);
      setHasCheckedStreams(snapshot.complete);
      if (!switchingStream || snapshot.complete || snapshot.streams.length) setStreams(snapshot.streams);
      setTotalAddons(snapshot.total);
      setPendingAddons(snapshot.pending);
    });
    void request.promise.then(() => {
      if (!cancelled) { setLoading(false); setHasCheckedStreams(true); }
    }).catch(error => {
      if (!cancelled) {
        const message = getAddonStreamErrorMessage(error);
        console.error("Failed to fetch streams:", message);
        setStreamError(message); setLoading(false); setHasCheckedStreams(true);
      }
    });
    return () => { cancelled = true; unsubscribe(); lease?.release(); };
  }, [activeId, activeType, queries, authenticated, streamRetry, switchingStream, preview]);

  useEffect(() => {
    setDrawerOpen(false);
    setDrawerMounted(false);
    afterClose.current = null;
  }, [activeId, activeType]);

  useEffect(() => {
    if (switchingStream || typeof window === "undefined") return;
    const query = window.matchMedia("(max-width: 639px)");
    const update = () => setMobileDrawer(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [switchingStream]);

  useEffect(() => {
    const start = nextBatchStart.current;
    nextBatchStart.current = null;
    if (start === null || !pickerResults.current) return;
    const rows = Array.from(pickerResults.current.querySelectorAll<HTMLButtonElement>("[data-player-selection-choice]"));
    const next = rows.slice(start).find(row => !row.disabled);
    if (next) {
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [visibleCount]);

  if (!activeMedia) return null;
  if (!authenticated) return <SignInForStreams />;

  const normalizedSearchQuery = streamSearchQuery.trim().toLowerCase();
  const hasActiveFilters = selectedAddon !== "all" || streamFilters.length > 0;
  const addonOptions = Array.from(new Map(streams.filter(stream => stream.addonId).map(stream => [stream.addonId, stream])),
    ([value, stream]) => ({
      value: `addon:${value}`,
      label: stream.addonName || value,
      icon: <Avatar className="size-4 rounded-[4px]">
        {stream.addonLogo && <AvatarImage src={stream.addonLogo} alt="" referrerPolicy="no-referrer" className="object-contain" />}
        <AvatarFallback className="rounded-[4px] bg-transparent text-muted-foreground"><Puzzle aria-hidden="true" className="size-3.5" /></AvatarFallback>
      </Avatar>,
    }));
  const streamSearchText = (stream: StreamWithAddon) => [
    getSourceLabel(stream), stream.title, stream.name, stream.description, stream.addonName, stream.behaviorHints?.filename,
  ].filter(Boolean).join(" ").toLowerCase();
  const filteredStreams = streams.filter((stream) => {
    if (selectedAddon !== "all" && selectedAddon !== `addon:${stream.addonId}`) return false;
    if (!normalizedSearchQuery && streamFilters.length === 0) return true;
    const searchableText = streamSearchText(stream);
    const tags = getStreamFilterTags(stream);
    const searchIndex = tags.has("2160p") ? `${searchableText} 2160p 4k uhd` : searchableText;

    if (
      normalizedSearchQuery &&
      !searchIndex.includes(normalizedSearchQuery)
    ) {
      return false;
    }

    if (!matchesStreamFilters(tags, streamFilters)) return false;
    return true;
  });
  // Preserve provider order, but do not fill the short preview with notices
  // when there are playable choices. The drawer still exposes every result.
  const playableStreams = streams.filter(stream => stream.url || stream.externalUrl);
  const featuredStreams = (playableStreams.length ? playableStreams : streams).slice(0, PREVIEW_COUNT);
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

  const formatVideoSize = (sizeInBytes?: number) =>
    typeof sizeInBytes === "number"
      ? `${(sizeInBytes / 1024 ** 3).toFixed(2)} GB`
      : null;

  const showStreamLoader = loading || !hasCheckedStreams;
  const streamStatus = (count: number, picker: boolean) => isAddonLoading ? (
    <ActivityTextShimmer style={{ font: "inherit" }}>{pendingAddons} add-on{pendingAddons === 1 ? "" : "s"} loading</ActivityTextShimmer>
  ) : showStreamLoader ? (
    <ActivityTextShimmer style={{ font: "inherit" }}>Finding streams…</ActivityTextShimmer>
  ) : hasCheckedStreams || streams.length > 0 ? (
    <span>{count} stream{count === 1 ? "" : "s"}{picker ? "" : " found"}</span>
  ) : null;

  const resetResultWindow = () => {
    nextBatchStart.current = null;
    setVisibleCount(RESULT_BATCH_SIZE);
    if (pickerResults.current) pickerResults.current.scrollTop = 0;
  };
  const updateSearch = (value: string) => {
    setStreamSearchQuery(value);
    resetResultWindow();
  };
  const renderToolbar = () => (
    <div className={styles.pickerToolbar}>
        <InputGroup className="backdrop-blur-none [--text-input-fill:var(--stream-card-surface)]">
          <InputGroupInput ref={drawerSearch} type="search" aria-label="Search streams" placeholder="Search streams"
            autoComplete="off" value={streamSearchQuery} onChange={event => updateSearch(event.target.value)}
            className="[&::-webkit-search-cancel-button]:appearance-none" />
          <InputGroupAddon align="inline-start"><Search aria-hidden="true" /></InputGroupAddon>
          <InputGroupAddon align="inline-end" className="shrink-0">
            <span className="flex items-center gap-1.5">
              {streamSearchQuery && (
                <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => {
                  updateSearch("");
                  drawerSearch.current?.focus();
                }}>
                  <X aria-hidden="true" />
                </InputGroupButton>
              )}
              <InputGroupText role="status" className="whitespace-nowrap text-xs">{streamStatus(filteredStreams.length, true)}</InputGroupText>
            </span>
          </InputGroupAddon>
        </InputGroup>
          <div className={styles.pickerSelects}>
            <Select label="Add-on" hideLabel value={selectedAddon}
              options={[{ value: "all", label: "All add-ons", icon: <Layers aria-hidden="true" strokeWidth={1.75} className="text-muted-foreground" /> }, ...addonOptions]}
              portalContainer={switchingStream ? pickerContainer : titleDrawerContainer}
              onValueChange={value => { setSelectedAddon(value); resetResultWindow(); }} />
            <StreamFilterPopover value={streamFilters}
              container={switchingStream ? pickerContainer : titleDrawerContainer}
              onChange={value => { setStreamFilters(value); resetResultWindow(); }} />
          </div>
    </div>
  );

  const renderResults = (results: StreamWithAddon[], picker: boolean) => (
    <>
      {results.length > 0 && (
        <div className={styles.results}>
          <div className={styles.streamList}>
            {results.map((stream, index) => {
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
                  data-player-selection-choice={picker ? "" : undefined}
                  aria-label={`Play ${getSourceLabel(stream)}${stream.title ? `: ${stream.title}` : ""}`}
                  onClick={() => {
                    if (picker && !switchingStream) {
                      if (afterClose.current) return;
                      afterClose.current = () => { void handlePlay(stream); };
                      setDrawerOpen(false);
                    } else {
                      void handlePlay(stream);
                    }
                  }} draggable={false}
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
                <div key={`${stream.addonId}:${streamUrl ?? stream.title ?? stream.name}:${index}`} className={styles.streamEntry}>
                  {streamSelection ? row : (
                    <StreamActionsMenu label={getSourceLabel(stream)} url={streamUrl} downloadUrl={downloadUrl} filename={stream.behaviorHints?.filename}
                      portalContainer={picker ? titleDrawerContainer : undefined}>
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
            {Array.from({ length: picker ? 6 : PREVIEW_COUNT }, (_, item) => (
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

      {results.length === 0 &&
        ((!loading && hasCheckedStreams) || streams.length > 0) && (
          <Empty className={styles.emptyState}>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX className="size-5" />
              </EmptyMedia>
              <EmptyTitle>
                {loading
                  ? "No matching streams yet"
                  : picker && (normalizedSearchQuery || hasActiveFilters)
                  ? hasActiveFilters ? "Your filters were a little too powerful" : "Nothing on our radar"
                  : streamError ? "Could not load streams"
                  : totalAddons === 0 ? "No stream add-ons connected"
                  : "No streams found"}
              </EmptyTitle>
              <EmptyDescription>
                {loading
                  ? "More add-ons are loading. Try a different search or filter."
                  : picker && (normalizedSearchQuery || hasActiveFilters)
                  ? hasActiveFilters ? "Try a different search or filter" : "Try a different search term"
                  : streamError ? streamError
                  : totalAddons === 0 ? "Install a stream add-on on the Add-ons page"
                  : "Your add-ons returned no streams. Try another title or check your add-ons."}
              </EmptyDescription>
            </EmptyHeader>
            {!loading && (!picker || (!normalizedSearchQuery && !hasActiveFilters)) && (streamError || totalAddons > 0) && (
              <Button variant="secondary" size="sm" onClick={() => {
                queries?.invalidate({ id: activeId!, type: activeType! });
                setStreamRetry(value => value + 1);
              }}>Try again</Button>
            )}
          </Empty>
        )}
    </>
  );

  const renderPicker = () => (
    <div className={`${styles.root} ${styles.picker}`} data-stream-picker="">
      {renderToolbar()}
      <div ref={pickerResults} className={styles.pickerResults}>
        {renderResults(filteredStreams.slice(0, switchingStream ? undefined : visibleCount), true)}
        {!switchingStream && filteredStreams.length > visibleCount && (
          <Button type="button" variant="outline" className="w-full"
            onClick={() => {
              nextBatchStart.current = visibleCount;
              setVisibleCount(count => count + RESULT_BATCH_SIZE);
            }}>
            Show {Math.min(RESULT_BATCH_SIZE, filteredStreams.length - visibleCount)} more
          </Button>
        )}
      </div>
    </div>
  );

  if (switchingStream) return renderPicker();

  return (
    <div className={styles.root} data-stream-preview="">
      <div className={styles.previewHeader}>
        <h2 className="text-lg font-semibold">Streams</h2>
        <span className={styles.loading} role="status">{streamStatus(streams.length, false)}</span>
      </div>
      {renderResults(featuredStreams, false)}
      {(streams.length > featuredStreams.length || drawerMounted) && (
        <Drawer modal swipeDirection={mobileDrawer ? "down" : "right"} showSwipeHandle={mobileDrawer} open={drawerOpen} onOpenChange={open => {
          if (open) {
            if (typeof window !== "undefined") setMobileDrawer(window.matchMedia("(max-width: 639px)").matches);
            setStreamSearchQuery("");
            setSelectedAddon("all");
            setStreamFilters([]);
            resetResultWindow();
            setDrawerMounted(true);
          }
          setDrawerOpen(open);
        }} onOpenChangeComplete={open => {
          if (open) return;
          setDrawerMounted(false);
          const play = afterClose.current;
          afterClose.current = null;
          play?.();
        }}>
          <DrawerTrigger render={<Button type="button" variant="outline" className="w-full" />}>
            View all {streams.length} streams <ChevronRight aria-hidden="true" />
          </DrawerTrigger>
          {drawerMounted && (
            <DrawerContent ref={setTitleDrawerContainer}
              overlayClassName={`${styles.titleOverlay} bg-black/25`}
              className={`${drawerStyles.popup} ${floatingSurface.surface} ${accountDrawerStyles.popup} ${styles.titleDrawer} rounded-2xl border border-border shadow-xl [--drawer-inset:1rem] after:hidden`}
              initialFocus={drawerClose}>
              <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-3 pb-2">
                <DrawerTitle className="text-lg font-semibold">Streams</DrawerTitle>
                <DrawerClose ref={drawerClose} render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Close" />}>
                  <X aria-hidden="true" />
                </DrawerClose>
              </div>
              <div className="flex min-h-0 flex-1 flex-col px-4 pt-1">
                {renderPicker()}
              </div>
            </DrawerContent>
          )}
        </Drawer>
      )}
    </div>
  );
}
