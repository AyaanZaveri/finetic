"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  Film,
  Tv,
  Calendar,
  PlayCircle,
  Star,
  Menu,
  User,
  Home,
  Library,
  Sun,
  Moon,
  Monitor,
  LogOut,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  searchItems,
  getImageUrl,
  getUser,
  logout,
  getServerUrl,
} from "@/app/actions";
import { Badge } from "./ui/badge";
import { SearchSuggestionItem } from "./SearchSuggestionItem";
import { TextShimmerWave } from "./ui/text-shimmer-wave";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useMediaPlayer } from "@/contexts/MediaPlayerContext";
import * as Kbd from "@/components/ui/kbd";
import { TextShimmer } from "./motion-primitives/text-shimmer";
import { useAuth } from "@/hooks/useAuth";

interface SearchBarProps {
  className?: string;
}

export function SearchBar({ className = "" }: SearchBarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [libraries, setLibraries] = useState<any[]>([]);
  const router = useRouter();
  const { setTheme } = useTheme();
  const { isPlayerVisible } = useMediaPlayer();
  // Server actions are imported directly
  const searchTimeout = useRef<NodeJS.Timeout | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { serverUrl } = useAuth();

  // Memoized loading component to prevent re-rendering while typing
  const loadingComponent = useMemo(
    () => (
      <div className="flex justify-center items-center p-8">
        <TextShimmer className="text-sm font-mono">
          {`Searching ${serverUrl && new URL(serverUrl).hostname}...`}
        </TextShimmer>
      </div>
    ),
    [serverUrl]
  );

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
          // Sort to prioritize Movies and Series over Episodes and People
          const sortedResults = results.sort((a, b) => {
            const typePriority = { Movie: 1, Series: 2, Person: 3, Episode: 4 };
            const aPriority =
              typePriority[a.Type as keyof typeof typePriority] || 5;
            const bPriority =
              typePriority[b.Type as keyof typeof typePriority] || 5;
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

  // Load user data and libraries for mobile nav
  useEffect(() => {
    const loadUserData = async () => {
      try {
        const userData = await getUser();
        setUser(userData);

        // Fetch libraries if we have both user and server URL
        const serverUrlData = await getServerUrl();
        if (userData && serverUrlData) {
          const response = await fetch(
            `${serverUrlData}/Library/VirtualFolders`,
            {
              headers: {
                "X-Emby-Authorization": `MediaBrowser Client="Jellyfin Web Client", Device="Browser", DeviceId="web-client", Version="1.0.0", Token="${userData.AccessToken}"`,
              },
            }
          );

          if (response.ok) {
            const data = await response.json();
            // Only show movie and TV show libraries
            const supportedLibraries = (data || []).filter((library: any) => {
              const type = library.CollectionType?.toLowerCase();
              return type === "movies" || type === "tvshows";
            });
            setLibraries(supportedLibraries);
          }
        }
      } catch (error) {
        console.error("Failed to load user data:", error);
      }
    };

    loadUserData();
  }, []);

  // Global keyboard shortcut for search activation
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      // Only activate on slash key if no input is focused and no modifiers are pressed
      if (
        event.key === "/" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA" &&
        !document.activeElement?.hasAttribute("contenteditable")
      ) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      document.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, []);

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
      // Assuming a series page exists at /series/[id]
      router.push(`/series/${item.Id}`);
    } else if (item.Type === "Person") {
      router.push(`/person/${item.Id}`);
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

  const handleLogout = async () => {
    await logout();
    // logout() already handles the redirect
  };

  const getLibraryIcon = (collectionType: string) => {
    switch (collectionType?.toLowerCase()) {
      case "movies":
        return <Film className="h-4 w-4" />;
      case "tvshows":
        return <Tv className="h-4 w-4" />;
      default:
        return <Film className="h-4 w-4" />;
    }
  };

  // Hide the search bar when media player is visible
  if (isPlayerVisible) {
    return null;
  }

  return (
    <div
      className={`relative z-[9999] max-w-xl ${className}`}
      ref={suggestionsRef}
    >
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
          <Input
            ref={inputRef}
            type="text"
            placeholder="Search movies, TV shows, episodes, and people..."
            value={searchQuery}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onFocus={() => {
              if (searchQuery.trim().length > 2 && suggestions.length > 0) {
                setShowSuggestions(true);
              }
            }}
            className="pl-10 pr-16 border-border text-foreground placeholder:text-muted-foreground h-11 rounded-xl backdrop-blur-md dark:bg-background/70! bg-background/90"
          />
          <div className="absolute right-4 top-1/2 transform -translate-y-1/2 z-10">
            <Kbd.Root variant="outline" size="lg">
              <Kbd.Key>/</Kbd.Key>
            </Kbd.Root>
          </div>
        </div>

        {/* Mobile Navigation Buttons - Only visible on mobile */}
        <div className="flex gap-2 md:hidden">
          {/* Hamburger Menu - Navigation */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="bg-background/80 border-border text-foreground hover:bg-accent rounded-full h-11 w-11 p-0 backdrop-blur-sm"
              >
                <Menu className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-lg">
              <DropdownMenuItem asChild>
                <Link href="/" className="gap-2">
                  <Home className="h-4 w-4" />
                  <span>Home</span>
                </Link>
              </DropdownMenuItem>
              {libraries.length > 0 && (
                <div key="libraries-section">
                  <DropdownMenuSeparator />
                  {libraries.map((library) => (
                    <DropdownMenuItem key={library.Id} asChild>
                      <Link href={`/library/${library.Id}`} className="gap-2">
                        {getLibraryIcon(library.CollectionType)}
                        <span>{library.Name}</span>
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Profile Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="bg-background/80 border-border text-foreground hover:bg-accent rounded-full h-11 w-11 p-0 backdrop-blur-sm"
              >
                <User className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-lg">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2">
                  <Monitor className="h-4 w-4" />
                  <span>Theme</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => setTheme("light")}>
                    <Sun className="h-4 w-4" />
                    <span>Light</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme("dark")}>
                    <Moon className="h-4 w-4" />
                    <span>Dark</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme("system")}>
                    <Monitor className="h-4 w-4" />
                    <span>System</span>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="gap-2">
                <LogOut className="h-4 w-4 text-red-600 dark:text-red-500" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </form>

      {/* Search Suggestions Dropdown */}
      {(showSuggestions || isLoading) && (
        <div className="absolute top-full left-0 right-0 mt-2 dark:bg-background/70! bg-background/90 backdrop-blur-md rounded-xl border shadow-xl shadow-accent/30 z-[9999] max-h-96 overflow-y-auto">
          {isLoading && loadingComponent}

          {!isLoading && suggestions.length > 0 && (
            <div className="p-2">
              <div className="text-sm text-muted-foreground px-2 py-1 mb-2">
                Search Results
              </div>
              {suggestions.map((item) => (
                <SearchSuggestionItem
                  key={item.Id}
                  item={item}
                  onClick={() => handleSuggestionClick(item)}
                  formatRuntime={formatRuntime}
                />
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
