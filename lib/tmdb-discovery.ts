import "server-only";

import { getTMDBToken } from "@/lib/tmdb-credentials";
import { parseSeriesRouteId } from "@/lib/series-route";
import { getTMDBArtwork } from "@/lib/tmdb-artwork";
import type { MediaItem } from "@/types/stremio";
import type { HomeCatalogSection } from "@/lib/home-catalogs";

export type TMDBMediaType = "movie" | "series";
export type FilmographyRole = "all" | "acting" | "directing" | "writing" | "producing";
type Params = Record<string, string | number | boolean | undefined>;

interface TMDBTitleRecord {
    id: number;
    media_type?: "movie" | "tv" | "person";
    title?: string;
    name?: string;
    original_title?: string;
    original_name?: string;
    overview?: string;
    poster_path?: string | null;
    backdrop_path?: string | null;
    release_date?: string;
    first_air_date?: string;
    vote_average?: number;
    vote_count?: number;
    popularity?: number;
    adult?: boolean;
    character?: string;
    job?: string;
    department?: string;
}
interface TMDBPage<T> { results: T[]; page: number; total_pages: number; total_results: number }
interface TMDBPersonRecord {
    id: number; name: string; profile_path?: string | null;
    known_for_department?: string; known_for?: TMDBTitleRecord[]; adult?: boolean;
}
interface TMDBSeasonRecord {
    id: number; season_number: number; name: string; episode_count: number;
    overview?: string; air_date?: string; poster_path?: string | null;
}
interface TMDBEpisodeRecord {
    id: number; name: string; season_number: number; episode_number: number;
    overview?: string; air_date?: string; still_path?: string | null; vote_average?: number; vote_count?: number; runtime?: number;
    guest_stars?: { name: string; character?: string }[];
    crew?: { name: string; job?: string }[];
}
interface TMDBTitleDetails extends TMDBTitleRecord {
    imdb_id?: string | null;
    external_ids?: { imdb_id?: string | null };
    genres?: { id: number; name: string }[];
    runtime?: number;
    episode_run_time?: number[];
    status?: string;
    tagline?: string;
    number_of_episodes?: number;
    seasons?: TMDBSeasonRecord[];
    credits?: {
        cast?: (TMDBPersonRecord & { character?: string })[];
        crew?: (TMDBPersonRecord & { job?: string; department?: string })[];
    };
}

export function tmdbImage(path?: string | null, size = "w500") {
    return path && /^\/[\w.-]+\.(jpg|jpeg|png|webp)$/i.test(path) ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;
}

async function request<T>(path: string, params: Params = {}, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const token = await getTMDBToken();
    if (!token) throw new Error("Add your TMDB read access token in Settings → TMDB to search titles and people.");
    const query = new URLSearchParams({ language: "en-US" });
    for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
    try {
        const timeout = AbortSignal.timeout(8000);
        const response = await fetch(`https://api.themoviedb.org/3/${path}?${query}`, {
            redirect: "manual",
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
            next: { revalidate: /^(search|trending|discover)\//.test(path) ? 3600 : 86400 },
        });
        if (response.status === 401 || response.status === 403) throw new Error("TMDB rejected the access token. Update it in Settings → TMDB.");
        if (response.status === 429) throw new Error("TMDB is rate limiting requests. Please try again shortly.");
        if (response.status === 404) throw new Error("This title, person, or episode was not found on TMDB.");
        if (!response.ok) throw new Error("TMDB could not complete this lookup. Please try again.");
        return await response.json() as T;
    } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof Error && error.message.startsWith("TMDB")) throw error;
        if (error instanceof Error && error.message.includes("not found on TMDB")) throw error;
        throw new Error("Could not reach TMDB. Check your connection and try again.");
    }
}

export async function tmdbIdForTitle(id: string, type: TMDBMediaType, signal?: AbortSignal): Promise<number> {
    const base = type === "series" ? parseSeriesRouteId(id).seriesId : id;
    // Tools also expose numeric tmdbId values. The media type scopes those IDs.
    const native = /^(?:tmdb:)?([1-9]\d*)$/.exec(base);
    if (native && Number.isSafeInteger(Number(native[1]))) return Number(native[1]);
    if (!/^tt\d+$/.test(base)) throw new Error("Use a movie or series ID returned by TMDB search.");
    const found = await request<{ movie_results: TMDBTitleRecord[]; tv_results: TMDBTitleRecord[] }>(
        `find/${base}`, { external_source: "imdb_id" }, signal,
    );
    const match = (type === "movie" ? found.movie_results : found.tv_results)?.[0];
    if (!match) throw new Error("This title was not found on TMDB.");
    return match.id;
}

function titleResult(item: TMDBTitleRecord, type: TMDBMediaType) {
    const date = type === "movie" ? item.release_date : item.first_air_date;
    return {
        id: `tmdb:${item.id}`, tmdbId: item.id, source: "TMDB" as const, type,
        name: item.title || item.name || item.original_title || item.original_name || "Untitled",
        year: date ? Number(date.slice(0, 4)) || undefined : undefined,
        releaseInfo: date || undefined, description: item.overview || "", overview: item.overview || "",
        poster: tmdbImage(item.poster_path), background: tmdbImage(item.backdrop_path, "w1280"),
        communityRating: item.vote_count ? item.vote_average : undefined, ratingSource: "TMDB",
        voteCount: item.vote_count, popularity: item.popularity,
        sourceUrl: `https://www.themoviedb.org/${type === "movie" ? "movie" : "tv"}/${item.id}`,
    };
}

/** Maintained TMDB feeds need no Stremio account or user-owned list IDs.
 * Provider discovery is TMDB popularity within a regional catalog, not the
 * provider's own viewing chart. Keep that distinction in the section labels.
 */
export function getTMDBHomeRows(only?: ReadonlySet<string>, signal?: AbortSignal) {
    const configuredRegion = process.env.TMDB_WATCH_REGION?.trim().toUpperCase();
    const region = configuredRegion && /^[A-Z]{2}$/.test(configuredRegion) ? configuredRegion : "US";
    const feeds: { key: string; name: string; path: string; type: TMDBMediaType; params?: Params }[] = [
        { key: "trending-movies", name: "Trending Movies", path: "trending/movie/week", type: "movie" },
        { key: "trending-series", name: "Trending TV Shows", path: "trending/tv/week", type: "series" },
        { key: "netflix-movies", name: `Popular on Netflix • Movies • ${region}`, path: "discover/movie", type: "movie",
            params: { with_watch_providers: 8, watch_region: region, with_watch_monetization_types: "flatrate", sort_by: "popularity.desc" } },
        { key: "netflix-series", name: `Popular on Netflix • TV Shows • ${region}`, path: "discover/tv", type: "series",
            params: { with_watch_providers: 8, watch_region: region, with_watch_monetization_types: "flatrate", sort_by: "popularity.desc" } },
        { key: "top-rated-movies", name: "Top Rated Movies", path: "movie/top_rated", type: "movie" },
        { key: "top-rated-series", name: "Top Rated TV Shows", path: "tv/top_rated", type: "series" },
    ];
    const rows = feeds.filter(feed => !only || only.has(`tmdb-${feed.key}`)).map(feed => ({
        key: `tmdb-${feed.key}`, sectionName: feed.name,
        retry: { feed: `tmdb-${feed.key}` },
        result: (async (): Promise<import("./home-catalogs").HomeCatalogResult> => {
            try {
                const data = await request<TMDBPage<TMDBTitleRecord>>(feed.path, { include_adult: false, ...feed.params }, signal);
                return { status: "ready", section: {
                    key: `tmdb-${feed.key}`, sectionName: feed.name,
                    mediaItems: data.results.filter(item => !item.adult && Number.isSafeInteger(item.id) && item.id > 0)
                        .slice(0, 20).map(item => titleResult(item, feed.type)),
                } };
            } catch { return { status: "error" }; }
        })(),
    }));
    return { rows, region };
}

/** Compatibility aggregate for non-streaming consumers. Home renders each
 * stable row promise independently instead of awaiting this whole set. */
export async function getTMDBHomeSections(): Promise<{ sections: HomeCatalogSection[]; region: string }> {
    const { rows, region } = getTMDBHomeRows();
    const results = await Promise.all(rows.map(row => row.result));
    const sections = results.flatMap(result => result.status === "ready" && result.section?.mediaItems.length ? [result.section] : []);
    if (!sections.length && results.some(result => result.status === "error")) throw new Error("Home discovery is unavailable.");
    return { sections, region };
}

export async function searchTMDBMedia(query: string, signal?: AbortSignal, type?: TMDBMediaType, page = 1) {
    if (!query.trim()) return { results: [], page: 1, totalPages: 0, totalResults: 0 };
    const data = await request<TMDBPage<TMDBTitleRecord>>(`search/${type === "series" ? "tv" : type || "multi"}`, {
        query: query.trim(), include_adult: false, page,
    }, signal);
    return {
        results: data.results.filter(item => !item.adult && (type || item.media_type === "movie" || item.media_type === "tv"))
            .map(item => titleResult(item, type || (item.media_type === "movie" ? "movie" : "series"))),
        page: data.page, totalPages: data.total_pages, totalResults: data.total_results,
    };
}

/** Resolve only a selected title, rather than performing one request per search result. */
export async function resolveTMDBPlaybackId(id: string, type: TMDBMediaType, signal?: AbortSignal): Promise<string> {
    const base = type === "series" ? parseSeriesRouteId(id).seriesId : id;
    if (/^tt\d+$/.test(base)) return base;
    const tmdbId = await tmdbIdForTitle(base, type, signal);
    const external = await request<{ imdb_id?: string | null }>(`${type === "movie" ? "movie" : "tv"}/${tmdbId}/external_ids`, {}, signal);
    return external.imdb_id && /^tt\d+$/.test(external.imdb_id) ? external.imdb_id : `tmdb:${tmdbId}`;
}

/** Keep episode coordinates when translating a selected title for an add-on. */
export async function resolveAddonMediaId(id: string, type: TMDBMediaType, signal?: AbortSignal): Promise<string> {
    if (!/^tmdb:[1-9]\d*(?=:|$)/.test(id)) return id;
    const parsed = type === "series" ? parseSeriesRouteId(id) : null;
    const base = await resolveTMDBPlaybackId(parsed?.seriesId || id, type, signal);
    return parsed?.isEpisodeTarget ? `${base}:${parsed.season}:${parsed.episode}` : base;
}

export async function getTMDBTitle(id: string, type: TMDBMediaType, signal?: AbortSignal) {
    const tmdbId = await tmdbIdForTitle(id, type, signal);
    const details = await request<TMDBTitleDetails>(`${type === "movie" ? "movie" : "tv"}/${tmdbId}`, {
        append_to_response: "external_ids,credits",
    }, signal);
    const result = titleResult(details, type);
    const imdbId = details.imdb_id || details.external_ids?.imdb_id || undefined;
    return {
        ...result, imdbId, runtime: details.runtime || details.episode_run_time?.[0],
        genres: details.genres?.map(genre => genre.name) || [], status: details.status, tagline: details.tagline,
        cast: details.credits?.cast?.slice(0, 20).map(person => person.name) || [],
        people: [
            ...(details.credits?.cast?.slice(0, 12).map(person => ({ id: person.id, name: person.name, role: person.character || "Cast" })) || []),
            ...(details.credits?.crew?.filter(person => ["Director", "Writer", "Screenplay", "Creator"].includes(person.job || ""))
                .slice(0, 12).map(person => ({ id: person.id, name: person.name, role: person.job })) || []),
        ],
        director: details.credits?.crew?.filter(person => person.job === "Director").map(person => person.name) || [],
        writer: details.credits?.crew?.filter(person => ["Writer", "Screenplay"].includes(person.job || "")).map(person => person.name) || [],
        seasons: (details.seasons || []).map(season => ({
            id: `${result.id}:${season.season_number}`, name: season.name, number: season.season_number,
            episodeCount: season.episode_count, overview: season.overview, releaseInfo: season.air_date,
            poster: tmdbImage(season.poster_path),
        })),
        episodeCount: details.number_of_episodes,
    };
}

export async function getTMDBSeasons(seriesId: string, signal?: AbortSignal) {
    return (await getTMDBTitle(seriesId, "series", signal)).seasons;
}

/** Fetch one requested episode, without loading a season or episode list. */
export async function getTMDBEpisode(seriesId: string, season: number, episode: number, signal?: AbortSignal) {
    if (!Number.isSafeInteger(season) || season < 0 || !Number.isSafeInteger(episode) || episode < 1) {
        throw new Error("Choose valid season and episode numbers.");
    }
    const tmdbId = await tmdbIdForTitle(seriesId, "series", signal);
    const data = await request<TMDBEpisodeRecord>(`tv/${tmdbId}/season/${season}/episode/${episode}`, {}, signal);
    return {
        id: `tmdb:${tmdbId}:${season}:${episode}`, seriesId: `tmdb:${tmdbId}`,
        name: data.name, thumbnail: tmdbImage(data.still_path), released: data.air_date, overview: data.overview,
        runtime: data.runtime ? `${data.runtime} min` : undefined, communityRating: data.vote_count ? data.vote_average : undefined, ratingSource: "TMDB", voteCount: data.vote_count,
        seasonNumber: season, episodeNumber: episode,
    };
}

/** Small chat context, not full title/credits or a season enumeration. */
export async function getTMDBPageContext(target: { id: string; type: TMDBMediaType; season?: number; episode?: number }, signal?: AbortSignal) {
    const tmdbId = await tmdbIdForTitle(target.id, target.type, signal);
    const id = `tmdb:${tmdbId}`;
    const episodeTarget = target.type === "series" && target.season !== undefined && target.episode !== undefined;
    const [title, episode] = await Promise.allSettled([
        request<TMDBTitleRecord>(`${target.type === "movie" ? "movie" : "tv"}/${tmdbId}`, {}, signal),
        episodeTarget ? getTMDBEpisode(id, target.season!, target.episode!, signal) : Promise.resolve(null),
    ]);
    signal?.throwIfAborted();
    if (title.status === "rejected") throw title.reason;
    const details = titleResult(title.value, target.type);
    return { id, name: details.name, type: target.type, source: "TMDB" as const,
        ...(episode.status === "fulfilled" && episode.value ? {
            episodeId: episode.value.id, episodeTitle: episode.value.name,
            seasonNumber: target.season, episodeNumber: target.episode,
        } : {}),
    };
}

export async function getTMDBEpisodes(seriesId: string, season: number, signal?: AbortSignal) {
    if (!Number.isSafeInteger(season) || season < 0) throw new Error("Choose a valid season number.");
    const tmdbId = await tmdbIdForTitle(seriesId, "series", signal);
    const data = await request<{ episodes: TMDBEpisodeRecord[] }>(`tv/${tmdbId}/season/${season}`, {}, signal);
    return data.episodes.map(episode => ({
        id: `tmdb:${tmdbId}:${episode.season_number}:${episode.episode_number}`,
        tmdbEpisodeId: episode.id, seriesId: `tmdb:${tmdbId}`, title: episode.name,
        name: episode.name, season: episode.season_number, episode: episode.episode_number,
        overview: episode.overview, thumbnail: tmdbImage(episode.still_path), released: episode.air_date,
        communityRating: episode.vote_average, runtime: episode.runtime, source: "TMDB",
        guestStars: episode.guest_stars?.map(person => ({ name: person.name, character: person.character })) || [],
        crew: episode.crew?.filter(person => ["Director", "Writer", "Story", "Teleplay"].includes(person.job || ""))
            .map(person => ({ name: person.name, job: person.job })) || [],
    }));
}

/** Bound season fan-out for long-running series and stop scheduling after cancellation. */
export async function mapTMDBSeasons<T>(seasons: number[], load: (_season: number) => Promise<T>, signal?: AbortSignal): Promise<T[]> {
    const results: T[] = new Array(seasons.length);
    let next = 0;
    let failed = false;
    await Promise.all(Array.from({ length: Math.min(4, seasons.length) }, async () => {
        while (!failed && next < seasons.length) {
            signal?.throwIfAborted();
            const index = next++;
            try { results[index] = await load(seasons[index]); } catch (error) { failed = true; throw error; }
        }
    }));
    return results;
}

export async function searchTMDBPeople(query: string, signal?: AbortSignal, page = 1) {
    const data = await request<TMDBPage<TMDBPersonRecord>>("search/person", { query: query.trim(), include_adult: false, page }, signal);
    return {
        results: data.results.filter(person => !person.adult).map(person => ({
            id: person.id, name: person.name, type: "Person", source: "TMDB", department: person.known_for_department,
            poster: tmdbImage(person.profile_path, "w185"),
            knownFor: person.known_for?.filter(item => item.media_type === "movie" || item.media_type === "tv")
                .map(item => titleResult(item, item.media_type === "movie" ? "movie" : "series")) || [],
            sourceUrl: `https://www.themoviedb.org/person/${person.id}`,
        })),
        page: data.page, totalPages: data.total_pages, totalResults: data.total_results,
    };
}

export async function getTMDBPerson(personId: number, signal?: AbortSignal) {
    const person = await request<TMDBPersonRecord & {
        biography?: string; birthday?: string; deathday?: string; place_of_birth?: string; also_known_as?: string[];
    }>(`person/${personId}`, {}, signal);
    return {
        id: person.id, name: person.name, type: "Person", source: "TMDB", department: person.known_for_department,
        biography: person.biography, birthday: person.birthday, deathday: person.deathday,
        birthplace: person.place_of_birth, aliases: person.also_known_as || [],
        poster: tmdbImage(person.profile_path, "w185"), sourceUrl: `https://www.themoviedb.org/person/${person.id}`,
    };
}

export async function getTMDBFilmography(personId: number, options: {
    mediaType?: TMDBMediaType; role?: FilmographyRole; page?: number; limit?: number;
} = {}, signal?: AbortSignal) {
    const data = await request<{ cast: TMDBTitleRecord[]; crew: TMDBTitleRecord[] }>(`person/${personId}/combined_credits`, {}, signal);
    const role = options.role || "all";
    const jobs: Record<string, string[]> = { directing: ["Director"], writing: ["Writer", "Screenplay", "Story", "Teleplay", "Creator"], producing: ["Producer", "Executive Producer", "Co-Producer"] };
    const credits = [
        ...(role === "all" || role === "acting" ? data.cast.map(item => ({ ...item, creditRole: "Acting" })) : []),
        ...(role !== "acting" ? data.crew.filter(item => role === "all" || jobs[role]?.includes(item.job || ""))
            .map(item => ({ ...item, creditRole: item.job || item.department || "Crew" })) : []),
    ];
    const unique = new Map<string, ReturnType<typeof titleResult> & { roles: string[]; characters: string[] }>();
    for (const credit of credits) {
        if (credit.adult || (credit.media_type !== "movie" && credit.media_type !== "tv")) continue;
        const type = credit.media_type === "movie" ? "movie" : "series";
        if (options.mediaType && options.mediaType !== type) continue;
        const key = `${type}:${credit.id}`;
        const item = unique.get(key) || { ...titleResult(credit, type), roles: [], characters: [] };
        if (!item.roles.includes(credit.creditRole)) item.roles.push(credit.creditRole);
        if (credit.character && !item.characters.includes(credit.character)) item.characters.push(credit.character);
        unique.set(key, item);
    }
    const all = [...unique.values()].sort((a, b) => (b.releaseInfo || "").localeCompare(a.releaseInfo || "") || (b.popularity || 0) - (a.popularity || 0));
    const page = Math.max(1, options.page || 1), limit = Math.min(40, Math.max(1, options.limit || 20));
    return { results: all.slice((page - 1) * limit, page * limit), page, totalResults: all.length, totalPages: Math.ceil(all.length / limit) };
}

/** Native TMDB-only titles remain viewable even when no IMDb mapping exists. */
export async function tmdbMediaItem(id: string, type: TMDBMediaType, signal?: AbortSignal): Promise<MediaItem> {
    const title = await getTMDBTitle(id, type, signal);
    return {
        id: title.id, imdbId: title.imdbId, type, name: title.name, description: title.overview, year: title.year,
        releaseInfo: title.releaseInfo, poster: title.poster, background: title.background,
        logo: await getTMDBArtwork(id, type, "logo"),
        genres: title.genres, cast: title.cast, director: title.director, writer: title.writer,
        communityRating: title.communityRating, ratingSource: title.ratingSource, voteCount: title.voteCount,
        runtime: title.runtime ? `${title.runtime} min` : undefined,
        seasons: type === "series" ? title.seasons.filter(season => season.episodeCount > 0)
            .map(({ number, name, episodeCount }) => ({ number, name, episodeCount })) : undefined,
    };
}
