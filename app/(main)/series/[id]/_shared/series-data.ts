import { cachedHeaderEpisode } from "@/lib/server/metadata-readers";
import { cache } from "react";
import { fetchMediaDetails } from "@/app/actions";
import { fetchEpisodeDetails, type Episode } from "@/app/actions/tv-shows";
import type { MediaItem, StremioVideo } from "@/types/stremio";
import { parseSeriesRouteId } from "@/lib/series-route";

export interface SeriesLayoutData {
  show: MediaItem;
  regularSeasonCount: number;
}

export interface SeriesEpisodeSelectionData {
  show: MediaItem;
  regularSeasonCount: number;
  seasonNumber: number;
  episodeNumber: number;
  selectedEpisode: StremioVideo;
  episodeRecord: Episode | null;
  selectedEpisodeTitle: string;
  episodeMedia: MediaItem;
}

export const getSeriesLayoutData = cache(
  async (id: string): Promise<SeriesLayoutData | null> => {
    // Recommendations belong to the layout's streamed section, not the
    // critical path shared by the overview and every episode selection.
    const show = await fetchMediaDetails(id, "series");

    if (!show) {
      return null;
    }

    const seasonNumbers = show.seasons ? new Set(show.seasons.filter(season => season.number > 0).map(season => season.number)) : new Set(
      (show.videos ?? [])
        .map((video) => video.season)
        .filter(
          (seasonNumber): seasonNumber is number =>
            typeof seasonNumber === "number" && seasonNumber > 0
        )
    );

    return {
      show,
      regularSeasonCount: seasonNumbers.size,
    };
  }
);

export const getSeriesEpisodeSelectionData = cache(
  async (
    id: string,
    seasonParam: string,
    episodeParam: string
  ): Promise<SeriesEpisodeSelectionData | null> => {
    id = parseSeriesRouteId(id).seriesId;
    const seasonNumber = Number(seasonParam);
    const episodeNumber = Number(episodeParam);

    if (
      !Number.isFinite(seasonNumber) ||
      !Number.isFinite(episodeNumber) ||
      !Number.isInteger(seasonNumber) ||
      !Number.isInteger(episodeNumber) ||
      seasonNumber < 0 ||
      episodeNumber < 1
    ) {
      return null;
    }

    const layoutData = await getSeriesLayoutData(id);
    if (!layoutData) {
      return null;
    }

    const embedded = layoutData.show.videos?.find(video => video.season === seasonNumber && video.episode === episodeNumber);
    const episodeRecord = await cachedHeaderEpisode(layoutData.show, seasonNumber, episodeNumber)
      || (!embedded?.thumbnail ? await fetchEpisodeDetails(layoutData.show.id, seasonNumber, episodeNumber) : null);
    const videos: StremioVideo[] = episodeRecord ? [{ ...embedded, id: embedded?.id || episodeRecord.id, title: episodeRecord.title,
      season: episodeRecord.season, episode: episodeRecord.episode, overview: episodeRecord.overview,
      thumbnail: episodeRecord.thumbnail || embedded?.thumbnail, released: episodeRecord.released || embedded?.released }] : layoutData.show.videos ?? [];
    const selectedEpisode = videos.find(
      (video) =>
        video.season === seasonNumber && video.episode === episodeNumber
    );

    if (!selectedEpisode) {
      return null;
    }

    const selectedEpisodeTitle =
      selectedEpisode.title ||
      selectedEpisode.name ||
      `Episode ${episodeNumber}`;

    const episodeMedia: MediaItem = {
      ...layoutData.show,
      id: selectedEpisode.id,
      seriesId: layoutData.show.id,
      showName: layoutData.show.name,
      episodeId: selectedEpisode.id,
      episodeTitle: selectedEpisodeTitle,
      seasonNumber,
      episodeNumber,
      type: "series",
      name: selectedEpisodeTitle,
      description: selectedEpisode.overview || layoutData.show.description,
      poster: selectedEpisode.thumbnail || layoutData.show.poster,
    };

    return {
      ...layoutData,
      seasonNumber,
      episodeNumber,
      selectedEpisode,
      episodeRecord,
      selectedEpisodeTitle,
      episodeMedia,
    };
  }
);
