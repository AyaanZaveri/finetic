import { useEffect, useState, type RefObject } from "react";
import type { WebGpuVideo } from "./webgpu-video";
import type { MpvElementHandle } from "@/lib/desktop/mpv-element";

export function useNativeSubtitleTiming(mediaRef: RefObject<HTMLVideoElement | null>, seconds: number, external: boolean, source: string, native: boolean) {
    const [available, setAvailable] = useState(false);
    useEffect(() => {
        const element = mediaRef.current;
        const update = () => {
            const controller = (element as unknown as MpvElementHandle | null)?.controller;
            const selected = controller?.tracks.find(track => track.type === "sub" && track.selected);
            const supported = Boolean(native && controller?.supportsSubtitleTiming && !external && selected &&
                ["subrip", "srt", "webvtt", "mov_text", "text", "ass", "ssa"].includes(selected.codec || ""));
            const webgpuText = !native && Boolean((element as WebGpuVideo | null)?.webgpu) &&
                Array.from(element?.textTracks || []).some(track => track.mode === "showing");
            setAvailable(!external && (supported || webgpuText));
            controller?.setSubtitleDelay(supported ? seconds : 0);
        };
        update();
        element?.textTracks?.addEventListener("change", update);
        element?.addEventListener("trackschange", update);
        element?.addEventListener("loadedmetadata", update);
        element?.addEventListener("emptied", update);
        return () => {
            element?.textTracks?.removeEventListener("change", update);
            element?.removeEventListener("trackschange", update);
            element?.removeEventListener("loadedmetadata", update);
            element?.removeEventListener("emptied", update);
        };
    }, [mediaRef, seconds, external, source, native]);
    return !external && available;
}
