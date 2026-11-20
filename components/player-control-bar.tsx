"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { RotateCcw, RotateCw } from "lucide-react";
import {
    MediaPlayerControls, MediaPlayerControlsOverlay, MediaPlayerPlay, MediaPlayerSeek,
    MediaPlayerSeekBackward, MediaPlayerSeekForward, MediaPlayerTime, MediaPlayerVolume,
} from "@/components/ui/media-player";
import type { SkipSegment } from "@/lib/media/skip-segments";

export function PlayerControlBar({ title, episode, releaseYear, endTime, previewSource, skipSegments, nextEpisode, children }: {
    title: string;
    episode?: { showTitle?: string; season?: number; episodeNumber?: number };
    releaseYear?: number;
    endTime: ReactNode;
    previewSource?: string;
    skipSegments?: SkipSegment[];
    nextEpisode?: ReactNode;
    children: ReactNode;
}) {
    const controlsRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const controls = controlsRef.current;
        const player = controls?.closest<HTMLElement>('[data-slot="media-player"]');
        if (!controls || !player) return;

        const update = () => player.style.setProperty("--player-controls-height", `${controls.getBoundingClientRect().height}px`);
        const observer = new ResizeObserver(update);
        observer.observe(controls);
        update();
        return () => {
            observer.disconnect();
            player.style.removeProperty("--player-controls-height");
        };
    }, []);

    const episodeCode = episode?.season !== undefined && episode.episodeNumber !== undefined
        ? `S${episode.season} E${episode.episodeNumber}` : undefined;
    const metadata = episode
        ? [episode.showTitle, episodeCode].filter(Boolean).join(" · ")
        : undefined;

    return <MediaPlayerControls ref={controlsRef} className="flex-col items-start gap-2.5 px-6 pb-4 z-20">
        <MediaPlayerControlsOverlay />
        <div className="flex flex-col w-full gap-1.5 pb-2">
            {metadata && <div data-player-meta="" className="flex min-w-0 items-center gap-3 text-sm font-medium text-white/60">
                <span className="min-w-0 truncate" title={metadata}>{metadata}</span>
            </div>}
            <div data-player-heading-row="" className="flex min-w-0 items-center justify-between w-full">
                <h2 data-player-title="" title={title} className="min-w-0 text-3xl font-semibold text-white truncate font-poppins">
                    {title}
                </h2>
                {endTime}
            </div>
            {!episode && releaseYear !== undefined && <div data-player-meta="" className="text-sm font-medium text-white/60">{releaseYear}</div>}
        </div>
        <MediaPlayerSeek previewFrames previewSource={previewSource} skipSegments={skipSegments} />
        <div data-player-toolbar="" className="flex w-full items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
                <MediaPlayerPlay />
                {nextEpisode}
                <MediaPlayerSeekBackward><RotateCcw /></MediaPlayerSeekBackward>
                <MediaPlayerSeekForward><RotateCw /></MediaPlayerSeekForward>
                <MediaPlayerVolume expandable />
                <MediaPlayerTime />
            </div>
            <div className="flex items-center gap-2">{children}</div>
        </div>
    </MediaPlayerControls>;
}
