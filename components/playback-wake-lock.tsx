"use client";

import { useEffect, type RefObject } from "react";
import { keepPlaybackAwake } from "@/lib/media/playback-wake-lock";

export function PlaybackWakeLock({ mediaRef, sourceKey, enabled }: {
    mediaRef: RefObject<HTMLVideoElement | null>; sourceKey: string; enabled: boolean;
}) {
    useEffect(() => {
        const media = mediaRef.current;
        if (!enabled || !media) return;
        return keepPlaybackAwake(media);
    }, [mediaRef, sourceKey, enabled]);
    return null;
}
