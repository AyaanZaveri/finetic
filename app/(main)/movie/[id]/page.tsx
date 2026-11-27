import { MetadataPage as PlaybackPageProvider } from "@/components/metadata-hydration";
import { CastSection } from "@/components/media-page/cast-section";
import { fetchMediaDetails, fetchSimilarItems } from "@/app/actions";
import { MovieDetailsView, MovieDetailsMessage, SimilarMoviesSection, SimilarMoviesSkeleton } from "@/components/media-page/movie-details-view";
import { redirect } from "next/navigation";
import { MovieCollectionSection } from "@/components/media-page/movie-collection-section";
import { ProductionCompanies } from "@/components/media-page/production-companies";
import { getTMDBMovieCollection } from "@/lib/tmdb-discovery";
import { Suspense } from "react";

async function SimilarMovies({ movieId }: { movieId: string }) {
  const items = await fetchSimilarItems(movieId, "movie", 12);
  return <SimilarMoviesSection items={items || []} />;
}

async function MovieCollection({ movieId }: { movieId: string }) {
  return <MovieCollectionSection collection={await getTMDBMovieCollection(movieId)} />;
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
          companies={<Suspense fallback={null}><ProductionCompanies id={movie.tmdbId ? `tmdb:${movie.tmdbId}` : movie.id} type="movie" /></Suspense>}
          collection={<Suspense fallback={null}><MovieCollection movieId={movie.tmdbId ? `tmdb:${movie.tmdbId}` : movie.id} /></Suspense>}
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
