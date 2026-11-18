"use client";

import { useCallback, useLayoutEffect, useRef, type ComponentProps, type Ref } from "react";
import { toast } from "sonner";
import { createWebVideoSession, takeWebVideo, type WebVideoSession } from "@/lib/media/web-video-preload";

type Props = ComponentProps<"video"> & { src: string; startPosition?: number };
const events = { onPause: "pause", onPlaying: "playing", onEnded: "ended", onLoadedMetadata: "loadedmetadata",
    onTimeUpdate: "timeupdate", onDurationChange: "durationchange", onCanPlay: "canplay", onLoadedData: "loadeddata",
    onError: "error", onClick: "click" } as const;
function assign(ref: Ref<HTMLVideoElement> | undefined, value: HTMLVideoElement | null) {
    if (typeof ref === "function") return ref(value);
    if (ref) ref.current = value;
}

/** React owns the slot, while the session owns the media element and Mux engine.
 * A preloaded element can move here without a src reset or engine teardown. */
export function WebPlaybackVideo(props: Props) {
    const host = useRef<HTMLDivElement>(null);
    const current = useRef(props);
    useLayoutEffect(() => { current.current = props; });
    const session = useRef<WebVideoSession | null>(null);
    const registration = useRef<{ ref: Props["ref"]; cleanup?: (() => void) | void } | null>(null);
    const register = useCallback(() => {
        if (!session.current || registration.current?.ref === current.current.ref) return;
        if (registration.current?.cleanup) registration.current.cleanup();
        else if (registration.current) assign(registration.current.ref, null);
        registration.current = { ref: current.current.ref, cleanup: assign(current.current.ref, session.current.video) };
    }, []);
    const update = useCallback(() => {
        const video = session.current?.video;
        if (!video) return;
        video.setAttribute("class", current.current.className || "");
        for (const [key, value] of Object.entries(current.current)) {
            if (key === "id" || key.startsWith("aria-") || key.startsWith("data-")) {
                if (value === undefined || value === null) video.removeAttribute(key);
                else video.setAttribute(key, String(value));
            }
        }
        register();
    }, [register]);
    useLayoutEffect(() => {
        let cancelled = false;
        const removers: (() => void)[] = [];
        const install = (owned: WebVideoSession, adopted = false) => {
            if (cancelled || !host.current) { owned.dispose(); return; }
            session.current = owned; host.current.append(owned.video); update();
            for (const [prop, name] of Object.entries(events)) {
                const callback = (event: Event) => {
                    const handler = current.current[prop as keyof typeof events] as ((_event: unknown) => void) | undefined;
                    handler?.(event);
                };
                owned.video.addEventListener(name, callback);
                removers.push(() => owned.video.removeEventListener(name, callback));
            }
            let audioNoticeShown = false;
            const reportAudio = () => {
                if (cancelled || audioNoticeShown) return;
                audioNoticeShown = true;
                toast("Playing video without audio. This audio track is unavailable in this browser.");
            };
            owned.video.addEventListener("webgpu-audio-unavailable", reportAudio);
            removers.push(() => owned.video.removeEventListener("webgpu-audio-unavailable", reportAudio));
            let hdrNoticeShown = false;
            const reportHdr = () => {
                if (cancelled || hdrNoticeShown) return;
                hdrNoticeShown = true;
                toast(owned.video.dataset.webgpuHdr === "display-unavailable"
                    ? "The browser reports an SDR display. Check HDR in your system display settings and restart the browser."
                    : "WebGPU HDR output is unavailable for this video. Using fallback playback.");
            };
            owned.video.addEventListener("webgpu-hdr-unavailable", reportHdr);
            removers.push(() => owned.video.removeEventListener("webgpu-hdr-unavailable", reportHdr));
            const reportSeekFallback = () => {
                if (!cancelled) toast("WebGPU playback could not resume after seeking. Trying the browser player.");
            };
            owned.video.addEventListener("webgpu-seek-fallback", reportSeekFallback);
            removers.push(() => owned.video.removeEventListener("webgpu-seek-fallback", reportSeekFallback));
            // A standby element may already have emitted these before adoption.
            queueMicrotask(() => {
                if (cancelled || !adopted) return;
                if (owned.video.readyState >= 1) owned.video.dispatchEvent(new Event("loadedmetadata"));
                if (owned.video.readyState >= 2) owned.video.dispatchEvent(new Event("loadeddata"));
                if (owned.video.readyState >= 3) owned.video.dispatchEvent(new Event("canplay"));
            });
        };
        const warm = takeWebVideo(props.src);
        if (warm) install(warm, true);
        else install(createWebVideoSession(props.src, false, props.startPosition));
        return () => {
            cancelled = true; removers.forEach(remove => remove());
            if (registration.current?.cleanup) registration.current.cleanup();
            else if (registration.current) assign(registration.current.ref, null);
            registration.current = null; session.current?.dispose(); session.current = null;
        };
    }, [props.src, props.startPosition, update]);
    useLayoutEffect(update);
    return <div ref={host} style={{ position: "relative", width: "100%", height: "100vh" }} />;
}
