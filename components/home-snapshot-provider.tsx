"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { continueWatchingKey } from "@/lib/media/continue-watching-query";
import { mergeHomeCatalogs, restoreHomeSnapshot, snapshotItems, updateHomeSnapshot, type SavedCatalog } from "@/lib/home-snapshot";
import type { HomeCatalogRow } from "@/lib/home-catalog-stream";
import type { MediaItem } from "@/types/stremio";

const Context = createContext<{
    catalogs: SavedCatalog[];
    saveCatalogs: (_rows: HomeCatalogRow[], _revision: number) => void;
} | null>(null);

export const useHomeSnapshot = () => useContext(Context);

export function HomeSnapshotProvider({ scope, children }: { scope: string; children: ReactNode }) {
    const client = useQueryClient();
    const [catalogs, setCatalogs] = useState<SavedCatalog[]>([]);
    const active = useRef<object | null>(null);
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

    return <Context.Provider value={{ catalogs, saveCatalogs }}>{children}</Context.Provider>;
}
