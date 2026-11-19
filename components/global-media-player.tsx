"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { JellyfinItem, MediaSourceInfo } from "@/types/jellyfin";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
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
import MuxVideo from "@mux/mux-video-react";
import {
  ArrowLeft,
  RotateCcw,
  RotateCw,
  Users,
  Ship,
  FastForward,
} from "lucide-react";
import { useMediaPlayer } from "@/contexts/MediaPlayerContext";
import {
  getStreamUrl,
  getSubtitleTracks,
  fetchMediaDetails,
  reportPlaybackStart,
  reportPlaybackProgress,
  reportPlaybackStopped,
} from "@/app/actions";
import { getAuthData, getSubtitleContent } from "@/app/actions/subtitles";
import HlsVideoElement from "hls-video-element/react";
import { formatRuntime } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ProgressiveBlur } from "@/components/motion-primitives/progressive-blur";
import { useAuth } from "@/hooks/useAuth";
import { useSettings, BITRATE_OPTIONS } from "@/contexts/settings-context";
import {
  detectDevice,
  getDeviceName,
  isHLSSupported,
} from "@/lib/device-detection";
import { fetchIntroOutro } from "@/app/actions/media";
import { decode } from "blurhash";

interface GlobalMediaPlayerProps {
  onToggleAIAsk?: () => void;
}

interface CustomSubtitleTrack {
  label: string;
  language: string;
  kind: string;
  active: boolean;
}

export function GlobalMediaPlayer({ onToggleAIAsk }: GlobalMediaPlayerProps) {
  const {
    isPlayerVisible,
    setIsPlayerVisible,
    currentMedia,
    skipTimestamp,
    setCurrentMediaWithSource,
    setCurrentTimestamp,
  } = useMediaPlayer();
  const { videoBitrate } = useSettings();

  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [mediaDetails, setMediaDetails] = useState<JellyfinItem | null>(null);
  const [selectedVersion, setSelectedVersion] =
    useState<MediaSourceInfo | null>(null);
  const [activeSubtitleTrack, setActiveSubtitleTrack] =
    useState<CustomSubtitleTrack | null>(null);
  const [subtitleTracks, setSubtitleTracks] = useState<
    Array<{
      kind: string;
      label: string;
      language: string;
      src: string;
      default?: boolean;
      active: boolean;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [videoStarted, setVideoStarted] = useState(false);
  const [fetchingSubtitles, setFetchingSubtitles] = useState(false);
  
  useEffect(() => {
    if (!activeSubtitleTrack) {
      // Turn off subtitles
      setSubtitleData([]);
      setCurrentSubtitle(null);
      // Update all tracks to inactive
      setSubtitleTracks((prev) =>
        prev.map((track) => ({ ...track, active: false })),
      );
      return;
    }

    const trackIndex = subtitleTracks.findIndex(
      (track) => track.label === activeSubtitleTrack.label,
    );

    if (currentMedia && trackIndex !== -1) {
      setFetchingSubtitles(true);
      getSubtitleContent(
        currentMedia.id,
        selectedVersion?.Id || currentMedia.id,
        trackIndex,
      ).then((result) => {
        setFetchingSubtitles(false);
        if (result.success) {
          setSubtitleData(result.subtitles);
          setCurrentSubtitle(null); // Reset current subtitle to show from data
          // Update track states - mark selected as active, others as inactive
          setSubtitleTracks((prev) =>
            prev.map((track, idx) => ({
              ...track,
              active: idx === trackIndex,
            })),
          );
        }
      });
    }
  }, [activeSubtitleTrack, currentMedia]);

  // Backdrop image state
  const [backdropImageLoaded, setBackdropImageLoaded] = useState(false);
  const [blurDataUrl, setBlurDataUrl] = useState<string | null>(null);
  
  const [currentSubtitle, setCurrentSubtitle] = useState<{
    text: string;
    positionTop: boolean;
  } | null>(null);
  const [subtitleData, setSubtitleData] = useState<
    Array<{
      timestamp: number;
      timestampFormatted: string;
      text: string;
    }>
  >([]);

  // Chapter state
  const [chapters, setChapters] = useState<
    Array<{
      startTime: number;
      endTime: number;
      text: string;
    }>
  >([]);

  // Intro/Outro segments state
  const [mediaSegments, setMediaSegments] = useState<{
    intro?: { startTime: number; endTime: number };
    outro?: { startTime: number; endTime: number };
  }>({});

  // Progress tracking state
  const [playSessionId, setPlaySessionId] = useState<string | null>(null);
  const [hasStartedPlayback, setHasStartedPlayback] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const blobUrlsRef = useRef<string[]>([]);

  // Helper function to convert seconds to Jellyfin ticks (1 tick = 100 nanoseconds)
  const secondsToTicks = (seconds: number) => Math.floor(seconds * 10000000);

  // Helper function to convert Jellyfin ticks to seconds
  const ticksToSeconds = (ticks: number) => ticks / 10000000;

  // Helper function to convert Jellyfin chapters to expected format
  const convertJellyfinChapters = useCallback(
    (jellyfinChapters: any[]) => {
      if (!jellyfinChapters || jellyfinChapters.length === 0) return [];

      return jellyfinChapters.map((chapter, index) => {
        const startTime = ticksToSeconds(chapter.StartPositionTicks);
        const nextChapter = jellyfinChapters[index + 1];
        const endTime = nextChapter
          ? ticksToSeconds(nextChapter.StartPositionTicks)
          : duration; // Use video duration for the last chapter

        return {
          startTime,
          endTime,
          text: chapter.Name || `Chapter ${index + 1}`,
        };
      });
    },
    [duration]
  );

  const { serverUrl } = useAuth();

  // Helper function to format time to HH:MM AM/PM
  const formatEndTime = (currentSeconds: number, durationSeconds: number) => {
    const remainingSeconds = durationSeconds - currentSeconds;
    const endTime = new Date(Date.now() + remainingSeconds * 1000);
    return endTime.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  // Start progress tracking
  const startProgressTracking = useCallback(async () => {
    if (!currentMedia || !selectedVersion || !videoRef.current) return;

    // Skip progress tracking for test videos
    if (currentMedia.id === "test-big-buck-bunny") {
      console.log("🧪 Skipping progress tracking for test video");
      setHasStartedPlayback(true);
      return;
    }

    const sessionId = crypto.randomUUID();
    setPlaySessionId(sessionId);

    // Report playback start
    await reportPlaybackStart(currentMedia.id, selectedVersion.Id!, sessionId);
    setHasStartedPlayback(true);

    // Set up progress reporting interval (every 10 seconds)
    progressIntervalRef.current = setInterval(async () => {
      if (videoRef.current && !videoRef.current.paused) {
        const currentTime = videoRef.current.currentTime;
        const positionTicks = secondsToTicks(currentTime);

        await reportPlaybackProgress(
          currentMedia.id,
          selectedVersion.Id!,
          sessionId,
          positionTicks,
          videoRef.current.paused
        );
      }
    }, 10000); // Report every 10 seconds
  }, [currentMedia, selectedVersion]);

  // Stop progress tracking
  const stopProgressTracking = useCallback(async () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }

    if (playSessionId && currentMedia && selectedVersion && videoRef.current) {
      const currentTime = videoRef.current.currentTime;
      const positionTicks = secondsToTicks(currentTime);

      await reportPlaybackStopped(
        currentMedia.id,
        selectedVersion.Id!,
        playSessionId,
        positionTicks
      );
    }

    setPlaySessionId(null);
    setHasStartedPlayback(false);
  }, [playSessionId, currentMedia, selectedVersion]);

  // Handle video events
  const handleVideoPlay = useCallback(() => {
    setVideoStarted(true); // Mark that video has started playing
    if (!hasStartedPlayback) {
      startProgressTracking();
    }
  }, [hasStartedPlayback, startProgressTracking]);

  const handleVideoPause = useCallback(async () => {
    if (playSessionId && currentMedia && selectedVersion && videoRef.current) {
      const currentTime = videoRef.current.currentTime;
      const positionTicks = secondsToTicks(currentTime);

      await reportPlaybackProgress(
        currentMedia.id,
        selectedVersion.Id!,
        playSessionId,
        positionTicks,
        true // isPaused = true
      );
    }
  }, [playSessionId, currentMedia, selectedVersion]);

  // Handle video time updates
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      const time = videoRef.current.currentTime;
      setCurrentTime(time);
      setCurrentTimestamp(time); // Update context with current time
    }
  }, [setCurrentTimestamp]);

  // Handle duration change
  const handleDurationChange = useCallback(() => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);

      // Update chapters end times when duration is available
      if (mediaDetails?.Chapters && mediaDetails.Chapters.length > 0) {
        const convertedChapters = convertJellyfinChapters(
          mediaDetails.Chapters
        );
        setChapters(convertedChapters);
      }
    }
  }, [mediaDetails, convertJellyfinChapters]);

  // Set video to resume position if provided
  const handleVideoLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);

      if (currentMedia?.resumePositionTicks) {
        const resumeTime = ticksToSeconds(currentMedia.resumePositionTicks);
        videoRef.current.currentTime = resumeTime;
        setCurrentTime(resumeTime);
        // Only start playing after we've set the correct position
        videoRef.current.play();
      }
    }
  }, [currentMedia]);

  // Helper function to clean up blob URLs
  const cleanupBlobUrls = useCallback(() => {
    blobUrlsRef.current.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch (error) {
        console.warn("Failed to revoke blob URL:", error);
      }
    });
    blobUrlsRef.current = [];
  }, []);

  // Define handleClose first to avoid circular dependency
  const handleClose = useCallback(async () => {
    // Stop progress tracking before closing
    await stopProgressTracking();

    // Clean up blob URLs
    cleanupBlobUrls();

    setIsPlayerVisible(false);
    setStreamUrl(null);
    setMediaDetails(null);
    setSelectedVersion(null);
    setSubtitleTracks([]);
    setCurrentTime(0);
    setDuration(0);
    setFetchingSubtitles(false);
    setCurrentMediaWithSource(null);
    setMediaSegments({});
    setVideoStarted(false); // Reset video started state
    setBackdropImageLoaded(false); // Reset backdrop image state
    setBlurDataUrl(null); // Reset blur data URL
  }, [stopProgressTracking, cleanupBlobUrls]);

  const handleVideoEnded = useCallback(async () => {
    await stopProgressTracking();
    handleClose();
  }, [stopProgressTracking, handleClose]);

  // Helper function to process subtitle text for HTML rendering
  const processSubtitleText = useCallback((text: string) => {
    // Check if subtitle should be positioned at top (an8)
    const shouldPositionTop = /\{\\an8\}/.test(text);
    // Remove ASS/SSA positioning tags like {\an8}
    let processedText = text.replace(/\{\\an\d+\}/g, "");
    // Convert \n to <br> tags for line breaks
    processedText = processedText.replace(/\n/g, "<br>");

    return {
      text: processedText,
      positionTop: shouldPositionTop,
    };
  }, []);

  // Find current subtitle based on video time
  const findCurrentSubtitle = useCallback(
    (currentTimeSeconds: number) => {
      if (subtitleData.length === 0) return null;

      // Find subtitle that should be displayed at current time
      // For now, we'll use a simple approach - find the subtitle with the closest timestamp that's <= current time
      let currentSub = null;
      for (let i = 0; i < subtitleData.length; i++) {
        const subtitle = subtitleData[i];
        if (subtitle.timestamp <= currentTimeSeconds) {
          currentSub = subtitle;
        } else {
          break;
        }
      }

      // Only show subtitle if we're within a reasonable time window (e.g., 5 seconds)
      if (currentSub && currentTimeSeconds - currentSub.timestamp <= 5) {
        return processSubtitleText(currentSub.text);
      }

      return null;
    },
    [subtitleData, processSubtitleText]
  );

  useEffect(() => {
    if (currentMedia && isPlayerVisible) {
      setVideoStarted(false); // Reset video started state when loading new media
      setBackdropImageLoaded(false); // Reset backdrop image state
      setBlurDataUrl(null); // Reset blur data URL
      loadMedia();
    }
  }, [currentMedia, isPlayerVisible, videoBitrate]);

  // Decode blur hash for backdrop image
  useEffect(() => {
    if (mediaDetails && !blurDataUrl) {
      // Get blur hash for backdrop
      const backdropImageTag = mediaDetails.Type === "Episode" 
        ? mediaDetails.ParentBackdropImageTags?.[0]
        : mediaDetails.BackdropImageTags?.[0];
      const blurHash =
        mediaDetails.ImageBlurHashes?.["Backdrop"]?.[backdropImageTag!] || "";

      if (blurHash) {
        try {
          const pixels = decode(blurHash, 32, 32);
          const canvas = document.createElement("canvas");
          canvas.width = 32;
          canvas.height = 32;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            const imageData = ctx.createImageData(32, 32);
            imageData.data.set(pixels);
            ctx.putImageData(imageData, 0, 0);
            setBlurDataUrl(canvas.toDataURL());
          }
        } catch (error) {
          console.error("Error decoding blur hash:", error);
        }
      }
    }
  }, [mediaDetails, blurDataUrl]);

  const loadMedia = async () => {
    if (!currentMedia) return;

    console.log("Current media:", currentMedia);

    setLoading(true);
    try {
      // Regular Jellyfin media handling
      const details = await fetchMediaDetails(currentMedia.id);
      if (!details) {
        console.error("Failed to fetch media details");
        return;
      }

      setMediaDetails(details);
      console.log(details);

      // Use selected version from MediaActions or fallback to first source
      if (details.MediaSources && details.MediaSources.length > 0) {
        let sourceToUse = details.MediaSources[0]; // fallback

        // If a version was selected in MediaActions, try to find it in the fetched details
        if (currentMedia.selectedVersion) {
          const matchingSource = details.MediaSources.find(
            (source) => source.Id === currentMedia.selectedVersion!.Id
          );
          if (matchingSource) {
            sourceToUse = matchingSource;
          }
        }

        setSelectedVersion(sourceToUse);

        // Update the current media with source information for the AI chat context
        setCurrentMediaWithSource({
          id: currentMedia.id,
          name: currentMedia.name,
          type: currentMedia.type,
          mediaSourceId: sourceToUse.Id || null,
        });

        // Generate stream URL with bitrate setting
        const bitrateOption = BITRATE_OPTIONS.find(
          (option) => option.value === videoBitrate
        );
        const bitrate = bitrateOption?.bitrate || 0; // 0 means auto/no limit
        const streamUrl = await getStreamUrl(
          currentMedia.id,
          sourceToUse.Id!,
          undefined,
          bitrate
        );
        setStreamUrl(streamUrl);

        // Start fetching subtitle data asynchronously without blocking playback
        const subtitleTracksList = await getSubtitleTracks(
          currentMedia.id,
          sourceToUse.Id!
        );
        // Mark all subtitle tracks as inactive initially
        const tracksWithActiveState = subtitleTracksList.map((track) => ({
          ...track,
          active: false,
        }));
        setSubtitleTracks(tracksWithActiveState);

        const { serverUrl: _, user } = await getAuthData();

        const preferredSubtitleTrack = user?.Configuration
          ?.SubtitleLanguagePreference
          ? tracksWithActiveState.find(
              (_track) =>
                _track.language ===
                user?.Configuration?.SubtitleLanguagePreference,
            )
          : null;
        if (preferredSubtitleTrack)
          setActiveSubtitleTrack(preferredSubtitleTrack);
        else setActiveSubtitleTrack(null); // Don't load any subtitle by default - let user choose

        // Process chapters if available
        if (details.Chapters && details.Chapters.length > 0) {
          const convertedChapters = convertJellyfinChapters(details.Chapters);
          setChapters(convertedChapters);
        } else {
          setChapters([]);
        }

        // Fetch intro/outro segments asynchronously
        try {
          const segments = await fetchIntroOutro(
            currentMedia.selectedVersion?.Id || sourceToUse.Id!
          );
          console.log("Fetched intro/outro segments:", segments);
          if (segments && segments.Items) {
            const processedSegments: {
              intro?: { startTime: number; endTime: number };
              outro?: { startTime: number; endTime: number };
            } = {};

            segments.Items.forEach((segment) => {
              const startTime = ticksToSeconds(segment.StartTicks);
              const endTime = ticksToSeconds(segment.EndTicks);
              if (segment.Type === "Intro") {
                processedSegments.intro = { startTime, endTime };
              } else if (segment.Type === "Outro") {
                processedSegments.outro = { startTime, endTime };
              }
            });

            setMediaSegments(processedSegments);
            console.log("Media segments loaded:", processedSegments);
          }
        } catch (error) {
          console.error("Failed to fetch intro/outro segments:", error);
          setMediaSegments({});
        }
      }
    } catch (error) {
      console.error("Failed to load media:", error);
    } finally {
      setLoading(false);
    }
  };

  // Update current subtitle based on video time
  useEffect(() => {
    const subtitle = findCurrentSubtitle(currentTime);
    console.log(subtitle);
    setCurrentSubtitle(subtitle);
  }, [currentTime, findCurrentSubtitle]);

  // Handle skip timestamp
  useEffect(() => {
    if (skipTimestamp !== null && videoRef.current) {
      console.log(`Skipping to timestamp: ${skipTimestamp} seconds`);
      videoRef.current.currentTime = skipTimestamp;
      setCurrentTime(skipTimestamp);
    }
  }, [skipTimestamp]);

  // Skip intro handler
  const handleSkipIntro = useCallback(() => {
    if (mediaSegments.intro && videoRef.current) {
      const skipToTime = mediaSegments.intro.endTime;
      console.log(`Skipping intro to: ${skipToTime} seconds`);
      videoRef.current.currentTime = skipToTime;
      setCurrentTime(skipToTime);
    }
  }, [mediaSegments.intro]);

  // Check if skip intro button should be shown
  const shouldShowSkipIntro = useCallback(() => {
    if (!mediaSegments.intro) return false;

    const { startTime, endTime } = mediaSegments.intro;
    // Show skip button 2 seconds before the intro starts and during the intro
    return currentTime >= startTime && currentTime < endTime;
  }, [mediaSegments.intro, currentTime]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
      // Clean up blob URLs on unmount
      cleanupBlobUrls();
    };
  }, [cleanupBlobUrls]);

  if (!isPlayerVisible || !currentMedia) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[999999] bg-black flex items-center justify-center w-screen">
      <MediaPlayer
        autoHide
        onEnded={handleClose}
        onMediaError={(error) => {
          console.warn("Media player error caught:", error);
        }}
        className="w-screen"
        customSubtitleTracks={subtitleTracks}
        customSubtitlesEnabled={subtitleTracks.length > 0}
        chapters={chapters}
        onCustomSubtitleChange={(subtitleTrack) =>
          setActiveSubtitleTrack(subtitleTrack)
              }
      >
        {/* Always render the video component so it can load in the background */}
        {streamUrl && mediaDetails && (
          <MediaPlayerVideo asChild>
            <MuxVideo
              // @ts-ignore
              ref={videoRef}
              src={streamUrl}
              // src={
              //   "https://stream.mux.com/A3VXy02VoUinw01pwyomEO3bHnG4P32xzV7u1j1FSzjNg.m3u8"
              // }
              crossOrigin=""
              playsInline
              preload="auto"
              autoPlay={!currentMedia?.resumePositionTicks}
              className="h-screen bg-black w-screen"
              onPlay={handleVideoPlay}
              onPause={handleVideoPause}
              onEnded={handleVideoEnded}
              onLoadedMetadata={handleVideoLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onDurationChange={handleDurationChange}
              onError={(event) => {
                console.warn("Video error caught:", event);
              }}
            />
          </MediaPlayerVideo>
        )}

        {/* Loading overlay - shown while loading or before video starts */}
        {(loading || !streamUrl || !mediaDetails || !videoStarted) && (
          <div className="fixed inset-0 bg-black z-[1000000]">
            {/* Go Back Button - visible during loading */}
            <Button
              variant="ghost"
              className="fixed left-4 top-4 z-10 hover:backdrop-blur-md"
              onClick={handleClose}
            >
              <ArrowLeft className="h-4 w-4" />
              Go Back
            </Button>

            {/* Backdrop Image */}
            {mediaDetails ? (
              <div className="relative w-full h-full">
                {/* Blur hash placeholder or loading placeholder */}
                {!backdropImageLoaded && (
                  <div
                    className={`w-full h-full object-cover brightness-50 absolute inset-0 transition-opacity duration-300 ${
                      blurDataUrl ? "" : "bg-gray-800"
                    }`}
                    style={
                      blurDataUrl
                        ? {
                            backgroundImage: `url(${blurDataUrl})`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                            filter: "brightness(0.5)",
                          }
                        : undefined
                    }
                  />
                )}
                
                {/* Actual backdrop image */}
                <img
                  src={`${serverUrl}/Items/${
                    mediaDetails?.Type === "Episode" && mediaDetails?.SeriesId
                      ? mediaDetails.SeriesId
                      : currentMedia.id
                  }/Images/Backdrop?maxHeight=1080&maxWidth=1920&quality=95`}
                  alt={currentMedia?.name}
                  className={`w-full h-full object-cover brightness-50 transition-opacity duration-300 ${
                    backdropImageLoaded ? "opacity-100" : "opacity-0"
                  }`}
                  onLoad={() => {
                    setBackdropImageLoaded(true);
                  }}
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = "none";
                  }}
                  ref={(img) => {
                    // Check if image is already loaded (cached)
                    if (img && img.complete && img.naturalHeight !== 0) {
                      setBackdropImageLoaded(true);
                    }
                  }}
                />
                {/* Progressive Blur Overlay */}
                <ProgressiveBlur
                  direction="bottom"
                  blurLayers={6}
                  blurIntensity={0.3}
                  className="absolute inset-0"
                />
                {/* Dark overlay for better text readability */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              </div>
            ) : (
              // Fallback solid background
              <div className="w-full h-full bg-black" />
            )}

            {/* Title and Loading Spinner at Bottom */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="absolute bottom-8 left-8 right-8"
            >
              {/* Content formatted like the player */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2, duration: 0.5 }}
                className="flex flex-col w-full gap-1.5 pb-2"
              >
                {/* Show name for episodes */}
                {mediaDetails?.SeriesName && (
                  <motion.div
                    className="text-sm text-white/70 truncate font-medium"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                  >
                    {mediaDetails.SeriesName}
                  </motion.div>
                )}

                {/* Episode/Movie title with episode number */}
                <div className="flex items-center justify-between w-full">
                  <motion.h2
                    className="text-3xl font-semibold text-white truncate font-poppins"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                  >
                    {mediaDetails?.Type === "Episode" &&
                    mediaDetails?.IndexNumber
                      ? `${mediaDetails.IndexNumber}. ${mediaDetails.Name || currentMedia.name}`
                      : mediaDetails?.Name || currentMedia.name}
                  </motion.h2>

                  {/* End time display */}
                  {mediaDetails?.RunTimeTicks && (
                    <motion.div
                      className="text-sm text-white/70 ml-4 whitespace-nowrap"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.5 }}
                    >
                      Ends at{" "}
                      {formatEndTime(
                        0,
                        ticksToSeconds(mediaDetails.RunTimeTicks)
                      )}
                    </motion.div>
                  )}
                </div>

                {/* Season and episode info + runtime */}
                <motion.div
                  className="flex items-center gap-3 text-sm text-white/60"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6 }}
                >
                  {mediaDetails?.Type === "Episode" && (
                    <div className="space-x-1">
                      {mediaDetails?.ParentIndexNumber && (
                        <span>S{mediaDetails.ParentIndexNumber}</span>
                      )}
                      <span>•</span>
                      {mediaDetails?.IndexNumber && (
                        <span>E{mediaDetails.IndexNumber}</span>
                      )}
                    </div>
                  )}

                  {mediaDetails?.RunTimeTicks && (
                    <span>{formatRuntime(mediaDetails.RunTimeTicks)}</span>
                  )}

                  {mediaDetails?.ProductionYear && (
                    <span>{mediaDetails.ProductionYear}</span>
                  )}
                </motion.div>

                {/* Loading indicator */}
                <motion.div
                  className="flex items-center gap-2 mt-2"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.7 }}
                >
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <span className="text-sm text-white/70">Loading...</span>
                </motion.div>
              </motion.div>
            </motion.div>
          </div>
        )}
        {/* Current Subtitle */}
        {currentSubtitle && (
          <div
            className={`fixed left-1/2 transform -translate-x-1/2 z-[100] text-white text-center bg-black/20 px-4 py-2 rounded text-3xl font-medium shadow-xl backdrop-blur-md ${
              currentSubtitle.positionTop ? "top-[15%]" : "bottom-[10%]"
            }`}
            dangerouslySetInnerHTML={{ __html: currentSubtitle.text }}
          />
        )}

        {/* Skip Intro Button */}
        <AnimatePresence>
          {shouldShowSkipIntro() && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.8 }}
              transition={{
                type: "spring",
                damping: 20,
                stiffness: 100,
                duration: 0.8,
              }}
              className="fixed bottom-24 right-6 z-[1000000] backdrop-blur-md rounded-lg"
            >
              <Button
                onClick={handleSkipIntro}
                className="text-white text-center bg-black/30 rounded-lg text-lg py-6 px-6! font-medium shadow-xl hover:bg-black/40 transition"
              >
                <FastForward className="w-4 h-4 fill-white scale-110 mr-1.5" />
                Skip Intro
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
        <MediaPlayerControls className="flex-col items-start gap-2.5 px-6 pb-4 z-[9999]">
          <Button
            variant="ghost"
            className="fixed left-4 top-4 z-10 hover:backdrop-blur-md"
            onClick={handleClose}
          >
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </Button>

          {/* Fetching subtitles indicator */}
          {fetchingSubtitles && (
            <div className="fixed right-4 top-16 z-10 bg-black/50 backdrop-blur-sm rounded-md px-3 py-2 text-white text-sm flex items-center gap-2">
              <div className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full"></div>
              Fetching subtitles
            </div>
          )}
          <MediaPlayerControlsOverlay />
          <div className="flex flex-col w-full gap-1.5 pb-2">
            {/* Show name for episodes */}
            {mediaDetails?.SeriesName && (
              <div className="text-sm text-white/70 truncate font-medium">
                {mediaDetails.SeriesName}
              </div>
            )}

            {/* Episode/Movie title with episode number */}
            <div className="flex items-center justify-between w-full">
              <h2 className="text-3xl font-semibold text-white truncate font-poppins">
                {mediaDetails?.Type === "Episode" && mediaDetails?.IndexNumber
                  ? `${mediaDetails.IndexNumber}. ${mediaDetails.Name || currentMedia.name}`
                  : mediaDetails?.Name || currentMedia.name}
              </h2>

              {/* End time display */}
              {duration > 0 && currentTime >= 0 && (
                <div className="text-sm text-white/70 ml-4 whitespace-nowrap">
                  Ends at {formatEndTime(currentTime, duration)}
                </div>
              )}
            </div>

            {/* Season and episode info + runtime */}
            <div className="flex items-center gap-3 text-sm text-white/60">
              {mediaDetails?.Type === "Episode" && (
                <div className="space-x-1">
                  {mediaDetails?.ParentIndexNumber && (
                    <span>S{mediaDetails.ParentIndexNumber}</span>
                  )}
                  <span>•</span>
                  {mediaDetails?.IndexNumber && (
                    <span>E{mediaDetails.IndexNumber}</span>
                  )}
                </div>
              )}

              {mediaDetails?.RunTimeTicks && (
                <span>{formatRuntime(mediaDetails.RunTimeTicks)}</span>
              )}

              {mediaDetails?.ProductionYear && (
                <span>{mediaDetails.ProductionYear}</span>
              )}
            </div>
          </div>
          <MediaPlayerSeek />
          <div className="flex w-full items-center gap-2">
            <div className="flex flex-1 items-center gap-2">
              <MediaPlayerPlay />
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
              {/* Navigator button */}
              {onToggleAIAsk && (
                <MediaPlayerTooltip tooltip="Navigator" shortcut="Cmd + K">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-white hover:bg-white/20"
                    onClick={onToggleAIAsk}
                  >
                    <Ship className="h-4 w-4" />
                  </Button>
                </MediaPlayerTooltip>
              )}
              {/* People button with cast and crew popover */}
              {mediaDetails?.People && mediaDetails.People.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <MediaPlayerTooltip tooltip="Cast & Crew">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-white hover:bg-white/20"
                      >
                        <Users className="h-4 w-4" />
                      </Button>
                    </MediaPlayerTooltip>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-80 bg-black/90 border-white/20 text-white z-[1000000]"
                    side="top"
                  >
                    <div className="space-y-3">
                      <h3 className="font-semibold text-lg">Cast & Crew</h3>
                      <div className="max-h-64 overflow-y-auto space-y-2">
                        {mediaDetails.People.map((person, index) => (
                          <div
                            key={`${person.Id}-${index}`}
                            className="flex items-center space-x-3 p-2 rounded hover:bg-white/10"
                          >
                            <div className="flex-shrink-0">
                              {person.PrimaryImageTag ? (
                                <img
                                  src={`${serverUrl}/Items/${person.Id}/Images/Primary?fillHeight=759&fillWidth=506&quality=96`}
                                  alt={person.Name!}
                                  className="w-8 h-8 rounded-full object-cover"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.style.display = "none";
                                    target.nextElementSibling!.classList.remove(
                                      "hidden"
                                    );
                                  }}
                                />
                              ) : null}
                              <div
                                className={`w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-xs ${person.PrimaryImageTag ? "hidden" : ""}`}
                              >
                                {person.Name?.charAt(0) || "?"}
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">
                                {person.Name}
                              </p>
                              {person.Role && (
                                <p className="text-xs text-white/70 truncate">
                                  {person.Role}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
              <MediaPlayerSettings />
              <MediaPlayerPiP />
              <MediaPlayerFullscreen />
            </div>
          </div>
        </MediaPlayerControls>
      </MediaPlayer>
    </div>
  );
}
