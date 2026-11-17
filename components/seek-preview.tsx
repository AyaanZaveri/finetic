"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import MuxVideo from "@mux/mux-video-react";
import { PreviewImage } from "@/components/preview-image";
import { Skeleton } from "@/components/ui/skeleton";
import type { MpvElementHandle } from "@/lib/desktop/mpv-element";
import { BrowserPreviewFrames, PreviewCache, PreviewScheduler, previewBucket, type PreviewMedia } from "@/lib/media/preview-frames";
import { RangePreviewFrames } from "@/lib/media/range-preview-frames";

type Props = { media: HTMLVideoElement | HTMLAudioElement | null; source?: string; time: number; duration: number; active: boolean; deferWhileMoving?: boolean };
type Frame = { time: number | null; src: string | null; video: boolean; unavailable: boolean };
const empty: Frame = { time: null, src: null, video: false, unavailable: false };
type SurfaceTarget = { key: string; time: number };
const SURFACE_TOLERANCE_SECONDS = 2;

/** Kept mounted across hover exits so decoder buffers and recent frames stay warm. */
export function SeekPreview({ media, source: originalSource, time, duration, active, deferWhileMoving = false }: Props) {
    // Mux/MSE replaces the playing element's src with a decoder-owned blob.
    // A second decoder must open the original stream, not that MediaSource.
    const source = originalSource || media?.getAttribute("src") || media?.src || "";
    const session = (media as unknown as MpvElementHandle | null)?.controller?.previewSession;
    const key = session || source;
    const nativePreviews = !!session && typeof window !== "undefined" && (window.navigatorDesktop?.capabilities?.nativePreviews || window.navigatorDesktop?.platform === "android");
    const [target, setTarget] = useState<SurfaceTarget | null>(null);
    useLayoutEffect(() => {
        if (!active || !deferWhileMoving) { setTarget(null); return; }
        // Anchor the window instead of rounding into fixed bins: jitter across
        // a bin boundary must not repeatedly cancel a nearly decoded frame.
        setTarget(previous => previous?.key === key && Math.abs(time - previous.time) <= SURFACE_TOLERANCE_SECONDS
            ? previous : { key, time });
    }, [key, time, active, deferWhileMoving]);
    const [refined, setRefined] = useState<SurfaceTarget | null>(null);
    // Keep the tolerant leading request alive during motion, then refine once
    // the finger rests. Tolerance is a scheduling policy, not timestamp accuracy.
    useLayoutEffect(() => {
        if (!active || !deferWhileMoving) return;
        const timer = setTimeout(() => {
            const exact = { key, time };
            setTarget(exact);
            setRefined(exact);
        }, 120);
        return () => clearTimeout(timer);
    }, [key, time, active, deferWhileMoving]);
    const inWindow = target?.key === key && Math.abs(time - target.time) <= SURFACE_TOLERANCE_SECONDS;
    const [settled, setSettled] = useState<SurfaceTarget | null>(null);
    useLayoutEffect(() => {
        setSettled(null);
        if (!active || !deferWhileMoving || !inWindow) return;
        const timer = setTimeout(() => setSettled(target), 100);
        return () => clearTimeout(timer);
    }, [target, inWindow, active, deferWhileMoving]);
    const requestActive = active && (nativePreviews || !deferWhileMoving || (inWindow && (settled === target || refined === target)));
    const previewTime = !nativePreviews && deferWhileMoving && inWindow ? target.time : time;
    return <PreviewSource key={key} media={media} source={source} time={previewTime} displayTime={time} duration={duration} active={requestActive} />;
}

function PreviewSource({ media, source, time, displayTime, duration, active }: Props & { source: string; displayTime: number }) {
    const native = (media as unknown as MpvElementHandle | null)?.controller;
    const [fallback, setFallback] = useState(false);
    const [rangeUnavailable, setRangeUnavailable] = useState(false);
    const videoNode = useRef<PreviewMedia | null>(null);
    const [videoAttached, setVideoAttached] = useState(false);
    const videoRef = useCallback((node: unknown) => { videoNode.current = node as PreviewMedia | null; setVideoAttached(!!node); }, []);
    const [frame, setFrame] = useState<Frame>(empty);
    const cache = useRef(new PreviewCache());
    const browser = useRef<BrowserPreviewFrames | null>(null);
    const range = useRef<RangePreviewFrames | null>(null);
    const scheduler = useRef(new PreviewScheduler());
    const ticket = useRef(0);
    const invalidate = useCallback(() => { ticket.current++; }, []);
    const bucket = previewBucket(time, duration);
    const nativeFrames = !!native && typeof window !== "undefined" && (window.navigatorDesktop?.capabilities?.nativePreviews || window.navigatorDesktop?.platform === "android");
    const muxPreview = /\.m3u8(?:[?#]|$)/i.test(source)
        || /^https:\/\/stream\.mux\.com\/[^/.?#]+(?:[?#]|$)/i.test(source);
    // Native keyframe extraction handles indexed files, not streaming manifests.
    const browserMode = !native || fallback || muxPreview || /\.mpd(?:[?#]|$)/i.test(source);
    const rangeMode = browserMode && !muxPreview && !rangeUnavailable && typeof VideoDecoder !== "undefined";
    const wanted = useRef<number | null>(null);
    useLayoutEffect(() => { wanted.current = active ? bucket : null; }, [active, bucket]);

    useLayoutEffect(() => {
        if (!nativeFrames || !native) return;
        const receive = (event: Event) => {
            const { position, src } = (event as CustomEvent<{ position: number; src: string }>).detail;
            const at = wanted.current;
            if (at !== null) {
                // Show completed work during continuous motion. Requiring its
                // interval to contain the cursor starves display on slow reads.
                // A cached frame for the current target always takes priority.
                const cached = native.cachedPreview(at);
                setFrame({ time: cached ? at : position, src: cached || src, video: false, unavailable: false });
            }
        };
        native.addEventListener("previewframe", receive);
        return () => native.removeEventListener("previewframe", receive);
    }, [nativeFrames, native]);

    useLayoutEffect(() => {
        const requests = scheduler.current;
        return () => { requests.cancel(); invalidate(); native?.cancelPreview(); };
    }, [source, native, invalidate]);

    useLayoutEffect(() => {
        if (!rangeMode || !source) return;
        const provider = new RangePreviewFrames(source, (at, src) => {
            if (wanted.current !== null) setFrame({ time: at, src, video: false, unavailable: false });
        }, () => setRangeUnavailable(true));
        range.current = provider;
        // Let playback settle before reading a second index. Hover can still
        // start immediately and shares this same initialization promise.
        let warm: ReturnType<typeof setTimeout> | undefined;
        const prepare = () => { clearTimeout(warm); warm = setTimeout(() => { void provider.prepare(); }, 1_500); };
        if (media && media.readyState >= 2) prepare();
        else media?.addEventListener('playing', prepare, { once: true });
        return () => { clearTimeout(warm); media?.removeEventListener('playing', prepare); provider.dispose(); if (range.current === provider) range.current = null; };
    }, [rangeMode, source, media]);

    useLayoutEffect(() => {
        const video = videoNode.current;
        if (!browserMode || rangeMode || !videoAttached || !video || !source) return;
        const provider = new BrowserPreviewFrames(video, (at, src, videoFrame, unavailable) => {
            if (wanted.current !== null) setFrame(previous => src || videoFrame
                ? { time: at, src, video: !!videoFrame, unavailable: false }
                : unavailable ? { ...previous, time: at, unavailable: true }
                : { ...previous, unavailable: false });
        }, false, !muxPreview, !muxPreview);
        browser.current = provider;
        // Restore the source after Strict Mode's effect cleanup on the same element.
        video.muted = true;
        // Mux attaches a MediaSource blob itself. Assigning the manifest URL
        // to that video would disconnect its decoder immediately after attach.
        if (!muxPreview && video.getAttribute("src") !== source) video.src = source;
        return () => { provider.dispose(); if (browser.current === provider) browser.current = null; };
    }, [browserMode, rangeMode, videoAttached, source, muxPreview]);

    useLayoutEffect(() => {
        if (!active || bucket === null || !source) {
            scheduler.current.cancel();
            invalidate();
            native?.cancelPreview();
            browser.current?.cancel();
            range.current?.cancel();
            return;
        }
        if (browserMode) {
            if (rangeMode) {
                scheduler.current.want(bucket, (at) => range.current?.want(at));
                return;
            }
            if (!browser.current) return;
            scheduler.current.want(bucket, (at) => browser.current?.want(at));
            return;
        }
        const cached = native?.cachedPreview(bucket) || cache.current.get(bucket);
        if (cached) {
            scheduler.current.cancel();
            native?.cancelPreview();
            const generation = ++ticket.current;
            Promise.resolve(cached).then((src) => { if (generation === ticket.current) setFrame({ time: bucket, src, video: false, unavailable: false }); });
            return;
        }
        scheduler.current.want(bucket, (at) => {
            const generation = ++ticket.current;
            native?.preview(at).then((src) => {
                if (generation !== ticket.current) return;
                if (src) {
                    if (!nativeFrames) cache.current.set(at, src);
                    setFrame({ time: at, src, video: false, unavailable: false });
                } else {
                    // HLS or an unsupported container can still use the WebView decoder.
                    if (nativeFrames) setFrame((previous) => previous.src ? previous : { time: at, src: null, video: false, unavailable: true });
                    else setFallback(true);
                }
            });
        });
    }, [active, bucket, source, native, browserMode, rangeMode, videoAttached, invalidate, nativeFrames]);

    const displayBucket = previewBucket(displayTime, duration);
    // A decoded cache hit is available in this render, even while the surface
    // gesture's settle timer is pending. Never debounce an existing thumbnail.
    const displaySrc = displayBucket === null ? undefined
        : native?.cachedPreview(displayBucket) || cache.current.get(displayBucket) || range.current?.cache.get(displayBucket) || browser.current?.cache.get(displayBucket);
    const image = displaySrc || ((active || frame.time === displayBucket) ? frame.src : null);
    const ready = !!displaySrc || (frame.time === displayBucket && !!(frame.src || frame.video));
    const unavailable = frame.time === displayBucket && frame.unavailable;
    return (
        <div data-slot="media-player-seek-thumbnail" data-native-preview-provider={nativeFrames ? window.navigatorDesktop?.platform : undefined} aria-busy={active && !ready && !unavailable} className="relative w-56 overflow-hidden rounded-lg" style={{ width: 224, height: 126, flex: "none" }}>
            {browserMode && !rangeMode && source && (muxPreview ? (
                <MuxVideo
                    ref={videoRef}
                    src={source} muted playsInline preload={active ? "auto" : "metadata"} crossOrigin="anonymous" disablePictureInPicture disableRemotePlayback disableTracking
                    aria-hidden="true" tabIndex={-1}
                    className={`pointer-events-none absolute inset-0 size-full object-contain ${frame.video ? "opacity-100" : "opacity-0"}`}
                />
            ) : (
                <video
                    ref={videoRef}
                    src={source} muted playsInline preload={active ? "auto" : "metadata"} crossOrigin="anonymous" disablePictureInPicture disableRemotePlayback
                    aria-hidden="true" tabIndex={-1}
                    className={`pointer-events-none absolute inset-0 size-full object-contain ${frame.video ? "opacity-100" : "opacity-0"}`}
                />
            ))}
            {image && <PreviewImage src={image} pending={!ready} />}
            {!image && !ready && !unavailable && <Skeleton className="absolute inset-0 size-full rounded-none bg-white/10" />}
            {unavailable && <div className="absolute inset-0 flex items-center justify-center text-xs text-white/60">Preview unavailable</div>}
        </div>
    );
}
