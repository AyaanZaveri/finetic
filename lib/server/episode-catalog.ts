import "server-only";
import { getTMDBEpisodes, getTMDBSeasons, getTMDBTitle, mapTMDBSeasons } from "@/lib/tmdb-discovery";

export async function readEpisodeCatalogTitle(id: string, useTMDB: boolean, signal?: AbortSignal) {
    if (useTMDB) return getTMDBTitle(id, "series", signal);
    const { fetchMediaDetails } = await import("@/app/actions/media");
    const title = await fetchMediaDetails(id, "series", signal);
    if (!title) throw new Error("The series metadata is unavailable.");
    return { ...title, overview: title.description };
}

export async function readEpisodeCatalog(
    title: Awaited<ReturnType<typeof readEpisodeCatalogTitle>>, useTMDB: boolean, season?: number, signal?: AbortSignal,
) {
    const television = useTMDB ? undefined : await import("@/app/actions/tv-shows");
    const seasons = title.seasons?.length ? title.seasons
        : await (television ? television.fetchSeasons(title.id, signal) : getTMDBSeasons(title.id, signal));
    const numbers = season === undefined ? seasons.filter(item => item.number > 0).map(item => item.number)
        : seasons.some(item => item.number === season) ? [season] : [];
    const episodes = television
        ? numbers.length ? (await television.fetchEpisodes(title.id, season, signal)).filter(item => numbers.includes(item.season)) : []
        : (await mapTMDBSeasons(numbers, number => getTMDBEpisodes(title.id, number, signal), signal)).flat();
    return { seasons, numbers, episodes };
}
