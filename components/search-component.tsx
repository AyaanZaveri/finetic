"use client";

import { ArtworkImage } from "@/components/artwork-image";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Film, Star, Tv, UserRound } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { groupSearchSuggestions } from "@/lib/search-suggestion-groups";
import { fetchSearchSuggestions } from "@/lib/search-catalog-stream";
import { ExpandingSearch, type ExpandingSearchItem } from "@/components/arc/expanding-search/expanding-search";
import { useIsPlayerVisible } from "@/contexts/MediaPlayerContext";
import type { SearchResult } from "@/types/stremio";
import { scheduleRoutePrefetch } from "@/lib/route-prefetch";

interface SearchBarProps {
  className?: string;
  initialQuery?: string;
}

export function SearchBar({ className = "", initialQuery = "" }: SearchBarProps) {
    const [searchQuery, setSearchQuery] = useState(initialQuery.trim());
    const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const isPlayerVisible = useIsPlayerVisible();
    const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const searchRequestIdRef = useRef(0);
    const skipNextSuggestSearchRef = useRef(false);
    const lastAppliedUrlQueryRef = useRef<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const urlQuery = (searchParams.get("q") ?? "").trim();

    const cancelPrefetch = useRef<(() => void) | null>(null);
    const handleItemIntent = useCallback((item: ExpandingSearchItem | null) => {
        cancelPrefetch.current?.();
        cancelPrefetch.current = null;
        if (!item) return;
        const target = suggestions.find(result => `${result.type}:${result.id}` === item.id);
        if (target?.type === "movie" || target?.type === "series" || target?.type === "person") {
            const href = `/${target.type}/${target.id}`;
            cancelPrefetch.current = scheduleRoutePrefetch(href, () => router.prefetch(href));
        }
    }, [suggestions, router]);
    useEffect(() => () => { cancelPrefetch.current?.(); }, []);

    useEffect(() => {
        if (pathname !== "/search") {
            lastAppliedUrlQueryRef.current = null;
            return;
        }

        const queryFromUrl = (urlQuery || initialQuery).trim();
        if (lastAppliedUrlQueryRef.current === queryFromUrl) return;
        lastAppliedUrlQueryRef.current = queryFromUrl;

        skipNextSuggestSearchRef.current = true;
        searchRequestIdRef.current += 1;
        setSearchQuery(queryFromUrl);
        setSuggestions([]);
        setIsLoading(false);
    }, [pathname, urlQuery, initialQuery]);

    // Debounced search
    useEffect(() => {
        const controller = new AbortController();
        setSearchError(null);
        if (skipNextSuggestSearchRef.current) {
            skipNextSuggestSearchRef.current = false;
            return;
        }

        if (searchTimeout.current) {
            clearTimeout(searchTimeout.current);
        }

        if (searchQuery.trim().length > 0) {
            setIsLoading(true);
            const requestId = ++searchRequestIdRef.current;
            searchTimeout.current = setTimeout(async () => {
                let receivedResults = false;
                try {
                    const trimmedQuery = searchQuery.trim();
                    // TMDB already ranks the response. Deduplicate without
                    // promoting title prefixes, ratings, or artwork availability.
                    const byId = new Map<string, SearchResult>();

                    await fetchSearchSuggestions(trimmedQuery, (sections) => {
                        if (requestId !== searchRequestIdRef.current) return;
                        receivedResults = true;
                        for (const section of sections) {
                            for (const item of section.items) {
                                const key = `${item.type}:${item.id}`;
                                if (!byId.has(key)) byId.set(key, item);
                            }
                        }

                        setSuggestions(groupSearchSuggestions(Array.from(byId.values())));
                    }, controller.signal);
                } catch (error) {
                    if (controller.signal.aborted) return;
                    console.error("Search failed:", error);
                    if (requestId === searchRequestIdRef.current && !receivedResults) {
                        setSuggestions([]);
                        setSearchError(error instanceof Error ? error.message : "TMDB search is unavailable.");
                    }
                } finally {
                    if (requestId === searchRequestIdRef.current) setIsLoading(false);
                }
            }, 300);
        } else {
            searchRequestIdRef.current += 1;
            setSuggestions([]);
            setIsLoading(false);
        }

        return () => {
            controller.abort();
            searchRequestIdRef.current += 1;
            if (searchTimeout.current) {
                clearTimeout(searchTimeout.current);
            }
        };
    }, [searchQuery]);

    // Global keyboard shortcut
    useEffect(() => {
        const handleGlobalKeyDown = (event: KeyboardEvent) => {
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
        return () => document.removeEventListener("keydown", handleGlobalKeyDown);
    }, []);

    const handleQueryChange = (query: string) => {
        skipNextSuggestSearchRef.current = false;
        searchRequestIdRef.current += 1;
        setSearchQuery(query);
        setSuggestions([]);
        setIsLoading(query.trim().length > 0);
    };

    const handleSearch = (query: string) => {
        if (query.trim()) router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    };

    const handleSelect = (selected: ExpandingSearchItem) => {
        const item = suggestions.find(result => `${result.type}:${result.id}` === selected.id);
        if (!item) return;
        if (item.type === "movie" || item.type === "series" || item.type === "person") router.push(`/${item.type}/${item.id}`);
        else handleSearch(item.name);
    };

    const items = useMemo<ExpandingSearchItem[]>(() => suggestions.map(item => {
        const year = item.year || item.releaseInfo;
        const score = Number(item.communityRating ?? item.imdbRating);
        const rating = Number.isFinite(score) && score > 0 ? score.toFixed(1) : undefined;
        return {
            id: `${item.type}:${item.id}`,
            title: item.name,
            group: item.type === "movie" ? "Movies" : item.type === "series" ? "TV shows" : "People",
            meta: item.type === "person" ? item.department || "" : [year, rating ? `${rating} out of 10` : ""].filter(Boolean).join(" · "),
            metaContent: item.type === "person" ? item.department ? <span>{item.department}</span> : undefined : year || rating ? <span className="inline-flex items-center gap-1.5">
                {year && <span>{year}</span>}
                {year && rating && <span aria-hidden="true">·</span>}
                {rating && <span className="inline-flex items-center gap-1 tabular-nums" role="img" aria-label={`${item.ratingSource || "Rating"} ${rating} out of 10`}>
                    <Star aria-hidden="true" className="size-3 shrink-0 fill-yellow-400 text-yellow-400" />
                    <span>{rating}</span>
                </span>}
            </span> : undefined,
            icon: item.poster
                ? <ArtworkImage src={item.poster} alt="" draggable={false} loading="lazy" width={30} height={44} className="h-11 w-[30px] rounded object-cover" fallbackText="" />
                : item.type === "person" ? <UserRound size={18} /> : item.type === "movie" ? <Film size={18} /> : <Tv size={18} />,
        };
    }), [suggestions]);

    if (isPlayerVisible) return null;

    return (
        <ExpandingSearch
            ref={inputRef}
            className={className}
            label="Search movies, TV shows, and people"
            placeholder="Search movies, TV shows, and people…"
            value={searchQuery}
            onValueChange={handleQueryChange}
            items={items}
            loading={isLoading}
            filterResults={false}
            minQueryLength={1}
            onSelect={handleSelect}
            onItemIntent={handleItemIntent}
            onSubmit={handleSearch}
            emptyHint={searchError || "Try another title or name, or press Enter to see all results"}
            expandedWidth={576}
            persistent
            anchor="start"
        />
    );
}
