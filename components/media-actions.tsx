"use client";

import React, { useState, useEffect } from "react";
import { JellyfinItem, MediaSourceInfo } from "@/types/jellyfin";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MediaInfoDialog } from "@/components/media-info-dialog";
import { ImageEditorDialog } from "@/components/image-editor-dialog";
import { Info, Download, Play, Check } from "lucide-react";
import {
  getDownloadUrl,
  getStreamUrl,
  getSubtitleTracks,
  getUserWithPolicy,
  getUser,
  type UserPolicy,
} from "@/app/actions";
import {
  getMediaDetailsFromName,
  cutOffText,
  formatPlaybackPosition,
  formatRuntime,
} from "@/lib/utils";
import { useMediaPlayer } from "@/contexts/MediaPlayerContext";
import { DolbyDigital, DolbyTrueHd, DolbyVision, DtsHd } from "./icons/codecs";
import { UserItemDataDto } from "@jellyfin/sdk/lib/generated-client";
import { updatePlayedStatus } from "@/app/actions/media";

interface MediaActionsProps {
  movie?: JellyfinItem;
  show?: JellyfinItem;
  episode?: JellyfinItem;
}

export function MediaActions({ movie, show, episode }: MediaActionsProps) {
  const media = movie || show || episode;
  const { isPlayerVisible, setIsPlayerVisible, playMedia } = useMediaPlayer();
  const [selectedVersion, setSelectedVersion] =
    useState<MediaSourceInfo | null>(null);
  const [userPolicy, setUserPolicy] = useState<UserPolicy | null>(null);
  const [userData, setUserData] = useState<UserItemDataDto | null>(
    episode?.UserData || movie?.UserData || null,
  );

  // Determine if this is a resume or new play
  const hasProgress =
    media?.UserData?.PlaybackPositionTicks &&
    media.UserData.PlaybackPositionTicks > 0 &&
    !media.UserData.Played;
  const totalRuntimeTicks = media?.RunTimeTicks || 0;
  const resumePositionTicks = media?.UserData?.PlaybackPositionTicks || 0;
  const timeLeftTicks = totalRuntimeTicks - resumePositionTicks;
  const timeLeft = formatRuntime(timeLeftTicks);

  // Initialize selectedVersion when media changes
  useEffect(() => {
    if (media?.MediaSources && media.MediaSources.length > 0) {
      setSelectedVersion(media.MediaSources[0]);
    }
  }, [media]);

  // Fetch user policy when component mounts
  useEffect(() => {
    const fetchUserPolicy = async () => {
      try {
        const currentUser = await getUser();
        if (currentUser?.Id && media?.Id) {
          const userWithPolicy = await getUserWithPolicy(
            currentUser.Id,
            media.Id
          );
          if (userWithPolicy?.Policy) {
            setUserPolicy(userWithPolicy.Policy);
          }
        }
      } catch (error) {
        console.error("Failed to fetch user policy:", error);
      }
    };

    if (media?.Id) {
      fetchUserPolicy();
    }
  }, [media?.Id]);

  if (!media) {
    return null;
  }

  // If episode doesn't have MediaSources but has an Id, show basic play button
  if (!media.MediaSources || media.MediaSources.length === 0) {
    if (episode && media.Id) {
      return (
        <div className="mb-4 flex items-center">
          <Button
            variant="outline"
            className="gap-0"
            onClick={() => {
              // Could redirect to a streaming service or handle differently
            }}
          >
            <Play className="h-4 w-4 mr-2" />
            {hasProgress ? "Resume" : "Play"} Episode
            {hasProgress && (
              <span className="text-sm opacity-75">{timeLeft} left</span>
            )}
          </Button>
        </div>
      );
    }
    return null;
  }

  if (!selectedVersion) {
    return null;
  }

  const download = async () => {
    window.open(await getDownloadUrl(selectedVersion.Id!), "_blank");
  };

  const handlePlayedStatus = async () => {
    if (userData && (episode || movie))
      setUserData(await updatePlayedStatus((episode || movie)!, !userData.Played));
  };

  // Helper function to get display name for a media source
  const getMediaSourceDisplayName = (source: MediaSourceInfo) => {
    const detailsFromName = getMediaDetailsFromName(source.Name!);

    // If we can't parse details from the name, try to use DisplayTitle from video stream
    if (detailsFromName === "Unknown" && source.MediaStreams) {
      const videoStream = source.MediaStreams.find(
        (stream) => stream.Type === "Video"
      );
      if (videoStream?.DisplayTitle) {
        return getMediaDetailsFromName(videoStream.DisplayTitle);
      }
    }

    return detailsFromName;
  };

  // Helper function to check if media has Dolby Digital audio
  const hasDolbyDigital = (source: MediaSourceInfo) => {
    if (!source.MediaStreams) {
      return false;
    }

    const audioStreams = source.MediaStreams.filter(
      (stream) => stream.Type === "Audio"
    );

    const result = source.MediaStreams.some(
      (stream) =>
        stream.Type === "Audio" &&
        (stream.Codec?.toLowerCase().includes("ac3") ||
          stream.Codec?.toLowerCase().includes("dolby") ||
          stream.DisplayTitle?.toLowerCase().includes("dolby"))
    );

    return result;
  };

  // Helper function to check if media has Dolby TrueHD audio
  const hasDolbyTrueHD = (source: MediaSourceInfo) => {
    if (!source.MediaStreams) {
      return false;
    }

    const audioStreams = source.MediaStreams.filter(
      (stream) => stream.Type === "Audio"
    );

    const result = source.MediaStreams.some(
      (stream) =>
        stream.Type === "Audio" &&
        (stream.Codec?.toLowerCase().includes("truehd") ||
          stream.DisplayTitle?.toLowerCase().includes("truehd"))
    );

    return result;
  };

  // Helper function to check if media has Dolby Vision video
  const hasDolbyVision = (source: MediaSourceInfo) => {
    if (!source.MediaStreams) {
      return false;
    }

    const videoStreams = source.MediaStreams.filter(
      (stream) => stream.Type === "Video"
    );

    const result = source.MediaStreams.some(
      (stream) =>
        stream.Type === "Video" &&
        (stream.VideoRange?.toLowerCase().includes("dovi") ||
          stream.DisplayTitle?.toLowerCase().includes("dolby vision") ||
          stream.Profile?.toLowerCase().includes("dolby"))
    );

    return result;
  };

  const hasDtsHd = (source: MediaSourceInfo) => {
    if (!source.MediaStreams) {
      return false;
    }

    const audioStreams = source.MediaStreams.filter(
      (stream) => stream.Type === "Audio"
    );

    const result = source.MediaStreams.some(
      (stream) =>
        stream.Type === "Audio" &&
        (stream.Codec?.toLowerCase().includes("dts-hd") ||
          stream.DisplayTitle?.toLowerCase().includes("dts-hd"))
    );
    return result;
  };

  return (
    <div className="flex flex-col gap-2 mb-6">
      <div className="flex items-center gap-2">
        <Button
          variant="default"
          onClick={async () => {
            // Set the current media in context, GlobalMediaPlayer will handle the rest
            if (media) {
              await playMedia({
                id: media.Id!,
                name: media.Name!,
                type: media.Type as "Movie" | "Series" | "Episode",
                resumePositionTicks: media.UserData?.PlaybackPositionTicks,
                selectedVersion: selectedVersion,
              });
              setIsPlayerVisible(true);
            }
          }}
          className="gap-2"
        >
          <Play className="h-4 w-4" />
          {hasProgress ? "Resume" : "Play"}
          {hasProgress ? (
            <span className="text-sm opacity-75 pr-1">{timeLeft} left</span>
          ) : null}
        </Button>

        {media.MediaSources.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild className="truncate">
              <Button
                variant="outline"
                className="overflow-hidden whitespace-nowrap text-ellipsis fill-foreground gap-1.5 px-4"
              >
                {getMediaSourceDisplayName(selectedVersion)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {media.MediaSources.map((source: MediaSourceInfo) => (
                <DropdownMenuItem
                  key={source.Id}
                  onSelect={() => {
                    setSelectedVersion(source);
                    // onStreamUrlChange(null); // Clear stream URL when changing version
                  }}
                  className="fill-foreground gap-3 flex justify-between"
                >
                  {cutOffText(source.Name!, 64)}
                  <Badge variant="outline" className="bg-sidebar">
                    {source.Size
                      ? `${(source.Size / 1024 ** 3).toFixed(2)} GB`
                      : "Unknown size"}
                  </Badge>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="outline"
            className="overflow-hidden whitespace-nowrap text-ellipsis fill-foreground gap-1.5"
          >
            {getMediaSourceDisplayName(selectedVersion)}
          </Button>
        )}

        <Button variant="outline" size="icon" onClick={download}>
          <Download className="h-4 w-4" />
        </Button>

        {userData && (
          <Button variant="outline" size="icon" onClick={handlePlayedStatus}>
            <Check
              className={`h-4 w-4 ${userData.Played ? "text-green-500" : ""}`}
            />
          </Button>
        )}

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="icon">
              <Info className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl dark:bg-background/30 backdrop-blur-md z-[9999999999]">
            <DialogHeader>
              <DialogTitle>Media Info</DialogTitle>
            </DialogHeader>
            <MediaInfoDialog mediaSource={selectedVersion} />
          </DialogContent>
        </Dialog>

        {userPolicy?.IsAdministrator && (
          <ImageEditorDialog
            itemId={media.Id!}
            itemName={media.Name || "Unknown"}
          />
        )}
      </div>
      {(hasDolbyDigital(selectedVersion) ||
        hasDolbyTrueHD(selectedVersion) ||
        hasDolbyVision(selectedVersion) ||
        hasDtsHd(selectedVersion)) && (
        <div className="flex gap-4 ml-1 h-8 items-center mt-4 -mb-2">
          {hasDolbyDigital(selectedVersion) && <DolbyDigital />}
          {hasDolbyTrueHD(selectedVersion) && <DolbyTrueHd />}
          {hasDolbyVision(selectedVersion) && <DolbyVision />}
          {hasDtsHd(selectedVersion) && <DtsHd />}
        </div>
      )}
    </div>
  );
}
