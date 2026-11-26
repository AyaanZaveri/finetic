import { MetadataHydration } from "@/components/metadata-hydration";
import { EpisodeDetailsView } from "@/components/media-page/episode-details-view";
import { EpisodeDetailsBoundary } from "@/components/media-page/episode-details-boundary";
import { EpisodeDetailsSample } from "@/components/media-page/episode-details-sample";
import { redirect } from "next/navigation";
import { buildSeriesPath } from "@/lib/series-route";
import { getSeriesEpisodeSelectionData } from "../../_shared/series-data";
import { EpisodeDescription } from "@/components/episode-description";
import { EpisodeHeroThumbnail } from "@/components/episode-hero-thumbnail";
import { MediaPlayButton } from "@/components/media-page/play-button";

type EpisodePageProps = {
  params: Promise<{ id: string; season: string; episode: string }>;
};

async function LoadedEpisodeDetails({ params }: EpisodePageProps) {
  const { id, season, episode } = await params;

  let episodeData;
  try {
    episodeData = await getSeriesEpisodeSelectionData(
      id,
      season,
      episode,
    );
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("Authentication expired")) {
      redirect("/login");
    }
    console.error("Error loading episode on series page:", error);
    return <div className="p-4">Couldn’t load this episode. Reload to try again.</div>;
  }

  if (!episodeData) {
    return <div className="p-4">Episode not found</div>;
  }

  const {
    show,
    seasonNumber,
    episodeNumber,
    selectedEpisode,
    episodeRecord,
    selectedEpisodeTitle,
  } = episodeData;

  return (
    <MetadataHydration media={show} episode={episodeRecord || undefined}><EpisodeDetailsView
      titleId="episode-title"
      showHref={buildSeriesPath(id)}
      showName={show.name}
      title={selectedEpisodeTitle}
      seasonNumber={seasonNumber}
      episodeNumber={episodeNumber}
      released={selectedEpisode.released}
      ratingMedia={show}
      thumbnail={<EpisodeHeroThumbnail
        thumbnail={selectedEpisode.thumbnail}
        released={selectedEpisode.released}
        title={selectedEpisodeTitle}
      />}
      actions={<MediaPlayButton
        titleIds={{ imdbId: show.imdbId, tmdbId: show.tmdbId }}
        media={{
          id: show.id,
          name: selectedEpisodeTitle,
          type: "series",
          mediaSourceId: selectedEpisode.id,
          seriesId: show.id,
          showName: show.name,
          episodeTitle: selectedEpisodeTitle,
          seasonNumber,
          episodeNumber,
          resumePositionTicks: selectedEpisode.resumePositionTicks,
          backdropUrl: show.background || selectedEpisode.thumbnail || show.poster,
        }}
      />}
      description={selectedEpisode.overview
        ? <EpisodeDescription key={selectedEpisode.id} text={selectedEpisode.overview} />
        : undefined}
    /></MetadataHydration>
  );
}

// Keep the boundary outside the async read so Skullet can stream its fallback.
export default function EpisodeOnSeriesPage(props: EpisodePageProps) {
  return (
    <EpisodeDetailsBoundary sample={<EpisodeDetailsSample />}>
      <LoadedEpisodeDetails {...props} />
    </EpisodeDetailsBoundary>
  );
}
