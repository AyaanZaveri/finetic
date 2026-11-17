import "server-only";

import { getTMDBPersonKnownFor, getTMDBTitle } from "@/lib/tmdb-discovery";
import type { MediaItem } from "@/types/stremio";

/** The public API exposes only a short known_for list. The website renders
 * its full selection in this list. Read only numeric title references, never HTML. */
export function parseTMDBKnownFor(html: string): { id: string; type: "movie" | "series" }[] | null {
    const section = /\bid=["']known_for_scroller["'][^>]*>[\s\S]*?<ul\b[^>]*>([\s\S]*?)<\/ul>/i.exec(html)?.[1];
    if (section === undefined) return null;
    const seen = new Set<string>();
    const titles: { id: string; type: "movie" | "series" }[] = [];
    for (const match of section.matchAll(/\bhref=["']\/(movie|tv)\/([1-9]\d*)(?=[-/?#"'])/gi)) {
        if (!Number.isSafeInteger(Number(match[2]))) continue;
        const type = match[1].toLowerCase() === "movie" ? "movie" : "series";
        const id = `tmdb:${match[2]}`, key = `${type}:${id}`;
        if (!seen.has(key)) { seen.add(key); titles.push({ id, type }); }
    }
    return titles;
}

export async function getTMDBWebsiteKnownFor(personId: number, name: string, credits: MediaItem[], signal?: AbortSignal): Promise<MediaItem[]> {
    if (!Number.isSafeInteger(personId) || personId <= 0) return [];
    try {
        const origin = "https://www.themoviedb.org";
        let url = `${origin}/person/${personId}?language=en-US`;
        const timeout = AbortSignal.timeout(8000);
        const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
        let references: ReturnType<typeof parseTMDBKnownFor> = null;
        for (let redirect = 0; redirect <= 2; redirect++) {
            const response = await fetch(url, {
                headers: { Accept: "text/html", "Accept-Language": "en-US" }, redirect: "manual",
                signal: requestSignal, next: { revalidate: 86400 },
            });
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                const location = response.headers.get("location");
                if (!location) break;
                const next = new URL(location, url);
                if (next.origin !== origin || !new RegExp(`^/person/${personId}(?:-|/|$)`).test(next.pathname)) break;
                url = next.href;
                continue;
            }
            if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) break;
            const html = await response.text();
            if (html.length <= 2_000_000) references = parseTMDBKnownFor(html);
            break;
        }
        if (references) {
            const byId = new Map(credits.map(item => [`${item.type}:${item.id}`, item]));
            const titles = await Promise.all(references.map(async reference => {
                const existing = byId.get(`${reference.type}:${reference.id}`);
                if (existing) return existing;
                // The API credit cache can lag behind the website's selection.
                return getTMDBTitle(reference.id, reference.type, signal)
                    .then(title => ({ ...title, runtime: title.runtime ? `${title.runtime} min` : undefined }))
                    .catch(() => null);
            }));
            const available = titles.filter((item): item is NonNullable<typeof item> => item !== null);
            if (available.length || !references.length) return available;
        }
    } catch {
        signal?.throwIfAborted();
    }
    return getTMDBPersonKnownFor(personId, name, signal);
}
