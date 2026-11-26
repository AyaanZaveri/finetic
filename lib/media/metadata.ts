import { releaseYear } from "./release-year";
import { z } from "zod";
import type { MediaItem } from "@/types/stremio";
import type { Episode } from "@/app/actions/tv-shows";
import type { MediaToPlay } from "@/lib/atoms";
import { isMeaningfulEpisodeTitle } from "./playback-titles";
import { mergePlaybackDetails } from "./playback-details";

const text = z.string().trim().min(1).max(100_000).optional();
const rating = z.union([
    z.object({ source: z.enum(["IMDb", "TMDB"]), scope: z.enum(["title", "episode"]),
        value: z.number().min(0).max(10), votes: z.number().nonnegative().optional() }),
    z.object({ source: z.literal("Rotten Tomatoes"), scope: z.literal("title"),
        value: z.number().int().min(0).max(100), votes: z.number().nonnegative().optional() }),
]);
export const titleMetadataSchema = z.object({
    id: z.string(), type: z.enum(["movie", "series", "channel", "tv"]), imdbId: text, tmdbId: z.number().optional(),
    name: text, year: z.number().optional(), releaseInfo: text, releaseDate: text, runtime: text, synopsis: text,
    genres: z.array(z.string()).optional(), cast: z.array(z.string()).optional(),
    directors: z.array(z.string()).optional(), writers: z.array(z.string()).optional(),
    ratings: z.array(rating), contentRating: z.object({ value: z.string().trim().min(1).max(20), region: z.string().regex(/^[A-Z]{2}$/) }).optional(),
    artwork: z.object({ poster: text, backdrop: text, logo: text }),
});
export const episodeMetadataSchema = z.object({
    seriesId: z.string(), season: z.number().int().nonnegative(), episode: z.number().int().positive(),
    name: text, airDate: text, runtime: text, synopsis: text, still: text, ratings: z.array(rating),
});
const envelope = <T extends z.ZodType>(schema: T) => z.object({ data: schema, fetchedAt: z.number().positive(),
    coverage: z.enum(["preview", "header"]), unavailable: z.array(z.string()) });
export const titleEnvelopeSchema = envelope(titleMetadataSchema);
export const episodeEnvelopeSchema = envelope(episodeMetadataSchema);
export type TitleMetadata = z.infer<typeof titleMetadataSchema>;
export type EpisodeMetadata = z.infer<typeof episodeMetadataSchema>;
export type TitleEnvelope = z.infer<typeof titleEnvelopeSchema>;
export type EpisodeEnvelope = z.infer<typeof episodeEnvelopeSchema>;
export type MetadataEnvelope = TitleEnvelope | EpisodeEnvelope;
export const METADATA_DEFAULTS = { staleTime: 900_000, gcTime: 1_800_000, retry: false,
    refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;
export function metadataTarget(media: Pick<MediaToPlay, "id" | "type" | "seriesId" | "mediaSourceId" | "seasonNumber" | "episodeNumber">) {
    const source = media.mediaSourceId || media.id;
    const coordinates = /:(\d+):(\d+)$/.exec(source);
    return { id: (media.seriesId || media.id).replace(/:\d+:\d+$/, ""), type: media.type,
        season: media.seasonNumber ?? (coordinates ? Number(coordinates[1]) : undefined),
        episode: media.episodeNumber ?? (coordinates ? Number(coordinates[2]) : undefined) };
}
export const metadataKey = (scope: string, revision: string, type: string, id: string, season?: number, episode?: number) =>
    ["metadata", scope, revision, season === undefined ? "title" : "episode", type, id, "en-US", ...(season === undefined ? [] : [season, episode])] as const;
const clean = (value?: string | null) => value?.trim() || undefined;
export function titleEnvelope(item: MediaItem, fetchedAt: number, coverage: "preview" | "header" = "header"): TitleEnvelope {
    const ratings: TitleMetadata["ratings"] = [];
    const imdb = Number(item.imdbRating);
    if (item.imdbRating && Number.isFinite(imdb) && imdb >= 0 && imdb <= 10) ratings.push({ source: "IMDb", scope: "title", value: imdb });
    if (item.ratingSource === "TMDB" && typeof item.communityRating === "number") ratings.push({ source: "TMDB", scope: "title", value: item.communityRating, votes: item.voteCount });
    if (typeof item.rottenTomatoesRating === "number" && Number.isInteger(item.rottenTomatoesRating) && item.rottenTomatoesRating >= 0 && item.rottenTomatoesRating <= 100) ratings.push({ source: "Rotten Tomatoes", scope: "title", value: item.rottenTomatoesRating });
    const data = titleMetadataSchema.parse({ id: item.id, type: item.type, imdbId: clean(item.imdbId) || (/^tt\d+$/.test(item.id) ? item.id : undefined), tmdbId: item.tmdbId || (/^tmdb:[1-9]\d*$/.test(item.id) ? Number(item.id.slice(5)) : undefined),
        name: clean(item.name), year: releaseYear(item.year, item.releaseInfo), releaseInfo: clean(item.releaseInfo), releaseDate: /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(item.releaseInfo || "") ? item.releaseInfo : undefined, runtime: clean(item.runtime), synopsis: clean(item.description),
        genres: item.genres, cast: item.cast, directors: item.director, writers: item.writer, ratings, contentRating: item.contentRating,
        artwork: { poster: clean(item.poster), backdrop: clean(item.background), logo: clean(item.logo) } });
    return { data, fetchedAt, coverage, unavailable: coverage === "header" ? [...Object.entries(data).filter(([, v]) => v === undefined || Array.isArray(v) && !v.length).map(([k]) => k), ...Object.entries(data.artwork).filter(([, v]) => !v).map(([k]) => `artwork.${k}`)] : [] };
}
export function episodeEnvelope(item: Episode, seriesId: string, fetchedAt: number): EpisodeEnvelope {
    const data = episodeMetadataSchema.parse({ seriesId, season: item.season, episode: item.episode,
        name: isMeaningfulEpisodeTitle(item.title) ? clean(item.title) : undefined, airDate: clean(item.released),
        runtime: typeof item.runtime === "number" ? `${item.runtime} min` : item.runtime || undefined, synopsis: clean(item.overview), still: clean(item.thumbnail),
        ratings: item.ratingSource === "TMDB" && item.communityRating !== undefined
            ? [{ source: "TMDB", scope: "episode", value: item.communityRating, votes: item.voteCount }] : [] });
    return { data, fetchedAt, coverage: "header", unavailable: Object.entries(data).filter(([, v]) => v === undefined || Array.isArray(v) && !v.length).map(([k]) => k) };
}
export function metadataDetails(record: TitleEnvelope): MediaItem {
    const d = record.data;
    const imdb = d.ratings.find(r => r.source === "IMDb" && r.scope === "title");
    const tmdb = d.ratings.find(r => r.source === "TMDB" && r.scope === "title");
    const tomatoes = d.ratings.find(r => r.source === "Rotten Tomatoes" && r.scope === "title");
    return { id: d.id, type: d.type, name: d.name || "", imdbId: d.imdbId, tmdbId: d.tmdbId, year: d.year,
        releaseInfo: d.releaseInfo || d.releaseDate, runtime: d.runtime, description: d.synopsis, genres: d.genres, cast: d.cast,
        director: d.directors, writer: d.writers, poster: d.artwork.poster, background: d.artwork.backdrop, logo: d.artwork.logo,
        imdbRating: imdb ? String(imdb.value) : undefined, communityRating: tmdb?.value, ratingSource: tmdb?.source, voteCount: tmdb?.votes,
        contentRating: d.contentRating, rottenTomatoesRating: tomatoes?.value };
}
export function metadataEpisode(record: EpisodeEnvelope): Episode {
    const d = record.data, tmdb = d.ratings.find(r => r.source === "TMDB" && r.scope === "episode");
    return { id: `${d.seriesId}:${d.season}:${d.episode}`, season: d.season, episode: d.episode, title: d.name || "",
        released: d.airDate, runtime: d.runtime, overview: d.synopsis, thumbnail: d.still,
        communityRating: tmdb?.value, ratingSource: tmdb?.source, voteCount: tmdb?.votes };
}
export function enrichPlayback(media: MediaToPlay, title?: TitleEnvelope, episode?: EpisodeEnvelope): MediaToPlay {
    let details = title ? mergePlaybackDetails(media.details || { id: media.id, type: media.type, name: media.name }, metadataDetails(title)) : media.details;
    if (details && episode?.data.runtime) details = { ...details, runtime: episode.data.runtime };
    return { ...media, ...(title ? { details, detailsLoaded: true } : {}), ...(episode?.data.name ? { episodeTitle: episode.data.name } : {}) };
}
