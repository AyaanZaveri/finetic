import { MetadataPage as PlaybackPageProvider } from "@/components/metadata-hydration";
import { CastSection } from "@/components/media-page/cast-section";
import { fetchMediaDetails, fetchSimilarItems } from "@/app/actions";
import { MovieDetailsView, MovieDetailsMessage, SimilarMoviesSection, SimilarMoviesSkeleton } from "@/components/media-page/movie-details-view";
import { redirect } from "next/navigation";
import { Suspense } from "react";

async function SimilarMovies({ movieId }: { movieId: string }) {
  const items = await fetchSimilarItems(movieId, "movie", 12);
  return <SimilarMoviesSection items={items || []} />;
}

export default async function Movie({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const movie = await fetchMediaDetails(id, "movie");
    if (!movie) return <MovieDetailsMessage kind="not-found" />;
    return (
      <PlaybackPageProvider media={movie}>
        <MovieDetailsView movie={movie}
          cast={<Suspense fallback={null}><CastSection id={movie.id} type="movie" names={movie.cast} /></Suspense>}
          recommendations={<Suspense fallback={<SimilarMoviesSkeleton />}><SimilarMovies movieId={movie.id} /></Suspense>}
        />
      </PlaybackPageProvider>
    );
  } catch (error: any) {
    if (error.message?.includes("Authentication expired")) redirect("/login");
    console.error("Error loading movie:", error);
    return <MovieDetailsMessage kind="error" />;
  }
}
