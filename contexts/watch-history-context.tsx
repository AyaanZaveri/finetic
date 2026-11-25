"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { fetchWatchedItems, setWatchedStatus } from "@/app/actions/watch-history";
import { WATCH_HISTORY_CHANGED, watchHistoryKey, type WatchHistoryItem, type WatchHistoryRequest, type WatchStatusInput } from "@/lib/watch-history";
import { createWatchStatusQueue } from "@/lib/watch-status-queue";

interface WatchHistoryContextValue {
    items: Record<string, WatchHistoryItem>;
    subscribe: (_request: WatchHistoryRequest) => () => void;
    update: (_request: WatchHistoryRequest, _item: WatchHistoryItem) => void;
    toggle: (_input: Omit<WatchStatusInput, "watched">) => Promise<boolean>;
}

const WatchHistoryContext = createContext<WatchHistoryContextValue>({ items: {}, subscribe: () => () => {}, update: () => {}, toggle: async () => false });

/** Account-scoped and shared across cards; never one API request per thumbnail. */
export function WatchHistoryProvider({ children, enabled = true, fetchItems = fetchWatchedItems, saveStatus = setWatchedStatus }: {
    children: ReactNode;
    enabled?: boolean;
    fetchItems?: typeof fetchWatchedItems;
    saveStatus?: typeof setWatchedStatus;
}) {
    const [items, setItems] = useState<Record<string, WatchHistoryItem>>({});
    const currentItems = useRef<Record<string, WatchHistoryItem>>({});
    const mutations = useRef<ReturnType<typeof createWatchStatusQueue> | null>(null);
    const cached = useRef(new Set<string>());
    const active = useRef(new Map<string, { request: WatchHistoryRequest; count: number }>());
    const pending = useRef(new Map<string, WatchHistoryRequest>());
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const generation = useRef({ value: 0 });
    const versions = useRef(new Map<string, number>());

    const enqueue = useCallback((request: WatchHistoryRequest) => {
        if (!enabled) return;
        const key = watchHistoryKey(request);
        if (mutations.current?.isPending(key)) return;
        versions.current.set(key, (versions.current.get(key) || 0) + 1);
        pending.current.set(key, request);
        if (timer.current !== null) return;
        timer.current = setTimeout(() => {
            timer.current = null;
            const batch = [...pending.current.values()].filter(item => !mutations.current?.isPending(watchHistoryKey(item)));
            pending.current.clear();
            const current = generation.current.value;
            for (let index = 0; index < batch.length; index += 100) {
                const chunk = batch.slice(index, index + 100);
                const sentVersions = new Map(chunk.map(item => [watchHistoryKey(item), versions.current.get(watchHistoryKey(item))]));
                void fetchItems(chunk).then(result => {
                    if (current !== generation.current.value) return;
                    if (result) {
                        const fresh = Object.fromEntries(Object.entries(result)
                            .filter(([key]) => versions.current.get(key) === sentVersions.get(key) && !mutations.current?.isPending(key)));
                        currentItems.current = { ...currentItems.current, ...fresh };
                        setItems(currentItems.current);
                    }
                    else chunk.forEach(item => cached.current.delete(watchHistoryKey(item)));
                }).catch(() => { chunk.forEach(item => cached.current.delete(watchHistoryKey(item))); });
            }
        }, 0);
    }, [enabled, fetchItems]);

    const subscribe = useCallback((request: WatchHistoryRequest) => {
        const key = watchHistoryKey(request);
        const existing = active.current.get(key);
        active.current.set(key, { request, count: (existing?.count || 0) + 1 });
        if (!cached.current.has(key)) {
            cached.current.add(key);
            enqueue(request);
        }
        return () => {
            const entry = active.current.get(key);
            if (entry && --entry.count === 0) active.current.delete(key);
        };
    }, [enqueue]);

    useEffect(() => {
        const lifecycle = generation.current;
        const cache = cached.current;
        const pendingRequests = pending.current;
        const refresh = (event: Event) => {
            const id = (event as CustomEvent<{ id?: string }>).detail?.id;
            // Off-screen cached items must refresh when mounted again.
            if (id) {
                cached.current.delete(`movie:${id}`);
                cached.current.delete(`series:${id}`);
            } else cached.current.clear();
            active.current.forEach(({ request }) => {
                if (!id || request.id === id) {
                    cached.current.add(watchHistoryKey(request));
                    enqueue(request);
                }
            });
        };
        window.addEventListener(WATCH_HISTORY_CHANGED, refresh);
        window.addEventListener("focus", refresh);
        return () => {
            lifecycle.value++;
            if (timer.current !== null) clearTimeout(timer.current);
            timer.current = null;
            cache.clear();
            pendingRequests.clear();
            window.removeEventListener(WATCH_HISTORY_CHANGED, refresh);
            window.removeEventListener("focus", refresh);
        };
    }, [enqueue]);

    const update = useCallback((request: WatchHistoryRequest, item: WatchHistoryItem) => {
        const key = watchHistoryKey(request);
        versions.current.set(key, (versions.current.get(key) || 0) + 1);
        cached.current.add(key);
        currentItems.current = { ...currentItems.current, [key]: item };
        setItems(currentItems.current);
    }, []);

    useEffect(() => {
        if (!enabled) return;
        const queue = createWatchStatusQueue({
            read: request => currentItems.current[watchHistoryKey(request)],
            update,
            save: saveStatus,
            settled: request => window.dispatchEvent(new CustomEvent(WATCH_HISTORY_CHANGED, { detail: { id: request.id } })),
        });
        mutations.current = queue;
        return () => {
            queue.dispose();
            if (mutations.current === queue) mutations.current = null;
        };
    }, [enabled, update, saveStatus]);

    const toggle = useCallback((input: Omit<WatchStatusInput, "watched">) => mutations.current?.toggle(input) ?? Promise.resolve(false), []);

    return <WatchHistoryContext.Provider value={{ items, subscribe, update, toggle }}>{children}</WatchHistoryContext.Provider>;
}

export function useWatchStatus(id: string, type: string, videoId?: string) {
    const { items, subscribe, update, toggle } = useContext(WatchHistoryContext);
    useEffect(() => {
        if (type !== "movie" && !(type === "series" && videoId)) return;
        return subscribe({ id, type: type as "movie" | "series" });
    }, [id, type, videoId, subscribe]);
    const state = items[`${type}:${id}`];
    const watched = type === "movie" ? Boolean(state?.movieWatched)
        : Boolean(videoId && state?.watchedEpisodeIds.includes(videoId));
    return { watched, known: Boolean(state), toggle: (name: string) => {
        if (type !== "movie" && type !== "series") return Promise.resolve(false);
        return toggle({ id, type, videoId, name });
    }, update: (item: WatchHistoryItem) => {
        if (type === "movie" || type === "series") update({ id, type }, item);
    } };
}

export function useWatchedStatus(id: string, type: string, videoId?: string): boolean {
    return useWatchStatus(id, type, videoId).watched;
}
