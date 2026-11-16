import type { MediaItem } from "@/types/stremio";
import type { MediaToPlay } from "@/lib/atoms";
import { mediaArtwork } from "@/lib/artwork";
import { parseSeriesRouteId } from "@/lib/series-route";

export function playbackDetailsId(media: Pick<MediaToPlay, "id" | "seriesId" | "type">) {
  const id = media.seriesId || media.id;
  return media.type === "series" ? parseSeriesRouteId(id).seriesId : id;
}

/** Canonical artwork URLs can start downloading before metadata or streams. */
export function initialPlaybackDetails(media: MediaToPlay): MediaItem {
  const id = playbackDetailsId(media);
  const artwork = mediaArtwork(media.details || {});
  return mergePlaybackDetails({ id, type: media.type, name: media.showName || media.name,
    ...artwork, background: media.backdropUrl || artwork.background }, media.details);
}

/** Empty/partial responses must not erase fields already obtained for this title. */
export function mergePlaybackDetails(previous: MediaItem, incoming?: MediaItem | null): MediaItem {
  const fields = Object.fromEntries(Object.entries(incoming || {}).filter(([, value]) =>
    value !== undefined && value !== null && (typeof value !== "string" || value.trim() !== "") && (!Array.isArray(value) || value.length > 0)));
  const result = { ...previous, ...fields } as MediaItem;
  result.year = [Number(result.year), Number(/\b(18\d{2}|19\d{2}|20\d{2})\b/.exec(result.releaseInfo || "")?.[1]), Number(previous.year)]
    .find(year => Number.isInteger(year) && year >= 1888);
  return result;
}

/** Player reads do not need entire episode lists, trailers or provider payloads. */
export function projectPlaybackDetails(item: MediaItem, season?: number, episode?: number): MediaItem {
  const selected = season !== undefined && episode !== undefined
    ? item.videos?.find(video => video.season === season && video.episode === episode) : undefined;
  return mergePlaybackDetails({ id: item.id, type: item.type, name: item.name }, {
    id: item.id, type: item.type, name: item.name, description: item.description,
    imdbId: item.imdbId, tmdbId: item.tmdbId,
    year: item.year, releaseInfo: item.releaseInfo, imdbRating: item.imdbRating, communityRating: item.communityRating, ratingSource: item.ratingSource, voteCount: item.voteCount, runtime: item.runtime,
    poster: item.poster, background: item.background, logo: item.logo, cast: item.cast,
    genres: item.genres, director: item.director, writer: item.writer,
    videos: selected ? [selected] : undefined,
  });
}
