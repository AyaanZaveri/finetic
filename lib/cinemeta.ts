import "server-only";
import { cache } from "react";
import { publicArtworkUrl } from "@/lib/artwork";
import { releaseYear } from "@/lib/media/release-year";
import type { MediaItem, StremioCatalogResponse, StremioMetaPreview, StremioMetaResponse } from "@/types/stremio";

type TitleType = "movie" | "series";
const base = "https://v3-cinemeta.strem.io";
const catalogBase = "https://cinemeta-catalogs.strem.io/top";
const imdbId = /^tt[0-9]+$/;

async function request<T>(path: string, signal?: AbortSignal): Promise<T | null> {
    const timeout = AbortSignal.timeout(5000);
    const origin = /^catalog\/(?:movie|series)\/top$/.test(path) ? catalogBase : base;
    const response = await fetch(`${origin}/${path}.json`, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        redirect: "error",
        next: { revalidate: path.includes("/search=") ? 60 : 600 },
    });
    if (response.status === 404 && path.startsWith("meta/")) return null;
    if (!response.ok) throw new Error("Cinemeta is temporarily unavailable.");
    return await response.json() as T;
}

function validTitle(item: StremioMetaPreview | undefined, type: TitleType): item is StremioMetaPreview {
    return !!item && item.type === type && typeof item.id === "string" && imdbId.test(item.id)
        && typeof item.name === "string" && !!item.name.trim();
}

export async function cinemetaCatalog(type: TitleType, query?: string, signal?: AbortSignal): Promise<MediaItem[]> {
    const extra = query ? `/search=${encodeURIComponent(query)}` : "";
    const response = await request<StremioCatalogResponse>(`catalog/${type}/top${extra}`, signal);
    if (!Array.isArray(response?.metas)) throw new Error("Cinemeta returned an invalid catalog.");
    return response.metas.filter(item => validTitle(item, type)).map(item => ({
        id: item.id, imdbId: item.id, type, name: item.name,
        poster: publicArtworkUrl(item.poster), background: publicArtworkUrl(item.background),
        logo: publicArtworkUrl(item.logo), description: item.description,
        releaseInfo: item.releaseInfo, year: releaseYear(undefined, item.releaseInfo), imdbRating: item.imdbRating,
    }));
}

export const cinemetaSearch = cache((type: TitleType, query: string) => cinemetaCatalog(type, query));

export async function cinemetaMetadata(type: TitleType, id: string, signal?: AbortSignal) {
    if (!imdbId.test(id)) return null;
    const data = await request<StremioMetaResponse>(`meta/${type}/${id}`, signal);
    return validTitle(data?.meta, type) && data?.meta.id === id ? data.meta : null;
}
