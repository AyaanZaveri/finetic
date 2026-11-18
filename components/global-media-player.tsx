"use client";

import { readPlaybackPreferences } from "@/lib/media/playback-preferences";
import { preferredSubtitleTrack } from "@/lib/media/subtitle-preference";
import { installAudioLanguagePreference } from "@/lib/media/audio-language";

import "@/components/player-mobile.css";
import "@/components/player-entrance.css";
import { ArtworkImage } from "@/components/artwork-image";
import { BrowserPlayerGlass } from "@/components/browser-player-glass";
import { PlayerLoadingStatus } from "@/components/player-loading-status";
import { PlayerLoadingWordmark } from "@/components/player-loading-wordmark";
import { usePlayerChapters } from "@/components/use-player-chapters";
import type { SkipSegment } from "@/lib/media/skip-segments";
import { ClockedSkipSegments, PlayerSubtitleLayer, PlayerEndTime } from "@/components/player-clock-islands";
import { parseSubtitleTextContent } from "@/lib/media/subtitle-content";
import { subtitleMediaKey } from "@/lib/media/subtitle-snapshot";
import { createSubtitleCueIndex } from "@/lib/media/subtitle-cue-index";
import { useEpisodeContinuation } from "@/lib/media/use-episode-continuation";
import { safeResumePosition } from "@/lib/media/resume-playback";
import { PlayerNextEpisode, PlayerUpNext } from "@/components/player-next-episode";
import { formatRuntime } from "@/lib/format-runtime";

import React, { useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo } from "react";
import { preload } from "react-dom";
import { PlaybackWakeLock } from "@/components/playback-wake-lock";
import { useRouter } from "next/navigation";
import type { MediaItem, StremioStream } from "@/types/stremio";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { PlayerNavigatorButton } from "@/components/player-navigator-button";
import {
  MediaPlayer,
  MediaPlayerControls,
  MediaPlayerControlsOverlay,
  MediaPlayerFullscreen,
  MediaPlayerLoading,
  MediaPlayerPiP,
  MediaPlayerPlay,
  MediaPlayerSeek,
  MediaPlayerSeekBackward,
  MediaPlayerSeekForward,
  MediaPlayerTime,
  MediaPlayerVideo,
  MediaPlayerVolume,
  MediaPlayerSettings,
  MediaPlayerTooltip,
} from "@/components/ui/media-player";
import { WebPlaybackVideo } from "@/components/web-playback-video";
import { PlayerPlaybackStats } from "@/components/player-playback-stats";
import { toast } from "sonner";
import { getPlaybackTitles, isMeaningfulEpisodeTitle } from "@/lib/media/playback-titles";
import { probeStreamMetadata } from "@/lib/media/stream-metadata";
import { probeStreamPlayability } from "@/lib/media/stream-playability";
import { useStreamQueries } from "@/components/stream-query-provider";
import { createPlaybackStreamRequest, fetchPlaybackStreams } from "@/lib/media/fetch-playback-streams";
import { installWebStartupWatchdog } from "@/lib/media/web-startup-watchdog";
import { resolvePlayback, invalidatePlaybackWarmup, playbackPhaseLabels, type PlaybackPhase } from "@/lib/media/resolve-playback";
import type { MediaToPlay } from "@/lib/atoms";
import { fetchPlaybackId } from "@/lib/media/fetch-playback-id";
import { fetchPlaybackEpisode } from "@/lib/media/fetch-playback-episode";
import { fetchPlaybackDetails } from "@/lib/media/fetch-playback-details";
import { initialPlaybackDetails, mergePlaybackDetails, playbackBackdrop } from "@/lib/media/playback-details";
import { desktopBridge, recordDesktopStage } from "@/lib/desktop/bridge";
import { MpvVideo } from "@/components/desktop/mpv-video";
import { PlayerVideoFit } from "@/components/player-video-fit";
import { NativePlayerGlass } from "@/components/native-player-glass";
import { DesktopTracks } from "@/components/desktop/tracks";
import type { MpvElementHandle } from "@/lib/desktop/mpv-element";
import { ArrowLeft, RotateCcw, RotateCw, Loader2 } from "lucide-react";
import { useMediaPlayer } from "@/contexts/MediaPlayerContext";
import {
  reportPlaybackStart,
  reportPlaybackProgress,
  reportPlaybackStopped,
} from "@/app/actions";
import { PlaybackSubtitles, type PlaybackSubtitleTrack } from "@/lib/media/playback-subtitles";
import { useSettings } from "@/contexts/settings-context";
import { PlayerSubtitles } from "@/components/player-subtitles";
import { useNativeSubtitleTiming } from "@/lib/media/use-native-subtitle-timing";
import { SubtitleTimingPopover } from "@/components/subtitle-timing-popover";
import { useSubtitleTiming } from "@/lib/media/subtitle-timing";
import { NAVIGATOR_PLAYBACK_EVENT } from "@/lib/navigator-playback-ack";
import { WATCH_HISTORY_CHANGED } from "@/lib/watch-history";
import { createPlaybackReporter } from "@/lib/media/playback-reporter";

interface GlobalMediaPlayerProps {
  onToggleAIAsk?: () => void;
}
const WEB_RECOVERY_TOAST_ID = "web-stream-recovery";

export function GlobalMediaPlayer({ onToggleAIAsk }: GlobalMediaPlayerProps) {
  const streamQueries = useStreamQueries();
  const metadataQueries = streamQueries?.metadata;
  const subtitleQueries = streamQueries?.subtitles;
  const router = useRouter();
  const {
    isPlayerVisible,
    setIsPlayerVisible,
    playMedia,
    currentMedia: playbackRequest,
    skipTimestamp,
    setCurrentMediaWithSource,
    setCurrentTimestamp,
  } = useMediaPlayer();
  const routedRequest = useRef<MediaToPlay | null>(null);
  useEffect(() => {
    if (!isPlayerVisible) { routedRequest.current = null; return; }
    if (!playbackRequest?.detailsPath || routedRequest.current === playbackRequest) return;
    // Effects run after the opaque shell commits, so route/layout changes cannot
    // flash through while the player chunk loads or its content fades in.
    routedRequest.current = playbackRequest;
    router.push(playbackRequest.detailsPath, { scroll: false });
  }, [isPlayerVisible, playbackRequest, router]);
  const { videoBitrate, subtitleSize, subtitleOutline, subtitleWeight, subtitleColor, subtitlePosition } = useSettings();
  const [preparedPlayback, setPreparedPlayback] = useState<{ request: MediaToPlay; media: MediaToPlay } | null>(null);
  const currentMedia = preparedPlayback && preparedPlayback.request === playbackRequest
    ? preparedPlayback.media : playbackRequest;
  useEffect(() => {
    if (currentMedia && isPlayerVisible) return metadataQueries?.observe(currentMedia, () => {});
  }, [metadataQueries, currentMedia, isPlayerVisible]);

  const subtitleTiming = useSubtitleTiming(currentMedia);
  const [timingOpenKey, setTimingOpenKey] = useState<string | null>(null);
  const [showPlaybackStats, setShowPlaybackStats] = useState(false);
  useEffect(() => { setTimingOpenKey(null); }, [subtitleTiming.key, isPlayerVisible]);
  const [playbackPhase, setPlaybackPhase] = useState<PlaybackPhase>("fetching-streams");

  const [nativePlayback] = useState(() => Boolean(desktopBridge()));
  useEffect(() => { recordDesktopStage("player-mounted"); }, []);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playerAttempt, setPlayerAttempt] = useState(0);
  const reportNavigatorPlayback = useCallback((state: "playing" | "error" | "closed", message?: string) => {
    if (!playbackRequest?.navigatorActionId) return;
    document.dispatchEvent(new CustomEvent(NAVIGATOR_PLAYBACK_EVENT, {
      detail: { actionId: playbackRequest.navigatorActionId, state, message },
    }));
  }, [playbackRequest]);
  const [requestHeaders, setRequestHeaders] = useState<Record<string, string>>({});
  useLayoutEffect(() => {
    if (!nativePlayback || !isPlayerVisible || !currentMedia) return;
    document.documentElement.dataset.nativePlaying = "";
    return () => { delete document.documentElement.dataset.nativePlaying; };
  }, [nativePlayback, isPlayerVisible, currentMedia]);

  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [loadedMediaDetails, setMediaDetails] = useState<MediaItem | null>(null);
  const mediaDetailsOwner = useRef<MediaToPlay | null>(null);
  const mediaDetails = mediaDetailsOwner.current === playbackRequest ? loadedMediaDetails
    : currentMedia ? initialPlaybackDetails(currentMedia) : null;
  const [subtitleTracks, setSubtitleTracks] = useState<
    Array<{
      id?: string;
      filename?: string;
      provider?: string;
      kind: string;
      label: string;
      language: string;
      src: string;
      default?: boolean;
      forced?: boolean;
      active: boolean;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [fetchingSubtitles, setFetchingSubtitles] = useState(false);
  const [requestedSubtitleSrc, setRequestedSubtitleSrc] = useState<string | null>(null);
  const [subtitleOptionsReady, setSubtitleOptionsReady] = useState(false);
  const [subtitleData, setSubtitleData] = useState<
    Array<{
      timestamp: number;
      endTimestamp?: number;
      timestampFormatted: string;
      text: string;
    }>
  >([]);

  const subtitleCatalogOwner = useRef<MediaToPlay | null>(null);
  useEffect(() => {
    if (!currentMedia || !isPlayerVisible || !subtitleQueries || subtitleCatalogOwner.current !== playbackRequest) return;
    return subtitleQueries.publish(currentMedia, subtitleTracks,
      subtitleTracks.find(track => track.active)?.src, subtitleTiming.seconds, subtitleData);
  }, [currentMedia, playbackRequest, isPlayerVisible, subtitleQueries, subtitleTracks, subtitleTiming.seconds, subtitleData]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const loadGenerationRef = useRef(0);
  const episodeContinuationRef = useRef<{ onEnded(): void } | null>(null);
  const subtitleSelectionRequest = useRef(0);
  const subtitleDefaultApplied = useRef(false);
  const subtitleDefaultSource = useRef<"embedded" | "external" | null>(null);
  const subtitleManualOverride = useRef(false);
  const subtitleShortcutEnabled = useRef<boolean | null>(null);
  const choosePreferredSubtitle = useRef<(() => void) | null>(null);
  const [initialPlaybackPreferences] = useState(readPlaybackPreferences);
  const playbackPreferencesRef = useRef(initialPlaybackPreferences);
  const metadataAbortRef = useRef<AbortController | null>(null);
  const subtitleLoaderRef = useRef<PlaybackSubtitles | null>(null);
  const webStreamsRef = useRef<StremioStream[]>([]);
  const playbackStartRef = useRef<{ start: number } | null>(null);
  const confirmWebPlaybackRef = useRef<(() => void) | null>(null);
  const failedStreamUrlsRef = useRef(new Set<string>());
  const activePlaybackRequestRef = useRef<MediaToPlay | null>(null);
  const loadMediaRef = useRef<((_request: MediaToPlay, _fallback?: boolean) => Promise<void>) | null>(null);
  const playbackReporterRef = useRef<ReturnType<typeof createPlaybackReporter> | null>(null);
  if (!playbackReporterRef.current) playbackReporterRef.current = createPlaybackReporter(async (kind, payload) => {
    const report = kind === "start" ? reportPlaybackStart : kind === "stopped" ? reportPlaybackStopped : reportPlaybackProgress;
    const success = await report(payload);
    if (success === true) window.dispatchEvent(new CustomEvent(WATCH_HISTORY_CHANGED, { detail: { id: payload.libraryItemId, playback: kind } }));
    return success;
  });
  useEffect(() => {
    playbackReporterRef.current?.begin();
    return () => playbackReporterRef.current?.cancel();
  }, [streamQueries?.scope]);
  const playbackStartedReportedRef = useRef(false);
  const playbackStoppedReportedRef = useRef(false);
  const lastLoadedPlaybackKeyRef = useRef<string | null>(null);
  const currentTimeRef = useRef(0);
  const [duration, setDuration] = useState(0);
  const [skipTimeline, setSkipTimeline] = useState<{ source: string | null; segments: SkipSegment[] }>({ source: null, segments: [] });
  const handleSkipSegments = useCallback((segments: SkipSegment[]) => {
    setSkipTimeline({ source: streamUrl, segments });
  }, [streamUrl]);
  const chapters = usePlayerChapters(videoRef, streamUrl, duration);


  const playbackKey = playbackRequest
    ? [
        playbackRequest.type,
        playbackRequest.seriesId || playbackRequest.id,
        playbackRequest.mediaSourceId || playbackRequest.id,
        playbackRequest.streamUrl || "",
        videoBitrate,
      ].join("::")
    : null;


  const buildPlaybackPayload = useCallback(
    (overrides?: {
      currentTimeSeconds?: number;
      durationSeconds?: number;
      ended?: boolean;
    }) => {
      if (!currentMedia) return null;

      const mediaType: "movie" | "series" | null =
        currentMedia.type === "series" || currentMedia.seriesId
          ? "series"
          : currentMedia.type === "movie"
            ? "movie"
            : null;
      if (!mediaType) return null;

      const currentTimeSeconds =
        typeof overrides?.currentTimeSeconds === "number"
          ? overrides.currentTimeSeconds
          : videoRef.current?.currentTime ?? currentTimeRef.current;
      const durationSeconds =
        typeof overrides?.durationSeconds === "number"
          ? overrides.durationSeconds
          : Number.isFinite(videoRef.current?.duration)
            ? (videoRef.current?.duration as number)
            : duration;

      return {
        libraryItemId: currentMedia.seriesId || currentMedia.id,
        videoId: currentMedia.mediaSourceId || currentMedia.id,
        mediaType,
        mediaName: currentMedia.showName || mediaDetails?.name || currentMedia.name,
        poster: mediaDetails?.poster || currentMedia.backdropUrl,
        currentTimeSeconds: Number.isFinite(currentTimeSeconds)
          ? currentTimeSeconds
          : 0,
        durationSeconds:
          typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
            ? durationSeconds
            : undefined,
        ended: overrides?.ended ?? false,
      };
    },
    [currentMedia, duration, mediaDetails?.name, mediaDetails?.poster]
  );

  const sendPlaybackUpdate = useCallback(
    (
      kind: "start" | "progress" | "stopped",
      overrides?: {
        currentTimeSeconds?: number;
        durationSeconds?: number;
        ended?: boolean;
      },
      periodic = false,
    ) => {
      const payload = buildPlaybackPayload(overrides);
      if (!payload || (kind !== "start" && (!playbackStartedReportedRef.current || playbackStoppedReportedRef.current))) return;

      if (kind === "start") {
        if (playbackStartedReportedRef.current) return;
        playbackStartedReportedRef.current = true;
        playbackStoppedReportedRef.current = false;
        playbackReporterRef.current?.report(kind, payload);
        return;
      }

      if (kind === "stopped") {
        if (playbackStoppedReportedRef.current) return;
        playbackStoppedReportedRef.current = true;
        playbackReporterRef.current?.report(kind, payload);
        return;
      }

      playbackReporterRef.current?.report(kind, payload, periodic);
    },
    [buildPlaybackPayload]
  );

  const handleVideoPause = useCallback(() => {
    sendPlaybackUpdate("progress");
  }, [sendPlaybackUpdate]);

  const tryNextWebStream = useCallback((element: HTMLVideoElement) => {
    if (nativePlayback || !playbackPreferencesRef.current.autoSelectWebStream || !currentMedia || !streamUrl || element !== videoRef.current) return;
    failedStreamUrlsRef.current.add(streamUrl);
    const position = element.currentTime > 0 ? element.currentTime : currentMedia.resumePositionTicks;
    toast("That stream failed. Trying another one…", { id: WEB_RECOVERY_TOAST_ID });
    // loadMedia advances the generation synchronously, deduplicating decoder errors.
    void loadMediaRef.current?.({
      ...currentMedia, streamUrl: undefined, requestHeaders: undefined,
      subtitleFilename: undefined, subtitleVideoSize: undefined,
      resumePositionTicks: position,
    }, true);
  }, [nativePlayback, currentMedia, streamUrl]);

  const handleVideoCanPlay = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    if (event.currentTarget !== videoRef.current || event.currentTarget.error) return;
    if (nativePlayback && event.currentTarget.readyState < 3) return;
    setVideoReady(true);
    setPlaybackError(null);
  }, [nativePlayback]);

  const handleVideoPlaying = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    if (event.currentTarget !== videoRef.current) return;
    setVideoReady(true);
    setPlaybackError(null);
    if (!nativePlayback && playbackPreferencesRef.current.autoSelectWebStream) playbackStartRef.current ??= { start: event.currentTarget.currentTime };
    if (!nativePlayback) toast.dismiss(WEB_RECOVERY_TOAST_ID);
    reportNavigatorPlayback("playing");
  }, [nativePlayback, reportNavigatorPlayback]);

  const handleVideoError = useCallback((event: React.SyntheticEvent<HTMLVideoElement>, generation: number) => {
    const element = event.currentTarget;
    if (generation !== loadGenerationRef.current || element !== videoRef.current || !isPlayerVisible) return;
    const error = element.error;
    if (!error || error.code === 1) return;

    if (!nativePlayback && playbackPreferencesRef.current.autoSelectWebStream && currentMedia && streamUrl && error.code >= 2 && error.code <= 4) {
      tryNextWebStream(element);
      return;
    }

    const gpuReason = !nativePlayback ? element.dataset?.webgpuFallback : undefined;
    const message = gpuReason
      ? `WebGPU playback failed (${gpuReason}). The browser could not play this file either.`
      : error.message || "This stream could not be played.";
    console.warn("Media player error:", { code: error.code, message });
    setPlaybackError(message);
    reportNavigatorPlayback("error", message);
  }, [isPlayerVisible, nativePlayback, currentMedia, streamUrl, tryNextWebStream, reportNavigatorPlayback]);

  const maybeReportPeriodicProgress = useCallback(
    (timeSeconds: number, durationSeconds?: number) => {
      const element = videoRef.current;
      playbackReporterRef.current?.observe(timeSeconds, element?.paused ?? true, element?.seeking ?? false, element?.playbackRate || 1);
      sendPlaybackUpdate("progress", {
        currentTimeSeconds: timeSeconds,
        durationSeconds,
      }, true);
    },
    [sendPlaybackUpdate]
  );

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      const element = videoRef.current;
      const time = element.currentTime;
      const playbackStart = playbackStartRef.current;
      if (!element.paused && !element.seeking && playbackStart && time - playbackStart.start > 0.05) {
        confirmWebPlaybackRef.current?.();
      }
      currentTimeRef.current = time;
      setCurrentTimestamp(time);

      maybeReportPeriodicProgress(time, videoRef.current.duration);
    }
  }, [nativePlayback, tryNextWebStream, maybeReportPeriodicProgress, setCurrentTimestamp, reportNavigatorPlayback]);

  const handleDurationChange = useCallback(() => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  }, []);

  const handleVideoLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      const mediaElement = videoRef.current;
      const mediaDuration = mediaElement.duration;
      setDuration(mediaDuration);
      let effectiveStartTime = mediaElement.currentTime || 0;

      const requestedResume = currentMedia?.resumePositionTicks;
      const episodeResume = currentMedia?.type === "series";
      if (
        typeof requestedResume === "number" &&
        Number.isFinite(requestedResume) &&
        requestedResume > 0
      ) {
        const maxSeekTime =
          Number.isFinite(mediaDuration) && mediaDuration > 1
            ? mediaDuration - 1
            : requestedResume;
        const resumeTime = episodeResume ? safeResumePosition(requestedResume, mediaDuration, true) ?? 0
          : Math.max(0, Math.min(requestedResume, maxSeekTime));
        // Wait for the selected file's duration before seeking an episode.
        // Movies can still use the native load-time seek.
        if ((episodeResume || !desktopBridge()?.capabilities?.initialSeek || resumeTime !== requestedResume)
          && Math.abs(mediaElement.currentTime - resumeTime) > 0.1) mediaElement.currentTime = resumeTime;
        currentTimeRef.current = resumeTime;
        setCurrentTimestamp(resumeTime);
        effectiveStartTime = resumeTime;
      }

      sendPlaybackUpdate("start", {
        currentTimeSeconds: effectiveStartTime,
        durationSeconds: mediaDuration,
      });
      mediaElement.play().catch(() => {});
    }
  }, [currentMedia?.type, currentMedia?.resumePositionTicks, sendPlaybackUpdate, setCurrentTimestamp]);

  const handleClose = useCallback((options?: { ended?: boolean }) => {
    reportNavigatorPlayback("closed");
    loadGenerationRef.current++;
    metadataAbortRef.current?.abort();
    sendPlaybackUpdate("stopped", { ended: options?.ended });
    toast.dismiss(WEB_RECOVERY_TOAST_ID);
    setIsPlayerVisible(false);
    setTimingOpenKey(null);
    setShowPlaybackStats(false);
    setStreamUrl(null);
    setMediaDetails(null);
    subtitleSelectionRequest.current++;
    setSubtitleOptionsReady(false);
    setSubtitleTracks([]);
    currentTimeRef.current = 0;
    setDuration(0);
    setFetchingSubtitles(false);
    setRequestedSubtitleSrc(null);
    setCurrentMediaWithSource(null);
    setVideoReady(false);
    setPlaybackError(null);
    lastLoadedPlaybackKeyRef.current = null;
  }, [sendPlaybackUpdate, setCurrentMediaWithSource, setIsPlayerVisible, reportNavigatorPlayback]);

  useEffect(() => {
    if (!nativePlayback || !isPlayerVisible) return;
    const close = (event: Event) => { event.preventDefault(); handleClose(); };
    document.addEventListener("navigatornativeclose", close);
    return () => document.removeEventListener("navigatornativeclose", close);
  }, [nativePlayback, isPlayerVisible, handleClose]);

  useEffect(() => {
    if (!isPlayerVisible) return;
    const close = () => handleClose();
    document.addEventListener("navigatorcloseplayer", close);
    return () => document.removeEventListener("navigatorcloseplayer", close);
  }, [isPlayerVisible, handleClose]);

  const handleVideoEnded = useCallback((event: React.SyntheticEvent<HTMLVideoElement>, generation: number) => {
    if (event.currentTarget !== videoRef.current || generation !== loadGenerationRef.current
      || activePlaybackRequestRef.current !== playbackRequest) return;
    if (episodeContinuationRef.current) episodeContinuationRef.current.onEnded();
    else handleClose({ ended: true });
  }, [handleClose, playbackRequest]);

  // Process subtitle text for HTML rendering
  const processSubtitleText = useCallback((text: string) => {
    const shouldPositionTop = /\{\\an8\}/.test(text);
    let processedText = text.replace(/\{\\an\d+\}/g, "");
    processedText = processedText.replace(/\n/g, "<br>");
    return { text: processedText, positionTop: shouldPositionTop };
  }, []);

  const findCurrentSubtitle = useMemo(() => createSubtitleCueIndex(subtitleData, processSubtitleText), [subtitleData, processSubtitleText]);

  const loadMedia = useCallback(async (request: MediaToPlay, fallback = false) => {
    recordDesktopStage("stream-resolving");
    const generation = ++loadGenerationRef.current;
    subtitleSelectionRequest.current++;
    if (!fallback) {
      subtitleManualOverride.current = false;
      subtitleShortcutEnabled.current = null;
    }
    subtitleDefaultApplied.current = subtitleManualOverride.current;
    subtitleDefaultSource.current = null;
    playbackPreferencesRef.current = readPlaybackPreferences();
    setSubtitleOptionsReady(false);
    setFetchingSubtitles(false);
    setRequestedSubtitleSrc(null);
    metadataAbortRef.current?.abort();
    const metadataAbort = new AbortController();
    metadataAbortRef.current = metadataAbort;
    const subtitleLoader = new PlaybackSubtitles(metadataAbort.signal, subtitleQueries?.discover,
      subtitleQueries ? (src, signal) => subtitleQueries.file(src, signal, subtitleMediaKey(activeMedia)) : undefined, Boolean(subtitleQueries));
    subtitleLoaderRef.current = subtitleLoader;
    playbackStartRef.current = null;
    confirmWebPlaybackRef.current = null;
    if (!fallback) {
      activePlaybackRequestRef.current = request;
      webStreamsRef.current = [];
      failedStreamUrlsRef.current.clear();
      toast.dismiss(WEB_RECOVERY_TOAST_ID);
    }
    const isCurrent = () => generation === loadGenerationRef.current;
    setLoading(true);
    setVideoReady(false);
    setPlaybackError(null);
    setStreamUrl(null);
    const initialDetails = initialPlaybackDetails(request);
    mediaDetailsOwner.current = activePlaybackRequestRef.current || request;
    const initialBackdrop = playbackBackdrop(request);
    if (initialBackdrop) preload(initialBackdrop, { as: "image", fetchPriority: "high" });
    if (initialDetails.logo) preload(initialDetails.logo, { as: "image", fetchPriority: "high" });
    setMediaDetails(initialDetails);
    setSubtitleTracks([]);
    setSubtitleData([]);
    subtitleCatalogOwner.current = null;

    setPlaybackPhase(request.streamUrl ? "loading-stream" : "fetching-streams");

    let activeMedia = request;
    let latestDetails: MediaItem | null = initialDetails;
    let metadataLoaded = Boolean(request.detailsLoaded);
    let sourceReady = false;
    let resolvedEpisodeTitle: string | undefined;
    let resolvedEpisodeRuntime: string | undefined;
    let episodeLookupKey: string | undefined;
    const episodeRequests = new Map<string, ReturnType<typeof fetchPlaybackEpisode>>();
    const loadEpisode = (id: string, season: number, episode: number) => {
      const key = `${id}:${season}:${episode}`;
      let pending = episodeRequests.get(key);
      if (!pending) {
        pending = metadataQueries ? metadataQueries.episodeDetails(id, season, episode, metadataAbort.signal) : fetchPlaybackEpisode(id, season, episode, metadataAbort.signal);
        episodeRequests.set(key, pending);
      }
      return pending;
    };
    const publishTitle = () => {
      activeMedia = { ...activeMedia, details: latestDetails || undefined, detailsLoaded: metadataLoaded };
      const titles = getPlaybackTitles(activeMedia, latestDetails);
      const title = resolvedEpisodeTitle || titles.episodeTitle;
      if (titles.isEpisode && title) activeMedia = {
        ...activeMedia, name: title, episodeTitle: title,
        showName: activeMedia.showName || latestDetails?.name,
      };
      setPreparedPlayback({ request: activePlaybackRequestRef.current || request, media: activeMedia });
      if (sourceReady) setCurrentMediaWithSource({
        ...activeMedia,
        id: activeMedia.seriesId || activeMedia.id,
        mediaSourceId: activeMedia.mediaSourceId || activeMedia.id,
      });
    };

    let subtitleFinalizing = false;
    const preloadSubtitle = (tracks: PlaybackSubtitleTrack[]) => {
      if (isCurrent() && !subtitleManualOverride.current) subtitleLoader.preload(tracks, playbackPreferencesRef.current);
    };
    const discoverSubtitlesEarly = (target: MediaToPlay) => {
      const title = resolvedEpisodeTitle || getPlaybackTitles(target, latestDetails).episodeTitle;
      void subtitleLoader.discover(target.mediaSourceId || target.id, target.type, {
        filename: target.subtitleFilename, videoSize: target.subtitleVideoSize,
        episodeTitle: isMeaningfulEpisodeTitle(title) ? title : undefined,
      }).then(tracks => {
        if (!isCurrent()) return;
        if (!subtitleFinalizing) preloadSubtitle(tracks);
        // Keep provisional choices out of the menu until the final release/
        // episode match. Preloading must not change a user's active selection.
      }).catch(() => {});
    };

    const resolveEpisodeTitle = () => {
      const titles = getPlaybackTitles(activeMedia, latestDetails);
      if (!titles.isEpisode || titles.season === undefined || titles.episodeNumber === undefined) return;
      if (!metadataQueries && isMeaningfulEpisodeTitle(titles.episodeTitle) && titles.episodeTitle !== titles.showTitle) return;
      const seriesId = activeMedia.seriesId || activeMedia.id;
      const key = `${seriesId}:${titles.season}:${titles.episodeNumber}`;
      if (episodeLookupKey === key) return;
      episodeLookupKey = key;
      void loadEpisode(seriesId, titles.season, titles.episodeNumber).then(episode => {
        if (!isCurrent() || !episode || episodeLookupKey !== key) return;
        if (isMeaningfulEpisodeTitle(episode.title)) resolvedEpisodeTitle = episode.title;
        resolvedEpisodeRuntime = typeof episode.runtime === "number" ? `${episode.runtime} min` : episode.runtime;
        if (resolvedEpisodeRuntime && latestDetails) { latestDetails = { ...latestDetails, runtime: resolvedEpisodeRuntime }; setMediaDetails(latestDetails); }
        publishTitle();
      }).catch(() => {});
    };
    // Neither episode names nor show metadata wait on stream resolution or each other.
    publishTitle();
    resolveEpisodeTitle();
    if (!request.detailsLoaded) void (metadataQueries ? metadataQueries.details(request, metadataAbort.signal) : fetchPlaybackDetails(request, metadataAbort.signal)).then(details => {
      if (!isCurrent()) return;
      latestDetails = mergePlaybackDetails(initialDetails, details);
      if (resolvedEpisodeRuntime) latestDetails.runtime = resolvedEpisodeRuntime;
      metadataLoaded = Boolean(details);
      setMediaDetails(latestDetails);
      publishTitle();
    }).catch(() => {});

    try {
      const probe = !nativePlayback && playbackPreferencesRef.current.autoSelectWebStream && typeof document.createElement === "function" ? document.createElement("video") : null;
      const media = await resolvePlayback(request, {
        autoSelectWebStream: playbackPreferencesRef.current.autoSelectWebStream,
        preferredAudioLanguage: playbackPreferencesRef.current.audioLanguage,
        resolveId: (id, type) => fetchPlaybackId(id, type, metadataAbort.signal),
        signal: metadataAbort.signal,
        createStreamRequest: !fallback || !webStreamsRef.current.length
          // Discovery is shared across fallback attempts and uses its own
          // bounded request timeouts; per-load abort only cancels selection/probes.
          ? (id, type) => streamQueries ? streamQueries.create(id, type, metadataAbort.signal) : createPlaybackStreamRequest(id, type)
          : undefined,
        fetchStreams: fallback && webStreamsRef.current.length
          ? async () => webStreamsRef.current : (id, type) => streamQueries
            ? streamQueries.create(id, type, metadataAbort.signal).promise : fetchPlaybackStreams(id, type),
        getNextEpisodeForSeries: id => loadEpisode(id, 1, 1),
        environment: nativePlayback ? "native" : "web",
        canPlayType: probe ? mime => Boolean(probe.canPlayType(mime)) : undefined,
        inspectStream: probe ? (candidate, options) => probeStreamMetadata(candidate, { signal: options.signal, budget: options.budget }) : undefined,
        verifyStream: (candidate, options) => probeStreamPlayability(candidate, { signal: options.signal, metadata: options.metadata,
          timeoutMs: options.timeoutMs, onAudioLanguage: options.onAudioLanguage, preferredAudioLanguage: playbackPreferencesRef.current.audioLanguage }),
        onPlaybackConfirmation: confirm => {
          if (isCurrent()) confirmWebPlaybackRef.current = confirm;
          return () => { if (confirmWebPlaybackRef.current === confirm) confirmWebPlaybackRef.current = null; };
        },
        excludeUrls: !nativePlayback ? failedStreamUrlsRef.current : undefined,
        onCandidates: candidates => { if (isCurrent() && !nativePlayback) webStreamsRef.current = candidates; },
      }, phase => {
        if (isCurrent()) setPlaybackPhase(phase);
      }, target => {
        if (!isCurrent()) return;
        activeMedia = target;
        resolveEpisodeTitle();
        publishTitle();
        discoverSubtitlesEarly(target);
      });
      if (!isCurrent()) return;
      // Keep an episode title that arrived while the source request was pending.
      recordDesktopStage("stream-resolved");
      const earlyTitle = activeMedia.episodeTitle;
      activeMedia = { ...media, episodeTitle: earlyTitle || media.episodeTitle };
      sourceReady = true;
      publishTitle();
      setRequestHeaders(media.requestHeaders ?? {});
      setStreamUrl(media.streamUrl || null);
      setLoading(false);
      const streamSourceId = media.mediaSourceId || media.id;

      // Refine the early catalog with release details without delaying playback.
      subtitleFinalizing = true;
      const subtitleTitle = resolvedEpisodeTitle || getPlaybackTitles(activeMedia, latestDetails).episodeTitle;
      const subtitleEpisodeTitle = isMeaningfulEpisodeTitle(subtitleTitle) ? Promise.resolve(subtitleTitle)
        : media.seasonNumber !== undefined && media.episodeNumber !== undefined
          ? loadEpisode(media.seriesId || media.id, media.seasonNumber, media.episodeNumber).then(episode => episode?.title).catch(() => undefined)
          : Promise.resolve(undefined);
      void subtitleEpisodeTitle.then(episodeTitle => {
        if (!isCurrent()) return [];
        return subtitleLoader.discover(streamSourceId, media.type, {
          filename: media.subtitleFilename, videoSize: media.subtitleVideoSize, episodeTitle,
        });
      }).then(tracks => {
        if (isCurrent()) {
          preloadSubtitle(tracks);
          subtitleCatalogOwner.current = activePlaybackRequestRef.current || request;
          setSubtitleTracks(tracks.map(track => ({ ...track, active: false })));
          setSubtitleOptionsReady(true);
        }
      }).catch(() => {
        if (isCurrent()) { setSubtitleTracks([]); setSubtitleOptionsReady(true); }
      });
    } catch (error) {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : "Could not load this stream. Try again.";
      setPlaybackError(message);
      if (fallback) toast.error(message, { id: WEB_RECOVERY_TOAST_ID });
      if (request.navigatorActionId) document.dispatchEvent(new CustomEvent(NAVIGATOR_PLAYBACK_EVENT, {
        detail: { actionId: request.navigatorActionId, state: "error", message },
      }));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [nativePlayback, setCurrentMediaWithSource, streamQueries, metadataQueries, subtitleQueries]);
  loadMediaRef.current = loadMedia;

  useEffect(() => {
    if (!playbackRequest || !isPlayerVisible || !playbackKey) return;
    if (lastLoadedPlaybackKeyRef.current === playbackKey) return;

    lastLoadedPlaybackKeyRef.current = playbackKey;
    playbackStartedReportedRef.current = false;
    playbackStoppedReportedRef.current = false;
    playbackReporterRef.current?.begin();
    setVideoReady(false);
    currentTimeRef.current = 0;
    setDuration(0);
    setCurrentTimestamp(0);
    void loadMedia(playbackRequest);
  }, [playbackRequest, isPlayerVisible, playbackKey, loadMedia, setCurrentTimestamp]);

  useEffect(() => {
    if (nativePlayback || !streamUrl || !videoRef.current) return;
    return installAudioLanguagePreference(videoRef.current, playbackPreferencesRef.current.audioLanguage);
  }, [nativePlayback, streamUrl, playerAttempt]);

  // Metadata and canplay aren't playback progress; only media-time movement is.
  useEffect(() => {
    if (nativePlayback || !streamUrl || !playbackPreferencesRef.current.autoSelectWebStream) return;
    const element = videoRef.current;
    if (!element) return;
    return installWebStartupWatchdog(element, () => tryNextWebStream(element), document);
  }, [nativePlayback, streamUrl, playerAttempt, tryNextWebStream, currentMedia?.resumePositionTicks]);

  // Handle skip timestamp
  useEffect(() => {
    if (skipTimestamp === null) return;

    if (videoRef.current) {
      videoRef.current.currentTime = skipTimestamp;
      currentTimeRef.current = skipTimestamp;
      setCurrentTimestamp(skipTimestamp);
    }
  }, [skipTimestamp, setCurrentTimestamp]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      loadGenerationRef.current++;
      metadataAbortRef.current?.abort();
      lastLoadedPlaybackKeyRef.current = null;
    };
  }, []);

  const selectSubtitle = useCallback(async (track: { src: string } | null) => {
    const request = ++subtitleSelectionRequest.current;
    const generation = loadGenerationRef.current;
    const isCurrent = () => request === subtitleSelectionRequest.current && generation === loadGenerationRef.current;
    const disableEmbedded = () => {
      if (nativePlayback) (videoRef.current as unknown as MpvElementHandle | null)?.controller?.selectTrack("subtitle", "no");
      for (const textTrack of Array.from(videoRef.current?.textTracks || [])) {
        if (["subtitles", "captions"].includes(textTrack.kind)) textTrack.mode = "disabled";
      }
    };
    setRequestedSubtitleSrc(track?.src ?? null);
    setFetchingSubtitles(Boolean(track));
    if (!track) {
      disableEmbedded();
      setSubtitleData([]);

      setSubtitleTracks(previous => previous.map(value => ({ ...value, active: false })));
      return;
    }
    try {
      const result = await subtitleLoaderRef.current?.file(track.src);
      if (!isCurrent()) return;
      if (!result?.success) throw new Error("Subtitle download failed");
      const cues = result.cues || parseSubtitleTextContent(result.content);
      if (!cues.length) throw new Error("No subtitle cues found");
      disableEmbedded();
      setSubtitleData(cues);

      setSubtitleTracks(previous => previous.map(value => ({ ...value, active: value.src === track.src })));
    } catch {
      if (isCurrent()) toast.error("Couldn’t load these subtitles. Try another track.");
    } finally {
      if (isCurrent()) {
        setFetchingSubtitles(false);
        setRequestedSubtitleSrc(null);
      }
    }
  }, [nativePlayback, parseSubtitleTextContent]);

  useEffect(() => {
    if (!isPlayerVisible || !streamUrl) return;
    const element = videoRef.current as unknown as MpvElementHandle | null;
    const choose = () => {
      const preferences = playbackPreferencesRef.current;
      if (!(subtitleShortcutEnabled.current ?? preferences.subtitlesEnabledByDefault)) return;
      if (subtitleManualOverride.current || (subtitleDefaultApplied.current && subtitleDefaultSource.current !== "external")) return;
      const embedded = preferredSubtitleTrack(element?.controller?.tracks.filter(track => track.type === "sub") || [], preferences.subtitleLanguage, preferences.subtitleMode);
      if (embedded && element?.controller) {
        if (subtitleDefaultSource.current === "external") void selectSubtitle(null);
        subtitleDefaultApplied.current = true;
        subtitleDefaultSource.current = "embedded";
        element.controller.selectTrack("subtitle", String(embedded.id));
        return;
      }
      // Safari and HLS elements can expose in-stream captions as TextTracks.
      const textTracks = videoRef.current?.textTracks;
      const browserTracks = textTracks ? Array.from(textTracks).filter(track => ["subtitles", "captions"].includes(track.kind)) : [];
      const browserTrack = preferredSubtitleTrack(browserTracks, preferences.subtitleLanguage, preferences.subtitleMode);
      if (browserTrack) {
        if (subtitleDefaultSource.current === "external") void selectSubtitle(null);
        subtitleDefaultApplied.current = true;
        subtitleDefaultSource.current = "embedded";
        for (const track of browserTracks) track.mode = track === browserTrack ? "showing" : "disabled";
        return;
      }
      // Native track discovery and browser metadata race the addon response.
      // Wait for metadata before committing to an external fallback.
      if (subtitleDefaultApplied.current || !subtitleOptionsReady || (videoRef.current?.readyState ?? 0) < 1) return;
      const downloaded = preferredSubtitleTrack(subtitleTracks, preferences.subtitleLanguage, preferences.subtitleMode);
      if (downloaded) {
        subtitleDefaultApplied.current = true;
        subtitleDefaultSource.current = "external";
        void selectSubtitle(downloaded);
      }
    };
    choosePreferredSubtitle.current = choose;
    choose();
    element?.addEventListener("loadedmetadata", choose);
    element?.addEventListener("trackschange", choose);
    const textTracks = videoRef.current?.textTracks;
    textTracks?.addEventListener("addtrack", choose);
    return () => {
      choosePreferredSubtitle.current = null;
      element?.removeEventListener("loadedmetadata", choose);
      element?.removeEventListener("trackschange", choose);
      textTracks?.removeEventListener("addtrack", choose);
    };
  }, [isPlayerVisible, streamUrl, subtitleOptionsReady, subtitleTracks, playerAttempt, selectSubtitle]);

  const episodeContinuation = useEpisodeContinuation({
    media: currentMedia ? { ...currentMedia, details: mediaDetails || currentMedia.details } : null,
    visible: isPlayerVisible, native: nativePlayback, mediaRef: videoRef, duration, session: playbackRequest,
    creditsStart: skipTimeline.source === streamUrl ? skipTimeline.segments.find(segment => segment.kind === "credits")?.start : undefined,
    play: media => { void playMedia(media); },
    beforeAdvance: ended => sendPlaybackUpdate("stopped", { ended }),
    finish: () => handleClose({ ended: true }),
  });
  episodeContinuationRef.current = episodeContinuation;

  const embeddedSubtitleTiming = useNativeSubtitleTiming(videoRef, subtitleTiming.seconds,
    subtitleTracks.some(track => track.active), `${streamUrl}:${playerAttempt}`, nativePlayback);

  const subtitleTimingActions = useMemo(() => ({
    seconds: subtitleTiming.seconds, open: Boolean(subtitleTiming.key && timingOpenKey === subtitleTiming.key),
    onOpen: () => setTimingOpenKey(subtitleTiming.key), onClose: () => setTimingOpenKey(null),
  }), [subtitleTiming.seconds, subtitleTiming.key, timingOpenKey]);
  const handleCustomSubtitleChange = useCallback((track: { src: string } | null) => {
    subtitleShortcutEnabled.current = null;
    subtitleManualOverride.current = true;
    subtitleDefaultApplied.current = true;
    subtitleDefaultSource.current = null;
    void selectSubtitle(track);
  }, [selectSubtitle]);
  const toggleCaptions = useCallback(() => {
    const media = videoRef.current;
    const controller = (media as unknown as MpvElementHandle | null)?.controller;
    const active = subtitleShortcutEnabled.current ?? (
      subtitleDefaultSource.current === "embedded" || Boolean(requestedSubtitleSrc) || subtitleTracks.some(track => track.active)
      || Boolean(controller?.tracks.some(track => track.type === "sub" && track.selected))
      || Array.from(media?.textTracks ?? []).some(track =>
        (track.kind === "subtitles" || track.kind === "captions") && track.mode === "showing")
    );
    subtitleShortcutEnabled.current = !active;
    subtitleManualOverride.current = active;
    subtitleDefaultApplied.current = false;
    subtitleDefaultSource.current = null;
    if (active) void selectSubtitle(null);
    else choosePreferredSubtitle.current?.();
  }, [requestedSubtitleSrc, selectSubtitle, subtitleTracks]);

  if (!isPlayerVisible || !currentMedia) return null;

  const { isEpisode: isEpisodePlayback, showTitle, primaryTitle, season, episodeNumber } = getPlaybackTitles(currentMedia, mediaDetails);
  // Keep the artwork available at launch through metadata enrichment.
  const fallbackBackdrop = playbackBackdrop(currentMedia) || playbackBackdrop(currentMedia, mediaDetails);
  const titleRating = mediaDetails?.imdbRating ? `IMDb ${mediaDetails.imdbRating}`
    : mediaDetails?.ratingSource === "TMDB" && typeof mediaDetails.communityRating === "number" && mediaDetails.communityRating > 0
      ? `TMDB ${mediaDetails.communityRating.toFixed(1)}` : undefined;
  const loadingLogo = mediaDetails?.logo || initialPlaybackDetails(currentMedia).logo;
  const videoGeneration = loadGenerationRef.current;
  const upNext = streamUrl && !loading && !playbackError ? episodeContinuation.upNext : null;

  const Video = nativePlayback
    ? MpvVideo
    : WebPlaybackVideo;
  return (
    <div data-player-shell="" data-native-player-shell={nativePlayback ? "" : undefined} data-player-enter={playbackRequest?.animateEntrance ? "" : undefined} className="fixed inset-0 z-[var(--layer-player)] flex items-center justify-center w-screen bg-black">
      <MediaPlayer
        autoFocus
        autoHide
        className="w-screen"
        customSubtitleTracks={subtitleTracks}
        customSubtitlesEnabled={subtitleTracks.length > 0}
        subtitleTiming={subtitleTimingActions}
        chapters={chapters}
        onToggleCaptions={toggleCaptions}
        onKeyDown={event => {
          if (event.defaultPrevented || event.key !== "Escape" || !episodeContinuation.upNext) return;
          event.preventDefault();
          event.stopPropagation();
          episodeContinuation.cancelUpNext();
        }}
        onCustomSubtitleChange={handleCustomSubtitleChange}
      >
        <SubtitleTimingPopover open={Boolean(subtitleTiming.key && timingOpenKey === subtitleTiming.key)}
          onOpenChange={open => setTimingOpenKey(open ? subtitleTiming.key : null)}
          seconds={subtitleTiming.seconds} onChange={subtitleTiming.onChange}
          available={embeddedSubtitleTiming || (subtitleData.length > 0 && subtitleTracks.some(track => track.active) && !fetchingSubtitles)}
          container={videoRef.current?.closest<HTMLElement>('[data-slot="media-player"]')} />
        <NativePlayerGlass mediaRef={videoRef} sourceKey={`${streamUrl}:${playerAttempt}`} ready={videoReady && !loading && !playbackError} />
        <PlaybackWakeLock mediaRef={videoRef} sourceKey={`${streamUrl}:${playerAttempt}`} enabled={!nativePlayback && !!streamUrl && !playbackError} />
        {!nativePlayback && <BrowserPlayerGlass mediaRef={videoRef} sourceKey={`${streamUrl}:${playerAttempt}`} ready={videoReady && !loading && !playbackError} />}
        {showPlaybackStats && !nativePlayback && streamUrl && <PlayerPlaybackStats key={`${streamUrl}:${playerAttempt}`} videoRef={videoRef} />}
        {/* Video element */}
        {streamUrl && activePlaybackRequestRef.current === playbackRequest && (
          <MediaPlayerVideo asChild>
            <Video
              key={`${streamUrl}:${playerAttempt}`}
              // @ts-ignore
              ref={videoRef}
              src={streamUrl}
              {...(nativePlayback ? { requestHeaders, startPosition: currentMedia.type === "series" ? 0 : currentMedia.resumePositionTicks ?? 0,
                onPreloadFallback: () => setVideoReady(false) } : { startPosition: currentMedia.resumePositionTicks })}
              {...(nativePlayback && !playerAttempt && currentMedia?.nativePreload?.source === streamUrl
                ? { preloadSrc: currentMedia.nativePreload.url, preloadExpires: currentMedia.nativePreload.expires } : {})}
              crossOrigin=""
              playsInline
              preload="auto"
              autoPlay={false}
              className="h-screen bg-black w-screen"
              onPause={handleVideoPause}
              onPlaying={handleVideoPlaying}
              onEnded={(event) => handleVideoEnded(event, videoGeneration)}
              onLoadedMetadata={handleVideoLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onDurationChange={handleDurationChange}
              onCanPlay={handleVideoCanPlay}
              onLoadedData={handleVideoCanPlay}
              onError={(event) => handleVideoError(event, videoGeneration)}
            />
          </MediaPlayerVideo>
        )}

        {/* Loading overlay */}
        {(loading || !streamUrl || !videoReady || playbackError) && (
          <div className="fixed inset-0 bg-black z-40">


            <div className="absolute inset-0" aria-hidden="true">
              {fallbackBackdrop && (
                <ArtworkImage
                  src={fallbackBackdrop}
                  draggable={false}
                  fetchPriority="high"
                  fallbackText=""
                  className="size-full object-cover brightness-75 data-[artwork-state=error]:hidden"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            </div>

            <Button
              data-player-close=""
              data-player-glass=""
              aria-label="Back to browsing"
              variant="ghost"
              size="icon"
              className="fixed left-4 top-4 z-10 rounded-full"
              onClick={() => handleClose()}
            >
              <ArrowLeft className="size-5" />
            </Button>

            {loadingLogo && (
              <PlayerLoadingWordmark
                key={loadingLogo}
                src={loadingLogo}
                alt={`${showTitle || primaryTitle} logo`}
                loading={!playbackError}
              />
            )}

            {/* Title and loading spinner */}
            <motion.div
              initial={false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              data-player-loading-copy=""
              className="absolute bottom-7 left-4 right-4"
            >
              <motion.div
                initial={false}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2, duration: 0.5 }}
                className="flex flex-col w-full gap-1.5 pb-1"
              >
                <div className="flex items-center justify-between w-full">
                  <motion.h2
                    data-player-title=""
                    title={primaryTitle}
                    className="text-3xl font-semibold text-white truncate font-poppins"
                    initial={false}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                  >
                    {primaryTitle}
                  </motion.h2>
                </div>

                {isEpisodePlayback && showTitle && (
                  <motion.p
                    data-player-loading-series=""
                    className="text-sm text-white/75 truncate"
                    initial={false}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                  >
                    {showTitle}
                  </motion.p>
                )}

                <motion.div
                  className="flex items-center gap-3 text-sm text-white/60"
                  initial={false}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6 }}
                >
                  {mediaDetails?.runtime && (
                    <span>{formatRuntime(mediaDetails.runtime)}</span>
                  )}
                  {mediaDetails?.year && <span>{mediaDetails.year}</span>}
                  {titleRating && <span>{titleRating}</span>}
                </motion.div>

                <motion.div
                  className="flex items-center gap-2 mt-2"
                  initial={false}
                >
                  {playbackError ? (
                    <div className="flex flex-col items-start gap-3" role="alert">
                      <p className="text-sm text-white">{playbackError}</p>
                      <Button variant="secondary" onClick={() => {
                        setPlaybackError(null);
                        setVideoReady(false);
                        setPlayerAttempt((attempt) => attempt + 1);
                        invalidatePlaybackWarmup(playbackRequest?.streamRequest);
                        if (playbackRequest) streamQueries?.invalidate({ id: playbackRequest.mediaSourceId || playbackRequest.id, type: playbackRequest.type });
                        if (playbackRequest) void loadMedia(playbackRequest);
                      }}>Try again</Button>
                    </div>
                  ) : (
                    <><Loader2 aria-hidden="true" className="size-4 animate-spin text-white/70 motion-reduce:animate-none" />
                    <PlayerLoadingStatus label={playbackPhaseLabels[playbackPhase]} /></>
                  )}
                </motion.div>
              </motion.div>
            </motion.div>
          </div>
        )}

        {/* Clock-driven captions subscribe independently of the player shell. */}
        <PlayerSubtitleLayer key={`${streamUrl}:${playerAttempt}`} mediaRef={videoRef} lookup={findCurrentSubtitle}
          delay={subtitleTiming.seconds} native={nativePlayback} enabled={!loading && videoReady}
          size={subtitleSize} outline={subtitleOutline} weight={subtitleWeight} color={subtitleColor} position={subtitlePosition} />

        {!loading && streamUrl && videoReady && !playbackError && (
          <Button
            data-player-close=""
            data-player-glass=""
            data-player-back-control=""
            aria-label="Back to browsing"
            variant="ghost"
            size="icon"
            className="fixed left-4 top-4 z-50 rounded-full"
            onClick={() => handleClose()}
          >
            <ArrowLeft className="size-5" />
          </Button>
        )}

        {fetchingSubtitles && (
          <div className="pointer-events-none fixed right-4 top-4 z-50 h-9 bg-black/50 backdrop-blur-sm rounded-full px-3 text-white text-sm flex items-center gap-2">
            <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
            <PlayerLoadingStatus label="Fetching subtitles" />
          </div>
        )}

        {upNext && (
          <PlayerUpNext next={upNext.next} thumbnail={upNext.thumbnail}
            seconds={upNext.seconds}
            onPlay={episodeContinuation.playUpNext} onCancel={episodeContinuation.cancelUpNext} />
        )}

        {!playbackError && streamUrl && duration > 0
          && (currentMedia.type === "movie" || currentMedia.type === "series") && (
          <ClockedSkipSegments
            onSegmentsChange={handleSkipSegments}
            onSkipCredits={episodeContinuation.skipCredits}
            hideCredits={Boolean(upNext)}
            enabled={videoReady && !loading}
            key={`${streamUrl}:${playerAttempt}:${currentMedia.seriesId || currentMedia.id}:${season}:${episodeNumber}`}
            lookup={{ id: currentMedia.seriesId || currentMedia.id, type: currentMedia.type,
              season, episode: episodeNumber, duration }}
            mediaRef={videoRef}
            onSeek={time => {
              currentTimeRef.current = time;
              setCurrentTimestamp(time);
            }}
          />
        )}

        <MediaPlayerControls className="flex-col items-start gap-2.5 px-6 pb-4 z-20">


          <MediaPlayerControlsOverlay />

          <div className="flex flex-col w-full gap-1.5 pb-2">
            <div data-player-heading-row="" className="flex min-w-0 items-center justify-between w-full">
              <h2 data-player-title="" title={primaryTitle} className="min-w-0 text-3xl font-semibold text-white truncate font-poppins">
                {primaryTitle}
              </h2>

              <PlayerEndTime key={`${streamUrl}:${playerAttempt}`} duration={duration} mediaRef={videoRef} />
            </div>

            <div data-player-meta="" className="flex min-w-0 items-center gap-3 text-sm text-white/60">
              {isEpisodePlayback && (
                <span className="min-w-0 truncate" title={showTitle || "TV Show"}>
                  {showTitle || "TV Show"}
                  {currentMedia.seasonNumber && currentMedia.episodeNumber
                    ? ` · S${currentMedia.seasonNumber} · E${currentMedia.episodeNumber}`
                    : ""}
                </span>
              )}
              {mediaDetails?.runtime && (
                <span>{formatRuntime(mediaDetails.runtime)}</span>
              )}
              {mediaDetails?.year && <span>{mediaDetails.year}</span>}
              {titleRating && <span>{titleRating}</span>}
            </div>
          </div>

          <MediaPlayerSeek previewFrames previewSource={streamUrl ?? undefined}
            skipSegments={skipTimeline.source === streamUrl ? skipTimeline.segments : []} />

          <div data-player-toolbar="" className="flex w-full items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <MediaPlayerPlay />
              {isEpisodePlayback && season !== undefined && episodeNumber !== undefined && (
                <PlayerNextEpisode next={episodeContinuation?.next || null} advancing={Boolean(episodeContinuation?.busy)}
                  onAdvance={() => episodeContinuation?.advance()} />
              )}
              <MediaPlayerSeekBackward>
                <RotateCcw />
              </MediaPlayerSeekBackward>
              <MediaPlayerSeekForward>
                <RotateCw />
              </MediaPlayerSeekForward>
              <MediaPlayerVolume expandable />
              <MediaPlayerTime />
            </div>
            <div className="flex items-center gap-2">
              {onToggleAIAsk && <PlayerNavigatorButton onToggle={onToggleAIAsk} />}

              <DesktopTracks mediaRef={videoRef} sourceKey={`${streamUrl}:${playerAttempt}`} />
              <PlayerSubtitles mediaRef={videoRef} sourceKey={`${streamUrl}:${playerAttempt}`} native={nativePlayback}
                tracks={subtitleTracks} requestedSrc={requestedSubtitleSrc} onTrackChange={handleCustomSubtitleChange}
                timing={{ seconds: subtitleTiming.seconds, open: Boolean(subtitleTiming.key && timingOpenKey === subtitleTiming.key),
                  onOpen: () => setTimingOpenKey(subtitleTiming.key), onClose: () => setTimingOpenKey(null) }} />
              <PlayerVideoFit key={`${streamUrl}:${playerAttempt}`} mediaRef={videoRef} sourceKey={`${streamUrl}:${playerAttempt}`} />
              <MediaPlayerSettings stats={nativePlayback ? undefined : { open: showPlaybackStats, onToggle: () => setShowPlaybackStats(open => !open) }} />
              {!nativePlayback && <MediaPlayerPiP />}
              <MediaPlayerFullscreen />
            </div>
          </div>
        </MediaPlayerControls>
      </MediaPlayer>
    </div>
  );
}
