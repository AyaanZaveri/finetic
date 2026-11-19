import { MetadataPage as PlaybackPageProvider } from "@/components/metadata-hydration";
import backdropStyles from "@/components/media-page/backdrop-transition.module.css";
import { BackdropTransition } from "@/components/media-page/backdrop-transition";
import { CastSection } from "@/components/media-page/cast-section";
import { MediaSection } from "@/components/media-section";
import { VibrantAuroraBackground } from "@/components/vibrant-aurora-background";
import { HeroWordmark } from "@/components/hero-wordmark";
import { IntentLink } from "@/components/intent-link";
import { redirect } from "next/navigation";
import { BackdropImage } from "@/components/media-page/backdrop-image";
import { SeriesEpisodesRouteAware } from "@/components/series-episodes-route-aware";
import { SeriesOverviewPlaybackProvider } from "@/components/series-overview-playback";
import { EpisodeStreamsRouteAware } from "@/components/episode-streams-route-aware";
import {
  buildEpisodePath,
  buildSeriesPath,
  parseSeriesRouteId,
} from "@/lib/series-route";
import { getSeriesLayoutData } from "./_shared/series-data";
import { Suspense } from "react";
import { fetchSimilarItems } from "@/app/actions";

async function SimilarShows({ showId }: { showId: string }) {
  const items = await fetchSimilarItems(showId, "series", 12);
  if (!items.length) return null;

  return (
    <div className="mt-6 px-4 md:px-10">
      <MediaSection sectionName="More Like This" mediaItems={items} />
    </div>
  );
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
      <div className={`${backdropStyles.page} relative min-h-screen overflow-hidden pb-8`}>
        <VibrantAuroraBackground
          backdropUrl={show.background}
          posterUrl={show.poster}
          opacity={0.2}
        />

        <div className="relative">
          <div className={`${backdropStyles.hero} relative overflow-hidden`}>
            <BackdropImage
              movie={show}
              backdropImage={show.background || ""}
              className={`${backdropStyles.artwork} w-full h-full object-cover`}
              width={1920}
              height={1080}
            />
            {show.logo && (
              <div className={backdropStyles.wordmarkRegion}>
                <IntentLink
                  href={buildSeriesPath(show.id)}
                  draggable={false}
                  aria-label={`Go to ${show.name} series page`}
                  className="pointer-events-auto block w-[min(15rem,65%)] [--hero-wordmark-height:4rem] md:w-[min(48rem,75%)] md:[--hero-wordmark-height:7rem] motion-safe:transition-[transform] motion-safe:duration-150 motion-safe:ease-[var(--ease-out)] motion-safe:[transform:translateZ(0)_scale(1)] [@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:hover:[transform:translateZ(0)_scale(1.01)]"
                >
                  <HeroWordmark
                    src={show.logo}
                    alt={`${show.name} logo`}
                    movieName={show.name || ""}
                    className="w-full"
                  />
                </IntentLink>
              </div>
            )}
            <BackdropTransition />
          </div>
        </div>

        <div className={`${backdropStyles.content} relative z-10 px-4 md:px-6 md:mx-4 pb-6`}>
          <div
            id="stream-loading-pill-anchor"
            className="absolute top-4 right-4 z-30 pointer-events-none"
          />
          <SeriesOverviewPlaybackProvider show={show}>
            {children}

            <div className="mt-10 md:mt-8">
              <SeriesEpisodesRouteAware
                showId={show.id}
                prefetchedVideos={show.videos}
                prefetchedSeasons={show.seasons}
              />
            </div>
          </SeriesOverviewPlaybackProvider>

          <EpisodeStreamsRouteAware
            show={show}
            prefetchedVideos={show.videos}
          />
        </div>

        <Suspense fallback={null}>
          <CastSection id={show.id} type="series" names={show.cast} />
        </Suspense>

        <Suspense fallback={null}>
          <SimilarShows showId={show.id} />
        </Suspense>
      </div>
      </PlaybackPageProvider>
    );
  } catch (error: any) {
    if (error.message?.includes("Authentication expired")) {
      redirect("/login");
    }
    console.error("Error loading show layout:", error);
    return <div className="p-4">Error loading show. Please try again.</div>;
  }
}
