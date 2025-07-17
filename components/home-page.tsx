"use client";

import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MediaCard } from "@/components/media-card";
import { SearchComponent } from "@/components/search-component";
import { useAuthStore } from "@/lib/auth-store";
import { Play, ChevronLeft, ChevronRight } from "lucide-react";
import { AuroraBackground } from "@/components/aurora-background";
import { ContinueWatching } from "./continue-watching";

export function HomePage() {
  const { user, fetchMovies, fetchTVShows } = useAuthStore();
  const [movies, setMovies] = useState<any[]>([]);
  const [tvShows, setTVShows] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const moviesScrollRef = useRef<HTMLDivElement>(null);
  const tvShowsScrollRef = useRef<HTMLDivElement>(null);

  const scrollLeft = (ref: React.RefObject<HTMLDivElement | null>) => {
    if (ref.current) {
      ref.current.scrollBy({ left: -300, behavior: "smooth" });
    }
  };

  const scrollRight = (ref: React.RefObject<HTMLDivElement | null>) => {
    if (ref.current) {
      ref.current.scrollBy({ left: 300, behavior: "smooth" });
    }
  };

  useEffect(() => {
    const loadContent = async () => {
      setIsLoading(true);
      try {
        const [moviesData, tvShowsData] = await Promise.all([
          fetchMovies(12),
          fetchTVShows(12),
        ]);
        setMovies(moviesData);
        setTVShows(tvShowsData);
      } catch (error) {
        console.error("Failed to load content:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadContent();
  }, [fetchMovies, fetchTVShows]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center w-full">
        <div className="text-center">
          <div className="animate-spin h-12 w-12 border-4 border-muted border-t-foreground rounded-full mx-auto mb-4"></div>
          <p className="text-foreground text-lg">Loading your library...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative px-4 py-6 max-w-full overflow-hidden">
      {/* Aurora Background */}
      <AuroraBackground
        colorStops={["#AA5CC3", "#00A4DC", "#AA5CC3"]}
        amplitude={0.8}
        blend={0.4}
      />

      {/* Search Component - Moved to top */}
      <div className="relative z-[9999] mb-8">
        <div className="max-w-2xl mb-6">
          <SearchComponent />
        </div>
      </div>

      <div className="relative z-10 mb-8">
        <h2 className="text-3xl font-semibold text-foreground mb-2 font-poppins">
          Welcome back, {user?.Name}
        </h2>
        <p className="text-muted-foreground mb-6">
          Continue watching or discover something new
        </p>
      </div>

      {/* Continue Watching Section */}
      <section className="relative z-10 mb-12">
        <ContinueWatching />
      </section>

      {/* Movies Section */}
      <section className="relative z-10 mb-12">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-2xl font-semibold text-foreground font-poppins">
            Movies
          </h3>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="bg-background/10 border-border text-foreground hover:bg-accent p-2"
              onClick={() => scrollLeft(moviesScrollRef)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-background/10 border-border text-foreground hover:bg-accent p-2"
              onClick={() => scrollRight(moviesScrollRef)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-background/10 border-border text-foreground hover:bg-accent"
            >
              View All
            </Button>
          </div>
        </div>
        {movies.length > 0 ? (
          <div className="overflow-x-auto pb-4" ref={moviesScrollRef}>
            <div className="flex gap-4 w-max">
              {movies.map((movie) => (
                <div key={movie.Id} className="flex-shrink-0">
                  <MediaCard item={movie} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Card className="bg-card border-border text-foreground">
            <CardContent className="p-8 text-center">
              <Play className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No movies found in your library</p>
            </CardContent>
          </Card>
        )}
      </section>

      {/* TV Shows Section */}
      <section className="relative z-10 mb-12">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-2xl font-semibold text-foreground font-poppins">
            TV Shows
          </h3>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="bg-background/10 border-border text-foreground hover:bg-accent p-2"
              onClick={() => scrollLeft(tvShowsScrollRef)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-background/10 border-border text-foreground hover:bg-accent p-2"
              onClick={() => scrollRight(tvShowsScrollRef)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-background/10 border-border text-foreground hover:bg-accent"
            >
              View All
            </Button>
          </div>
        </div>
        {tvShows.length > 0 ? (
          <div className="overflow-x-auto pb-4" ref={tvShowsScrollRef}>
            <div className="flex gap-4 w-max">
              {tvShows.map((show) => (
                <div key={show.Id} className="flex-shrink-0">
                  <MediaCard item={show} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Card className="bg-card border-border text-foreground">
            <CardContent className="p-8 text-center">
              <Play className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No TV shows found in your library</p>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Library Stats */}
      <section className="relative z-10">
        <h3 className="text-2xl font-semibold text-foreground mb-6 font-poppins">
          Library Overview
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="bg-card border-border text-foreground">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Movies</CardTitle>
              <Play className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{movies.length}</div>
              <p className="text-xs text-muted-foreground">Available to watch</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border text-foreground">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">TV Shows</CardTitle>
              <Play className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{tvShows.length}</div>
              <p className="text-xs text-muted-foreground">Series to explore</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border text-foreground">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Server</CardTitle>
              <div className="h-4 w-4 bg-green-500 rounded-full"></div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">Online</div>
              <p className="text-xs text-muted-foreground">Connection healthy</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border text-foreground">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Items</CardTitle>
              <Play className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {movies.length + tvShows.length}
              </div>
              <p className="text-xs text-muted-foreground">Media items</p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
