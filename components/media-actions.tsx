"use client";

import { useState, useEffect } from "react";
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
import { Download, Loader2, SearchX } from "lucide-react";
import { usePlaybackActions } from "@/contexts/MediaPlayerContext";
import { fetchPlaybackProgress } from "@/app/actions";
import { SearchField } from "@/components/arc/search-field/search-field";
import { ChipGroup } from "@/components/arc/chip-group/chip-group";
import styles from "./media-actions.module.css";
import { StreamSummary } from "@/components/stream-summary";
import { createPlaybackStreamRequest, type StreamWithAddon } from "@/lib/media/fetch-playback-streams";
import { useStreamQueries } from "@/components/stream-query-provider";
import { projectPlaybackDetails } from "@/lib/media/playback-details";
import { useAccountAccess } from "@/contexts/account-context";
import { Button } from "@/components/ui/button";
import { desktopBridge } from "@/lib/desktop/bridge";
import { SignInForStreams } from "@/components/sign-in-for-streams";

interface MediaActionsProps {
  media?: MediaItem;
  movie?: MediaItem;
}


const RESOLUTION_FILTERS = ["2160p", "1080p", "720p"] as const;

export function MediaActions({ media, movie }: MediaActionsProps) {
  const { authenticated } = useAccountAccess();
  const activeMedia = media ?? movie;
  const queries = useStreamQueries();
  const activeId = activeMedia?.id;
  const activeType = activeMedia?.type;
  const { setIsPlayerVisible, playMedia } = usePlaybackActions();
  const [streams, setStreams] = useState<StreamWithAddon[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamError, setStreamError] = useState(false);
  const [streamRetry, setStreamRetry] = useState(0);
  const [hasCheckedStreams, setHasCheckedStreams] = useState(false);
  const [pendingAddons, setPendingAddons] = useState(0);
  const [totalAddons, setTotalAddons] = useState(0);
  const [streamSearchQuery, setStreamSearchQuery] = useState("");
  const [selectedResolutions, setSelectedResolutions] = useState<string[]>([]);
  const [resumePositionTicks, setResumePositionTicks] = useState<
    number | undefined
  >(activeMedia?.resumePositionTicks);

  useEffect(() => {
    setResumePositionTicks(activeMedia?.resumePositionTicks);
  }, [activeMedia?.resumePositionTicks]);

  useEffect(() => {
    if (!authenticated || !activeMedia) return;
    let cancelled = false;

    const libraryItemId = activeMedia.seriesId || activeMedia.id;
    const targetVideoId =
      activeMedia.episodeId || activeMedia.mediaSourceId || activeMedia.id;

    void (async () => {
      const progress = await fetchPlaybackProgress(
        libraryItemId,
        targetVideoId,
      );
      if (cancelled) return;
      if (
        typeof progress?.resumePositionTicks === "number" &&
        progress.resumePositionTicks > 0
      ) {
        setResumePositionTicks(progress.resumePositionTicks);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeMedia?.episodeId,
    activeMedia?.id,
    activeMedia?.mediaSourceId,
    activeMedia?.seriesId,
    authenticated,
  ]);

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
      setStreams(snapshot.streams);
      setTotalAddons(snapshot.total);
      setPendingAddons(snapshot.pending);
    });
    void request.promise.then(() => {
      if (!cancelled) { setLoading(false); setHasCheckedStreams(true); }
    }).catch(error => {
      if (!cancelled) { console.error("Failed to fetch streams:", error); setStreamError(true); setLoading(false); setHasCheckedStreams(true); }
    });
    return () => { cancelled = true; unsubscribe(); lease?.release(); };
  }, [activeId, activeType, queries, authenticated, streamRetry]);

  if (!activeMedia) return null;
  if (!authenticated) return <SignInForStreams />;

  const normalizedSearchQuery = streamSearchQuery.trim().toLowerCase();
  const hasActiveFilters = selectedResolutions.length > 0;
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

    if (
      normalizedSearchQuery &&
      !searchableText.includes(normalizedSearchQuery)
    ) {
      return false;
    }

    if (selectedResolutions.length > 0) {
      const detectedResolution = detectStreamResolution(searchableText);
      if (
        !detectedResolution ||
        !selectedResolutions.includes(detectedResolution)
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

  return (
    <div className={styles.root}>
      {totalAddons > 0 && (
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
            {isAddonLoading ? (
              <span className={styles.loading}>
                <Loader2
                  aria-hidden="true"
                  className="size-3.5 animate-spin motion-reduce:animate-none"
                />
                <span>
                  {pendingAddons} addon{pendingAddons === 1 ? "" : "s"} loading
                </span>
              </span>
            ) : hasCheckedStreams || streams.length > 0 ? (
              <span className={styles.loading}>
                {filteredStreams.length} stream
                {filteredStreams.length === 1 ? "" : "s"} found
              </span>
            ) : null}
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
              return (
                <div key={index} className={styles.streamEntry} data-download={!!downloadUrl || undefined}>
                  <button
                    type="button"
                    className={styles.streamRow}
                    disabled={!streamUrl}
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
                  {downloadUrl && (
                    <Button asChild variant="ghost" size="icon" className={styles.streamDownload}>
                      <a href={downloadUrl} download={stream.behaviorHints?.filename || ""} target="_blank" rel="noreferrer"
                        title="Download file"
                        aria-label={`Download file for ${getSourceLabel(stream)}${stream.title ? `: ${stream.title}` : ""}`}>
                        <Download aria-hidden="true" />
                      </a>
                    </Button>
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
            {[1, 2, 3, 4, 5, 6].map((item) => (
              <div key={item} className={styles.streamSkeleton}>
                <Skeleton className="h-6 w-56 max-w-full rounded-md" />
                <Skeleton className="mt-2 h-4 w-72 max-w-full rounded-md" />
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
