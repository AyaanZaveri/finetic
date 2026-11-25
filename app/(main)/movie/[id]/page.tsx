import { MetadataPage as PlaybackPageProvider } from "@/components/metadata-hydration";
import backdropStyles from "@/components/media-page/backdrop-transition.module.css";
import { BackdropTransition } from "@/components/media-page/backdrop-transition";
import { CastSection } from "@/components/media-page/cast-section";
import { fetchMediaDetails, fetchSimilarItems } from "@/app/actions";
import { MediaActions } from "@/components/media-actions";
import { Badge } from "@/components/ui/badge";
import { MediaSection } from "@/components/media-section";
import { Skeleton } from "@/components/ui/skeleton";
import { VibrantAuroraBackground } from "@/components/vibrant-aurora-background";
import { HeroWordmark } from "@/components/hero-wordmark";
import { MediaRatingBadge } from "@/components/media-page/media-rating-badge";
import { redirect } from "next/navigation";
import { BackdropImage } from "@/components/media-page/backdrop-image";
import { PosterImage } from "@/components/media-page/poster-image";
import { MediaPlayButton } from "@/components/media-page/play-button";
import { formatRuntime } from "@/lib/format-runtime";
import type { MediaItem } from "@/types/stremio";
import { Suspense } from "react";

function SimilarMoviesSkeleton() {
  return (
    <div className="mt-6 px-4 md:px-10">
      <div className="mb-6 flex items-center justify-between">
        <Skeleton className="h-8 w-40 rounded" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-9 rounded-md" />
          <Skeleton className="h-9 w-9 rounded-md" />
          <Skeleton className="h-9 w-20 rounded-md" />
        </div>
      </div>
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={`similar-movie-skeleton-${index}`}
            className="w-36 flex-shrink-0"
          >
            <Skeleton className="aspect-[2/3] w-full rounded-md" />
            <Skeleton className="mt-3 h-4 w-11/12 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

async function SimilarMovies({ movieId }: { movieId: string }) {
  const similarItems = await fetchSimilarItems(movieId, "movie", 12);

  if (!similarItems || similarItems.length === 0) return null;

  return (
    <div className="mt-6 px-4 md:px-10">
      <MediaSection sectionName="More like this" mediaItems={similarItems} />
    </div>
  );
}

export default async function Movie({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  try {
    const movie = await fetchMediaDetails(id, "movie");

    if (!movie) {
      return <div className="p-4">Movie not found</div>;
    }

    const movieWithProgress: MediaItem = {
      ...movie,
    };

    return (
      <PlaybackPageProvider media={movie}>
      <div className={`${backdropStyles.page} relative min-h-screen overflow-hidden pb-8`}>
        <VibrantAuroraBackground
          backdropUrl={movie.background}
          posterUrl={movie.poster}
          opacity={0.2}
        />

        {/* Backdrop section */}
        <div className="relative">
          <div className={`${backdropStyles.hero} relative overflow-hidden`}>
            <BackdropImage
              movie={movie}
              backdropImage={movie.background || ""}
              className={`${backdropStyles.artwork} w-full h-full object-cover`}
              width={1920}
              height={1080}
            />
            {movie.logo && (
              <div className={backdropStyles.wordmarkRegion}>
                <HeroWordmark
                  src={movie.logo}
                  alt={`${movie.name} logo`}
                  movieName={movie.name || ""}
                  className="w-[min(15rem,65%)] [--hero-wordmark-height:4rem] md:w-[min(48rem,75%)] md:[--hero-wordmark-height:7rem]"
                />
              </div>
            )}
            <BackdropTransition />
          </div>
        </div>

        {/* Content section */}
        <div className={`${backdropStyles.content} relative z-10 px-4 md:px-6 md:mx-4 pb-6`}>
          <div
            id="stream-loading-pill-anchor"
            className="absolute top-4 right-4 z-30 pointer-events-none"
          />
          <section aria-labelledby="movie-title" className="@container">
            <div className="grid min-w-0 gap-6 @3xl:grid-cols-[14rem_minmax(0,1fr)] @3xl:items-center @3xl:gap-8">
              <div className="relative mx-auto w-[clamp(12rem,56vw,15rem)] max-w-full @3xl:mx-0 @3xl:w-full">
                <PosterImage
                  movie={movie}
                  posterImage={movie.poster || ""}
                  className="w-full h-auto rounded-lg"
                  width={500}
                  height={750}
                />
              </div>

              <div className="flex min-w-0 flex-col gap-6 text-start">
                <div className="flex min-w-0 flex-col items-center gap-3 text-center @3xl:items-start @3xl:text-start">
                  <h1
                    id="movie-title"
                    className="min-w-0 break-words text-3xl font-semibold leading-tight text-foreground text-balance @lg:text-4xl @5xl:text-5xl"
                  >
                    {movie.name || ""}
                  </h1>
                  <div className="flex flex-wrap items-center justify-center gap-2 @3xl:justify-start">
                    {movie.year && (
                      <Badge
                        variant="secondary"
                      >
                        {movie.year}
                      </Badge>
                    )}
                    {movie.runtime && (
                      <Badge
                        variant="secondary"
                      >
                        {formatRuntime(movie.runtime)}
                      </Badge>
                    )}
                    <MediaRatingBadge media={movie} />
                  </div>
                  <MediaPlayButton
                    media={{
                      id: movie.id,
                      name: movie.name,
                      type: "movie",
                      resumePositionTicks: movie.resumePositionTicks,
                      backdropUrl: movie.background || movie.poster,
                    }}
                  />
                </div>

                {movie.description && (
                  <p className="max-w-prose whitespace-pre-line break-words text-base leading-relaxed">
                    {movie.description}
                  </p>
                )}

                <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-3 gap-y-3 text-sm">
                  {movie.genres && movie.genres.length > 0 && (
                    <>
                      <dt className="font-medium text-muted-foreground">Genres</dt>
                      <dd className="flex min-w-0 flex-wrap gap-1.5">
                        {movie.genres.map((genre) => (
                          <Badge
                            key={genre}
                            variant="secondary"
                            className="text-xs"
                          >
                            {genre}
                          </Badge>
                        ))}
                      </dd>
                    </>
                  )}
                  {movie.director && movie.director.length > 0 && (
                    <>
                      <dt className="font-medium text-muted-foreground">Director</dt>
                      <dd className="min-w-0 break-words font-normal">
                        {movie.director.join(", ")}
                      </dd>
                    </>
                  )}
                  {movie.writer && movie.writer.length > 0 && (
                    <>
                      <dt className="font-medium text-muted-foreground">Writers</dt>
                      <dd className="min-w-0 break-words font-normal">
                        {movie.writer.join(", ")}
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            </div>
          </section>

          <div className="mt-8 w-full">
            <MediaActions movie={movieWithProgress} />
          </div>
        </div>

        <Suspense fallback={null}>
          <CastSection id={movie.id} type="movie" names={movie.cast} />
        </Suspense>

        <Suspense fallback={<SimilarMoviesSkeleton />}>
          <SimilarMovies movieId={movie.id} />
        </Suspense>
      </div>
      </PlaybackPageProvider>
    );
  } catch (error: any) {
    if (error.message?.includes("Authentication expired")) {
      redirect("/login");
    }
    console.error("Error loading movie:", error);
    return <div className="p-4">Couldn’t load this movie. Reload to try again.</div>;
  }
}
