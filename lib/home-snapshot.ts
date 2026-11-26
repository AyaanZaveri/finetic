import { mediaArtwork } from "@/lib/artwork";
import { INITIAL_CATALOG_COUNT, type HomeCatalogSection } from "@/lib/home-catalogs";
import type { HomeCatalogRow } from "@/lib/home-catalog-stream";
import { HOME_HERO_ITEM_LIMIT } from "@/lib/home-hero";
import type { MediaItem } from "@/types/stremio";

const MAX_AGE = 24 * 60 * 60_000;
const STORE = "home";
const KEY = "active";
const HERO_SOURCE_VERSION = 2;
type Saved<T> = { data: T; updatedAt: number };
export type SavedCatalog = Saved<HomeCatalogSection>;
export type HomeSnapshot = {
    scope: string;
    catalogRevision: number;
    catalogs: SavedCatalog[];
    resume?: Saved<MediaItem[]>;
    hero?: Saved<MediaItem[]> & { sourceVersion?: number };
};

function text(value: unknown, max = 256) {
    return typeof value === "string" && value.length <= max ? value : undefined;
}

function id(value: unknown) {
    return typeof value === "string" && /^[\w-][\w.:-]{0,191}$/.test(value) ? value : undefined;
}

function number(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function artwork(item: MediaItem) {
    return mediaArtwork({ poster: text(item.poster), background: text(item.background), logo: text(item.logo) });
}

function genres(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const list = value
        .map(item => (typeof item === "string" ? item.trim() : ""))
        .filter((item): item is string => item.length > 0 && item.length <= 48)
        .slice(0, 5);
    return list.length ? list : undefined;
}

/** Keep only what the Home cards and hero need. Playback URLs and add-on URLs stay in memory. */
export function snapshotItems(items: MediaItem[], limit: number): MediaItem[] {
    if (!Array.isArray(items)) return [];
    return items.slice(0, limit).flatMap(item => {
        const itemId = id(item?.id);
        if (!itemId || !["movie", "series", "tv", "channel"].includes(item.type)) return [];
        const rating = number(item.communityRating);
        return [{
            id: itemId, type: item.type, name: text(item.name) || "Untitled",
            ...artwork(item), year: number(item.year), releaseInfo: text(item.releaseInfo),
            description: text(item.description, 480), genres: genres(item.genres),
            imdbRating: text(item.imdbRating, 16),
            communityRating: rating !== undefined && rating <= 10 ? rating : undefined,
            ratingSource: text(item.ratingSource, 32), runtime: text(item.runtime, 32),
            mediaSourceId: id(item.mediaSourceId), seriesId: id(item.seriesId), episodeId: id(item.episodeId),
            episodeTitle: text(item.episodeTitle), showName: text(item.showName),
            seasonNumber: number(item.seasonNumber), episodeNumber: number(item.episodeNumber),
            resumePositionTicks: number(item.resumePositionTicks), progressPercent: number(item.progressPercent),
            progressLabel: text(item.progressLabel),
        }];
    });
}

function safeSection(section: HomeCatalogSection): HomeCatalogSection | undefined {
    if (!section || typeof section.key !== "string" || !/^(addon-[\da-f]{64}|tmdb-[\w-]{1,80})$/.test(section.key)) return;
    const mediaItems = snapshotItems(section.mediaItems, 12);
    if (mediaItems.length) return { key: section.key, sectionName: text(section.sectionName) || "Catalog", mediaItems };
}

function fresh(timestamp: number, now: number) {
    return Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now && now - timestamp < MAX_AGE;
}

function prune(snapshot: HomeSnapshot, now: number): HomeSnapshot {
    const catalogs = (Array.isArray(snapshot.catalogs) ? snapshot.catalogs : []).slice(0, INITIAL_CATALOG_COUNT).flatMap(row => {
        const data = row && fresh(row.updatedAt, now) && safeSection(row.data);
        return data ? [{ data, updatedAt: row.updatedAt }] : [];
    });
    const resume = snapshot.resume && fresh(snapshot.resume.updatedAt, now) && Array.isArray(snapshot.resume.data)
        ? { data: snapshotItems(snapshot.resume.data, 20), updatedAt: snapshot.resume.updatedAt } : undefined;
    const hero = snapshot.hero?.sourceVersion === HERO_SOURCE_VERSION && fresh(snapshot.hero.updatedAt, now)
        ? { data: snapshotHero(snapshot.hero.data), updatedAt: snapshot.hero.updatedAt, sourceVersion: HERO_SOURCE_VERSION } : undefined;
    return { scope: snapshot.scope, catalogRevision: number(snapshot.catalogRevision) ?? 0, catalogs, resume, hero };
}

function snapshotHero(items: MediaItem[]) {
    return snapshotItems(items, HOME_HERO_ITEM_LIMIT).filter(item => item.background && (item.type === "movie" || item.type === "series"));
}

export function mergeHomeHero(snapshot: HomeSnapshot, items: MediaItem[], revision: number): HomeSnapshot {
    if ((snapshot.hero?.updatedAt ?? 0) > revision) return snapshot;
    return { ...snapshot, hero: { data: snapshotHero(items), updatedAt: revision, sourceVersion: HERO_SOURCE_VERSION } };
}

export function mergeHomeCatalogs(snapshot: HomeSnapshot, rows: HomeCatalogRow[], revision: number, now: number): HomeSnapshot {
    if (revision < snapshot.catalogRevision) return snapshot;
    const catalogs = rows.slice(0, INITIAL_CATALOG_COUNT).flatMap(row => {
        if (row.result.status === "error") {
            const previous = snapshot.catalogs.find(entry => entry.data.key === row.key && fresh(entry.updatedAt, now));
            return previous ? [previous] : [];
        }
        const data = row.result.section && safeSection(row.result.section);
        return data ? [{ data, updatedAt: now }] : [];
    });
    return { ...snapshot, catalogRevision: revision, catalogs };
}

let database: Promise<IDBDatabase> | undefined;

function open() {
    if (database) return database;
    database = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("navigator-home-v1", 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => { db.close(); database = undefined; };
            resolve(db);
        };
    }).catch(error => { database = undefined; throw error; });
    return database;
}

/** One record per browser profile. Read and update in the same transaction so
 * a catalog refresh cannot overwrite a watch-history update from another tab. */
async function change(update: (current: HomeSnapshot | undefined) => HomeSnapshot | undefined) {
    try {
        const db = await open();
        return await new Promise<HomeSnapshot | undefined>((resolve, reject) => {
            const transaction = db.transaction(STORE, "readwrite");
            const store = transaction.objectStore(STORE);
            const request = store.get(KEY);
            let next: HomeSnapshot | undefined;
            transaction.oncomplete = () => resolve(next);
            transaction.onabort = () => reject(transaction.error);
            request.onsuccess = () => {
                const current = request.result as HomeSnapshot | undefined;
                next = update(current);
                if (next === current) return;
                if (next) store.put(next, KEY);
                else store.delete(KEY);
            };
        });
    } catch { return undefined; } // Storage failures must never block a live read.
}

export function restoreHomeSnapshot(scope: string) {
    return change(current => {
        if (scope === "anonymous") return undefined;
        if (current?.scope === scope) return prune(current, Date.now());
        return { scope, catalogRevision: 0, catalogs: [] };
    });
}

export function updateHomeSnapshot(scope: string, update: (snapshot: HomeSnapshot, now: number) => HomeSnapshot) {
    return change(current => {
        if (!current || current.scope !== scope) return current;
        const now = Date.now();
        return update(prune(current, now), now);
    });
}
