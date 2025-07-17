"use client";

import React, { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Film, Tv, Calendar, PlayCircle, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";
import { Badge } from "./ui/badge";

interface SearchComponentProps {
  className?: string;
}

export function SearchComponent({ className = "" }: SearchComponentProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const router = useRouter();
  const { searchItems, getImageUrl } = useAuthStore();
  const searchTimeout = useRef<NodeJS.Timeout | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
    }

    if (searchQuery.trim().length > 2) {
      setIsLoading(true);
      searchTimeout.current = setTimeout(async () => {
        try {
          const results = await searchItems(searchQuery.trim());
          // Sort to prioritize Movies and Series over Episodes
          const sortedResults = results.sort((a, b) => {
            const typePriority = { Movie: 1, Series: 2, Episode: 3 };
            const aPriority =
              typePriority[a.Type as keyof typeof typePriority] || 4;
            const bPriority =
              typePriority[b.Type as keyof typeof typePriority] || 4;
            return aPriority - bPriority;
          });
          setSuggestions(sortedResults.slice(0, 6)); // Limit to 6 suggestions
          setShowSuggestions(true);
        } catch (error) {
          console.error("Search failed:", error);
          setSuggestions([]);
        } finally {
          setIsLoading(false);
        }
      }, 300);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
      setIsLoading(false);
    }

    return () => {
      if (searchTimeout.current) {
        clearTimeout(searchTimeout.current);
      }
    };
  }, [searchQuery, searchItems]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setShowSuggestions(false);
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch(e);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const handleSuggestionClick = (item: any) => {
    setShowSuggestions(false);
    if (item.Type === "Movie") {
      router.push(`/movie/${item.Id}`);
    } else if (item.Type === "Series") {
      router.push(`/tv/${item.Id}`);
    } else if (item.Type === "Episode") {
      // For episodes, navigate to the search page for now as SeriesId is not directly available
      router.push(`/search?q=${encodeURIComponent(item.Name)}`);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    if (e.target.value.trim().length > 2) {
      setShowSuggestions(true);
    }
  };

  const formatRuntime = (runTimeTicks?: number) => {
    if (!runTimeTicks) return null;
    const totalMinutes = Math.round(runTimeTicks / 600000000); // Convert from ticks to minutes
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  return (
    <div className={`relative z-[9999] ${className}`} ref={suggestionsRef}>
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search movies, TV shows, and episodes..."
            value={searchQuery}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onFocus={() => {
              if (searchQuery.trim().length > 2 && suggestions.length > 0) {
                setShowSuggestions(true);
              }
            }}
            className="pl-9 bg-background/10 border-border text-foreground placeholder:text-muted-foreground focus:border-ring"
          />
        </div>
        <Button
          type="submit"
          size="sm"
          variant={"outline"}
          className="px-4 h-9"
          disabled={!searchQuery.trim()}
        >
          Search
        </Button>
      </form>

      {/* Search Suggestions Dropdown */}
      {(showSuggestions || isLoading) && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-background/90 backdrop-blur-md border border-border rounded-lg shadow-xl z-[9999] max-h-96 overflow-y-auto">
          {isLoading && (
            <div className="p-4">
              <div className="text-sm text-muted-foreground mb-3">
                Searching...
              </div>
              {/* Skeleton loading states */}
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-3 border-b border-border last:border-b-0"
                >
                  <Skeleton className="w-12 h-16 bg-muted rounded" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-3/4 bg-muted mb-2" />
                    <Skeleton className="h-3 w-1/2 bg-muted mb-1" />
                    <Skeleton className="h-3 w-1/4 bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isLoading && suggestions.length > 0 && (
            <div className="p-2">
              <div className="text-sm text-muted-foreground px-2 py-1 mb-2">
                Search Results
              </div>
              {suggestions.map((item) => (
                <div
                  key={item.Id}
                  onClick={() => handleSuggestionClick(item)}
                  className="flex items-center gap-3 p-3 hover:bg-accent rounded-lg cursor-pointer transition-colors"
                >
                  {/* Poster Image */}
                  <div
                    className={`aspect-[2/3] h-16 bg-muted rounded overflow-hidden flex-shrink-0`}
                  >
                    {item.ImageTags?.Primary ? (
                      <img
                        src={getImageUrl(
                          item.Id,
                          "Primary",
                          item.ImageTags.Primary
                        )}
                        alt={item.Name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        {item.Type === "Movie" ? (
                          <Film className="h-6 w-6 text-muted-foreground" />
                        ) : item.Type === "Episode" ? (
                          <PlayCircle className="h-6 w-6 text-muted-foreground" />
                        ) : (
                          <Tv className="h-6 w-6 text-muted-foreground" />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Content Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-foreground font-medium truncate">
                        {item.Name}
                      </h4>
                      {item.Type === "Movie" ? (
                        <Badge className="text-white bg-blue-600">
                          <Film className="h-3 w-3 mr-0.5" />
                          Movie
                        </Badge>
                      ) : item.Type === "Series" ? (
                        <Badge className="text-white bg-emerald-600">
                          <Tv className="h-3 w-3 mr-0.5" />
                          Series
                        </Badge>
                      ) : item.Type === "Episode" ? (
                        <Badge className="text-white bg-amber-600">
                          <PlayCircle className="h-3 w-3 mr-0.5" />
                          Episode
                        </Badge>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {item.ProductionYear && (
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {item.ProductionYear}
                        </div>
                      )}

                      {item.RunTimeTicks &&
                        formatRuntime(item.RunTimeTicks) && (
                          <div className="flex items-center gap-1">
                            <PlayCircle className="h-3 w-3" />
                            {formatRuntime(item.RunTimeTicks)}
                          </div>
                        )}

                      {item.CommunityRating && (
                        <div className="flex items-center gap-1">
                          <Star className="h-3 w-3" />{" "}
                          {item.CommunityRating.toFixed(1)}
                        </div>
                      )}

                      {/* Show episode/season/show info for episodes */}
                      {item.Type === "Episode" && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {typeof item.ParentIndexNumber === "number" &&
                            typeof item.IndexNumber === "number" && (
                              <span>
                                S{item.ParentIndexNumber}E{item.IndexNumber}
                              </span>
                            )}
                          {/* Show name of parent show if available */}
                          {item.SeriesName && (
                            <span className="truncate max-w-[120px]">
                              {item.SeriesName}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {item.Overview && (
                      <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-2 truncate">
                        {item.Overview.substring(0, 80)}
                        {item.Overview.length > 80 ? "..." : ""}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isLoading &&
            suggestions.length === 0 &&
            searchQuery.trim().length > 2 && (
              <div className="p-4 text-center text-muted-foreground">
                <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No results found for &ldquo;{searchQuery}&rdquo;</p>
              </div>
            )}
        </div>
      )}
    </div>
  );
}
