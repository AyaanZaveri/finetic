"use client";

import { useCallback, useSyncExternalStore, type ComponentProps, type RefObject } from "react";
import { usePlaybackTimestamp } from "@/contexts/MediaPlayerContext";
import { SubtitleText } from "@/components/subtitle-text";
import { PlayerSkipSegments } from "@/components/player-skip-segments";
import type { WebGpuVideo } from "@/lib/media/webgpu-video";
import type { MpvElementHandle } from "@/lib/desktop/mpv-element";
import { subtitleTime } from "@/lib/media/subtitle-timing";

const emptySnapshot = () => null;
export function PlayerSubtitleLayer({ mediaRef, lookup, delay, native, enabled, position, ...appearance }: {
    mediaRef: RefObject<HTMLVideoElement | null>;
    lookup: (_time: number) => { text: string; positionTop: boolean } | null;
    delay: number; native: boolean; enabled: boolean; position: number;
} & Pick<ComponentProps<typeof SubtitleText>, "size" | "outline" | "weight" | "color">) {
    const subscribe = useCallback((notify: () => void) => {
        const node = mediaRef.current;
        const events = ["timeupdate", "seeking", "seeked", "loadedmetadata", "subtitlechange", "emptied"];
        events.forEach(event => node?.addEventListener(event, notify));
        return () => events.forEach(event => node?.removeEventListener(event, notify));
    }, [mediaRef]);
    const snapshot = useCallback(() => {
        const node = mediaRef.current;
        if (!node || !enabled) return null;
        return lookup(subtitleTime(node.currentTime, delay))
            ?? (node as WebGpuVideo).webgpu?.subtitle(subtitleTime(node.currentTime, delay))
            ?? (native ? (node as unknown as MpvElementHandle).controller?.subtitleText || null : null);
    }, [mediaRef, lookup, delay, native, enabled]);
    const cue = useSyncExternalStore(subscribe, snapshot, emptySnapshot);
    if (!cue) return null;
    return <SubtitleText {...appearance} data-player-subtitle=""
        style={typeof cue !== "string" && cue.positionTop ? { top: "15%" } : { bottom: `${position}%` }}
        className="pointer-events-none fixed left-1/2 transform -translate-x-1/2 z-10 w-max max-w-[90vw]">
        {typeof cue === "string" ? cue : <span dangerouslySetInnerHTML={{ __html: cue.text }} />}
    </SubtitleText>;
}

export function ClockedSkipSegments(props: Omit<ComponentProps<typeof PlayerSkipSegments>, "currentTime">) {
    const currentTime = usePlaybackTimestamp();
    return <PlayerSkipSegments {...props} currentTime={currentTime} />;
}

const emptyEndTime = () => "";
export function PlayerEndTime({ duration, mediaRef }: { duration: number; mediaRef: RefObject<HTMLVideoElement | null> }) {
    const subscribe = useCallback((notify: () => void) => {
        const node = mediaRef.current;
        const events = ["timeupdate", "seeked", "loadedmetadata"];
        events.forEach(event => node?.addEventListener(event, notify));
        return () => events.forEach(event => node?.removeEventListener(event, notify));
    }, [mediaRef]);
    const snapshot = useCallback(() => {
        const time = mediaRef.current?.currentTime;
        if (!Number.isFinite(duration) || !(duration > 0) || time === undefined || !Number.isFinite(time) || time < 0) return "";
        const end = new Date(Date.now() + Math.max(0, duration - time) * 1000);
        return end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
    }, [duration, mediaRef]);
    const text = useSyncExternalStore(subscribe, snapshot, emptyEndTime);
    if (!text) return null;
    return <div data-player-end-time="" className="text-sm text-white/70 ml-4 whitespace-nowrap">
        Ends at {text}
    </div>;
}
