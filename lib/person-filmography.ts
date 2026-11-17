import type { getTMDBFilmographyItems } from "./tmdb-discovery";

export type PersonCredit = Awaited<ReturnType<typeof getTMDBFilmographyItems>>[number];
export type PersonFilter = "all" | "movie" | "series";
export type PersonSort = "newest" | "popular";
export const FILMOGRAPHY_BATCH = 40;
export const creditIdentity = (item: PersonCredit) => `${item.type}:${item.id}`;
export const personFilter = (value: string | null): PersonFilter => value === "movie" || value === "series" ? value : "all";
export const personSort = (value: string | null): PersonSort => value === "popular" ? "popular" : "newest";

export function selectPersonCredits(items: PersonCredit[], type: PersonFilter, sort: PersonSort) {
    return items.filter(item => type === "all" || item.type === type).sort((a, b) =>
        (sort === "popular" ? (b.popularity || 0) - (a.popularity || 0) : 0)
        || (b.releaseInfo || "").localeCompare(a.releaseInfo || "")
        || (b.popularity || 0) - (a.popularity || 0) || a.name.localeCompare(b.name));
}

/** Retain already revealed cards across filters without mounting the full catalog. */
export function personCreditWindow(items: PersonCredit[], type: PersonFilter, sort: PersonSort, limits: Record<string, number>) {
    const key = `${type}:${sort}`;
    const selected = selectPersonCredits(items, type, sort);
    const visible = selected.slice(0, limits[key] || FILMOGRAPHY_BATCH);
    const pool = new Map<string, PersonCredit>();
    for (const [selection, limit] of Object.entries(limits)) {
        const [kind, order] = selection.split(":");
        for (const item of selectPersonCredits(items, personFilter(kind), personSort(order)).slice(0, limit)) pool.set(creditIdentity(item), item);
    }
    for (const item of visible) pool.set(creditIdentity(item), item);
    const shown = new Set(visible.map(creditIdentity));
    const ordered = [...visible.map(creditIdentity), ...Array.from(pool.keys()).filter(id => !shown.has(id))];
    return { pool, shown, ordered, total: selected.length, hasMore: visible.length < selected.length };
}
