import { SeriesDetailsFrame } from "@/components/media-page/series-details-frame";
import { MetadataPage as PlaybackPageProvider } from "@/components/metadata-hydration";
import { CastSection } from "@/components/media-page/cast-section";
import { SimilarMoviesSection } from "@/components/media-page/movie-details-view";
import { redirect } from "next/navigation";
import { SeriesEpisodesRouteAware } from "@/components/series-episodes-route-aware";
import { SeriesOverviewPlaybackProvider } from "@/components/series-overview-playback";
import { EpisodeStreamsRouteAware } from "@/components/episode-streams-route-aware";
import {
  buildEpisodePath,
  parseSeriesRouteId,
} from "@/lib/series-route";
import { getSeriesLayoutData } from "./_shared/series-data";
import { Suspense } from "react";
import { fetchSimilarItems } from "@/app/actions";

async function SimilarShows({ showId }: { showId: string }) {
  const items = await fetchSimilarItems(showId, "series", 12);
  return <SimilarMoviesSection items={items} />;
}

export default async function SeriesLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const parsed = parseSeriesRouteId(id);

  if (parsed.isEpisodeTarget && parsed.season && parsed.episode) {
    redirect(buildEpisodePath(parsed.seriesId, parsed.season, parsed.episode));
  }

  try {
    const layoutData = await getSeriesLayoutData(id);

    if (!layoutData) {
      return <div className="p-4">Show not found</div>;
    }

    const { show } = layoutData;

    return (
      <PlaybackPageProvider media={show}>
      <SeriesDetailsFrame show={show}
        cast={<Suspense fallback={null}><CastSection id={show.id} type="series" names={show.cast} /></Suspense>}
        recommendations={<Suspense fallback={null}><SimilarShows showId={show.id} /></Suspense>}>
        <SeriesOverviewPlaybackProvider show={show}>
          {children}
          <div className="mt-8">
            <SeriesEpisodesRouteAware
              showId={show.id}
              prefetchedVideos={show.videos}
              prefetchedSeasons={show.seasons}
            />
          </div>
        </SeriesOverviewPlaybackProvider>
        <EpisodeStreamsRouteAware show={show} prefetchedVideos={show.videos} />
      </SeriesDetailsFrame>
      </PlaybackPageProvider>
    );
  } catch (error: any) {
    if (error.message?.includes("Authentication expired")) {
      redirect("/login");
    }
    console.error("Error loading show layout:", error);
    return <div className="p-4">Couldn’t load this show. Reload to try again.</div>;
  }
}
