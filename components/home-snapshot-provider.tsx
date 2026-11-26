"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { continueWatchingKey } from "@/lib/media/continue-watching-query";
import { mergeHomeCatalogs, mergeHomeHero, restoreHomeSnapshot, snapshotItems, updateHomeSnapshot, type SavedCatalog } from "@/lib/home-snapshot";
import type { HomeCatalogRow } from "@/lib/home-catalog-stream";
import type { MediaItem } from "@/types/stremio";

export type HomeHeroView = { slide: string; rotation: boolean | null };

const CatalogContext = createContext<{
    catalogs: SavedCatalog[];
    saveCatalogs: (_rows: HomeCatalogRow[], _revision: number) => void;
} | null>(null);
const HeroContext = createContext<{
    heroItems: MediaItem[] | null;
    heroView: HomeHeroView | null;
    saveHero: (_items: MediaItem[]) => void;
    saveHeroView: (_view: HomeHeroView) => void;
} | null>(null);

export const useHomeSnapshot = () => useContext(CatalogContext);
export const useHomeHeroSnapshot = () => useContext(HeroContext);

export function HomeSnapshotProvider({ scope, children }: { scope: string; children: ReactNode }) {
    const client = useQueryClient();
    const [catalogs, setCatalogs] = useState<SavedCatalog[]>([]);
    const [heroItems, setHeroItems] = useState<MediaItem[] | null>(null);
    const [heroView, setHeroView] = useState<HomeHeroView | null>(null);
    const active = useRef<object | null>(null);
    const saveHero = useCallback((items: MediaItem[]) => {
        // Route returns need an immediate in-memory value even for guests or
        // when IndexedDB is unavailable.
        setHeroItems(items);
        if (scope === "anonymous") return;
        const revision = Date.now();
        void updateHomeSnapshot(scope, snapshot => mergeHomeHero(snapshot, items, revision));
    }, [scope]);
    const saveHeroView = useCallback((view: HomeHeroView) => {
        setHeroView(previous => previous?.slide === view.slide && previous.rotation === view.rotation ? previous : view);
    }, []);
    const saveCatalogs = useCallback((rows: HomeCatalogRow[], revision: number) => {
        const owner = active.current;
        if (!owner || scope === "anonymous") return;
        void updateHomeSnapshot(scope, (snapshot, now) => mergeHomeCatalogs(snapshot, rows, revision, now)).then(snapshot => {
            if (active.current === owner && snapshot?.scope === scope) setCatalogs(snapshot.catalogs);
        });
    }, [scope]);

    useEffect(() => {
        const owner = {};
        active.current = owner;
        const key = continueWatchingKey(scope);
        let restoring = false;
        void restoreHomeSnapshot(scope).then(snapshot => {
            if (active.current !== owner || snapshot?.scope !== scope) return;
            setCatalogs(snapshot.catalogs);
            const rememberedHero = snapshot.hero?.data;
            if (rememberedHero) setHeroItems(current => current ?? rememberedHero);
            if (snapshot.resume && client.getQueryData(key) === undefined) {
                // Seed the existing query without stopping a live mount refresh.
                restoring = true;
                client.setQueryData(key, snapshot.resume.data, { updatedAt: snapshot.resume.updatedAt });
                restoring = false;
            }
        });
        const unsubscribe = client.getQueryCache().subscribe(event => {
            if (restoring || scope === "anonymous" || event.type !== "updated" || event.action.type !== "success"
                || event.query.queryKey.length !== key.length || event.query.queryKey[0] !== key[0] || event.query.queryKey[1] !== scope) return;
            const { data, dataUpdatedAt } = event.query.state;
            if (!Array.isArray(data)) return;
            const items = snapshotItems(data as MediaItem[], 20);
            void updateHomeSnapshot(scope, snapshot => (snapshot.resume?.updatedAt ?? 0) > dataUpdatedAt
                ? snapshot : { ...snapshot, resume: { data: items, updatedAt: dataUpdatedAt } });
        });
        return () => { active.current = null; unsubscribe(); };
    }, [client, scope]);

    const catalogValue = useMemo(() => ({ catalogs, saveCatalogs }), [catalogs, saveCatalogs]);
    const heroValue = useMemo(() => ({ heroItems, heroView, saveHero, saveHeroView }), [heroItems, heroView, saveHero, saveHeroView]);
    return <CatalogContext.Provider value={catalogValue}>
        <HeroContext.Provider value={heroValue}>{children}</HeroContext.Provider>
    </CatalogContext.Provider>;
}
