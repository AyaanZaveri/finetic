"use client";

import React, { useLayoutEffect, useRef } from "react";
import { MPV_TAG, registerMpvElement, type MpvElementHandle } from "@/lib/desktop/mpv-element";
import { useComposedRefs } from "@/lib/compose-refs";
import { releaseNativePreload } from "@/lib/media/preload-next-video";
import type { SystemMediaMetadata } from "@/lib/desktop/bridge";

type Props = Omit<React.ComponentProps<"video">, "src"> & { src?: string; preloadSrc?: string; preloadExpires?: number; onPreloadFallback?: () => void; requestHeaders?: Record<string, string>; startPosition?: number; systemMedia?: SystemMediaMetadata };

export function MpvVideo({ src, preloadSrc, preloadExpires = 0, onPreloadFallback, requestHeaders, startPosition = 0, systemMedia, ref, onPause, onPlaying, onEnded, onLoadedMetadata, onTimeUpdate, onDurationChange, onCanPlay, onLoadedData, onError, autoPlay: _autoPlay, crossOrigin: _crossOrigin, playsInline: _playsInline, preload: _preload, ...props }: Props) {
    registerMpvElement();
    const element = useRef<MpvElementHandle | null>(null);
    // Existing controls use the media element contract supplied by this custom element.
    const composed = useComposedRefs(element, ref as React.Ref<MpvElementHandle>);
    const callbacks = useRef({ onPause, onPlaying, onEnded, onLoadedMetadata, onTimeUpdate, onDurationChange, onCanPlay, onLoadedData, onError, onPreloadFallback });
    const fallback = useRef<(() => boolean) | null>(null);
    const latestMedia = useRef(systemMedia);
    useLayoutEffect(() => { callbacks.current = { onPause, onPlaying, onEnded, onLoadedMetadata, onTimeUpdate, onDurationChange, onCanPlay, onLoadedData, onError, onPreloadFallback }; });
    useLayoutEffect(() => {
        const node = element.current;
        if (!node) return;
        const listeners = Object.entries({ pause: "onPause", playing: "onPlaying", ended: "onEnded", loadedmetadata: "onLoadedMetadata", timeupdate: "onTimeUpdate", durationchange: "onDurationChange", canplay: "onCanPlay", loadeddata: "onLoadedData", error: "onError" }).map(([event, key]) => {
            const listener = (nativeEvent: Event) => {
                if (event === "error" && fallback.current?.()) return;
                const callback = callbacks.current[key as keyof typeof callbacks.current];
                callback?.({ nativeEvent, currentTarget: node, target: node } as unknown as React.SyntheticEvent<HTMLVideoElement>);
            };
            node.addEventListener(event, listener);
            return () => node.removeEventListener(event, listener);
        });
        return () => listeners.forEach((remove) => remove());
    }, []);
    const headersKey = JSON.stringify(requestHeaders ?? {});
    useLayoutEffect(() => {
        const controller = element.current?.controller;
        let cached = Boolean(preloadSrc && preloadExpires > Date.now());
        fallback.current = () => {
            if (!cached || !src || !controller) return false;
            cached = false;
            if (preloadSrc) releaseNativePreload(preloadSrc);
            const position = Math.max(startPosition, controller.currentTime || 0);
            callbacks.current.onPreloadFallback?.();
            controller.load(src, JSON.parse(headersKey), position);
            if (latestMedia.current) controller.setMediaMetadata(latestMedia.current);
            return true;
        };
        if (src) controller?.load(cached ? preloadSrc! : src, cached ? {} : JSON.parse(headersKey), startPosition);
        return () => { fallback.current = null; if (preloadSrc) releaseNativePreload(preloadSrc); };
    // Disconnect owns final cleanup. A source change reuses the controller with a new session.
    }, [src, preloadSrc, preloadExpires, headersKey, startPosition]);
    useLayoutEffect(() => {
        latestMedia.current = systemMedia;
        if (systemMedia) element.current?.controller?.setMediaMetadata(systemMedia);
    });
    return React.createElement(MPV_TAG, { ...props, ref: composed, "data-native-video": "" });
}
