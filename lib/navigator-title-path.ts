import { buildEpisodePath, parseSeriesRouteId } from "@/lib/series-route";
import { pageTargetFromPath } from "@/lib/navigator-chat";
import type { MediaToPlay } from "@/lib/atoms";

export function navigatorArtworkTarget(path: string): MediaToPlay | undefined {
    const [pathname, query] = path.split("?", 2);
    if (pathname === "/api/navigator/title") {
        const params = new URLSearchParams(query);
        const id = params.get("id"), type = params.get("type");
        if (!id || !/^tmdb:[1-9]\d*$/.test(id) || (type !== "movie" && type !== "series")) return;
        const season = params.get("season"), episode = params.get("episode");
        if (season !== null || episode !== null) {
            if (type !== "series" || !season || !episode || !/^\d+$/.test(season) || !/^[1-9]\d*$/.test(episode)
                || !Number.isSafeInteger(Number(season)) || !Number.isSafeInteger(Number(episode))) return;
            return { id, name: "", type, seasonNumber: Number(season), episodeNumber: Number(episode) };
        }
        return { id, name: "", type };
    }
    const target = pageTargetFromPath(pathname);
    if (target && target.type !== "person") {
        return { id: target.id, name: "", type: target.type, seasonNumber: target.season, episodeNumber: target.episode };
    }
}

export function navigatorTitlePath(id: string, type: string, season?: number, episode?: number): string | undefined {
    const normalized = type.toLowerCase();
    if (!["movie", "series", "episode"].includes(normalized)) return undefined;
    const parsed = normalized === "episode" ? parseSeriesRouteId(id) : null;
    const base = parsed?.seriesId || id;
    const seasonNumber = season ?? parsed?.season, episodeNumber = episode ?? parsed?.episode;
    if (/^tmdb:[1-9]\d*$/.test(base)) {
        const params = new URLSearchParams({ id: base, type: normalized === "movie" ? "movie" : "series" });
        if (seasonNumber !== undefined && episodeNumber !== undefined) {
            params.set("season", String(seasonNumber)); params.set("episode", String(episodeNumber));
        }
        return `/api/navigator/title?${params}`;
    }
    if (normalized === "episode" && seasonNumber !== undefined && episodeNumber !== undefined) return buildEpisodePath(base, seasonNumber, episodeNumber);
    return `/${normalized === "movie" ? "movie" : "series"}/${encodeURIComponent(base)}`;
}
