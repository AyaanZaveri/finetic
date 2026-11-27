"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useMetadataWarmup } from "./stream-query-provider";
import { useSettings } from "@/contexts/settings-context";
import { useAccountAccess } from "@/contexts/account-context";
import { routePrefetchAllowed } from "@/lib/route-prefetch";
import { warmSeriesSeason } from "@/lib/media/series-season";
import type { MediaToPlay } from "@/lib/atoms";
import type { MediaItem } from "@/types/stremio";

export function MetadataPreloadPolicy() {
    const warmer = useMetadataWarmup();
    const { authenticated } = useAccountAccess();
    const { playbackPreferences } = useSettings();
    useEffect(() => {
        const update = () => warmer?.setAllowed(authenticated && playbackPreferences.metadataPrefetch && routePrefetchAllowed());
        const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
        update();
        document.addEventListener("visibilitychange", update);
        window.addEventListener("online", update); window.addEventListener("offline", update);
        connection?.addEventListener("change", update);
        return () => {
            document.removeEventListener("visibilitychange", update);
            window.removeEventListener("online", update); window.removeEventListener("offline", update);
            connection?.removeEventListener("change", update);
        };
    }, [warmer, authenticated, playbackPreferences.metadataPrefetch]);
    return null;
}
export function useMetadataIntent(media: MediaToPlay) {
    const warmer = useMetadataWarmup();
    const { authenticated } = useAccountAccess();
    const { playbackPreferences } = useSettings();
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const latest = useRef(media);
    useLayoutEffect(() => { latest.current = media; }, [media]);
    const cancel = useCallback(() => { clearTimeout(timer.current); }, []);
    useEffect(() => cancel, [cancel, media.id, media.mediaSourceId]);
    const start = useCallback(() => {
        cancel();
        if (!authenticated || !playbackPreferences.metadataPrefetch) return;
        timer.current = setTimeout(() => { if (routePrefetchAllowed()) warmer?.enqueue(latest.current, true); }, 120);
    }, [cancel, authenticated, playbackPreferences.metadataPrefetch, warmer]);
    return { start, cancel };
}

export function useSeasonMetadataIntent(seriesId: string, selectedSeason: number | null, disabled = false) {
    const { playbackPreferences } = useSettings();
    const enabled = playbackPreferences.metadataPrefetch && !disabled;
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const cancel = useCallback(() => clearTimeout(timer.current), []);
    useEffect(() => cancel, [cancel, seriesId, selectedSeason, enabled]);
    return useCallback((value: string | null) => {
        cancel();
        if (!enabled || value === null || !/^\d+$/.test(value) || Number(value) === selectedSeason) return;
        timer.current = setTimeout(() => {
            if (routePrefetchAllowed()) warmSeriesSeason(seriesId, Number(value));
        }, 120);
    }, [cancel, enabled, seriesId, selectedSeason]);
}
export function useContinueWatchingMetadata(root: RefObject<HTMLDivElement | null>, items: MediaItem[]) {
    const warmer = useMetadataWarmup();
    const { authenticated } = useAccountAccess();
    const { playbackPreferences } = useSettings();
    useEffect(() => {
        if (!warmer || !authenticated || !playbackPreferences.metadataPrefetch || !root.current) return;
        const element = root.current;
        const viewport = element.querySelector<HTMLElement>("[data-media-row-viewport]");
        const cards = [...element.querySelectorAll<HTMLElement>("[data-continue-watching-index]")];
        let cancelIdle: (() => void) | undefined;
        const run = () => {
            cancelIdle = undefined;
            if (!routePrefetchAllowed() || !viewport) return;
            const clip = viewport.getBoundingClientRect();
            cards.filter(card => {
                const box = card.getBoundingClientRect();
                return box.width > 0 && box.height > 0
                    && Math.min(box.right, clip.right, window.innerWidth) - Math.max(box.left, clip.left, 0) >= box.width / 2
                    && Math.min(box.bottom, clip.bottom, window.innerHeight) - Math.max(box.top, clip.top, 0) >= box.height / 2;
            }).slice(0, 4).forEach(card => { const item = items[Number(card.dataset.continueWatchingIndex)]; if (item) warmer.enqueue(item); });
        };
        const check = () => {
            if (cancelIdle || !routePrefetchAllowed()) return;
            if (window.requestIdleCallback) { const id = window.requestIdleCallback(run, { timeout: 1500 }); cancelIdle = () => window.cancelIdleCallback(id); }
            else { const timer = setTimeout(run, 200); cancelIdle = () => clearTimeout(timer); }
        };
        const observer = new IntersectionObserver(check, { threshold: [0, .5, 1] });
        cards.forEach(card => observer.observe(card));
        viewport?.addEventListener("scroll", check, { passive: true });
        window.addEventListener("resize", check); document.addEventListener("visibilitychange", check);
        check();
        return () => { cancelIdle?.(); observer.disconnect(); viewport?.removeEventListener("scroll", check);
            window.removeEventListener("resize", check); document.removeEventListener("visibilitychange", check); };
    }, [root, items, warmer, authenticated, playbackPreferences.metadataPrefetch]);
}
