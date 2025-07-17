"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Info, Download, Play } from "lucide-react";
import { MediaInfoDialog } from "@/components/media-info-dialog";
import { MediaSourceInfo } from "@/types/jellyfin";
import { useAuthStore } from "@/lib/auth-store";

interface EpisodeActionsProps {
  episodeId: string;
  selectedVersion: MediaSourceInfo | null;
  onPlay: (streamUrl: string, subtitleTracks: any[]) => void;
}

export function EpisodeActions({
  episodeId,
  selectedVersion,
  onPlay,
}: EpisodeActionsProps) {
  const { getDownloadUrl, getStreamUrl, getSubtitleTracks } = useAuthStore();

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        onClick={() =>
          window.open(getDownloadUrl(episodeId, selectedVersion!.Id!), "_blank")
        }
        disabled={!selectedVersion}
      >
        <Download className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={async () => {
          if (selectedVersion) {
            const streamUrl = getStreamUrl(episodeId, selectedVersion.Id!);
            const tracks = await getSubtitleTracks(
              episodeId,
              selectedVersion.Id!
            );
            onPlay(streamUrl, tracks);
          }
        }}
        disabled={!selectedVersion}
      >
        <Play className="h-4 w-4" />
      </Button>
      <Dialog>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            disabled={!selectedVersion}
          >
            <Info className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        {selectedVersion && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Media Info</DialogTitle>
            </DialogHeader>
            <MediaInfoDialog mediaSource={selectedVersion} />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
