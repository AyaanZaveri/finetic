import { useEffect, useState, type RefObject } from "react";
import type { MpvElementHandle } from "@/lib/desktop/mpv-element";

/** Only offer an offset when the current playback engine can actually apply it. */
export function useAudioDelay(mediaRef: RefObject<HTMLVideoElement | null>, seconds: number, source: string) {
    const [available, setAvailable] = useState(false);
    useEffect(() => {
        const element = mediaRef.current;
        const update = () => {
            const controller = (element as unknown as MpvElementHandle | null)?.controller;
            const supported = Boolean(controller?.supportsAudioTiming && controller.tracks.some(track => track.type === "audio" && track.selected));
            setAvailable(supported);
            if (supported) controller?.setAudioDelay(seconds);
        };
        update();
        const events = ["trackschange", "loadedmetadata", "emptied"];
        events.forEach(event => element?.addEventListener(event, update));
        return () => events.forEach(event => element?.removeEventListener(event, update));
    }, [mediaRef, seconds, source]);
    return available;
}
