"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { SearchIcon } from "lucide-react";
import { SearchPersonCard } from "@/components/search-person-card";
import { MediaCard } from "@/components/media-card";
import { HomeInitialPalette } from "@/components/home-palette-provider";
import { mediaArtwork } from "@/lib/artwork";
import { SearchTypeFilters } from "@/components/search-page-controls";
import { Button } from "@/components/ui/button";
import { ActivityTextShimmer } from "@/components/motion-primitives/activity-text-shimmer";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { searchMediaFilter, searchPageUrl, type SearchResultSet } from "@/lib/search-presentation";
import { createSearchResultsStore } from "@/lib/search-results";
import styles from "./search-page.module.css";

const identity = (item: { type: string; id: string }) => `${item.type}:${item.id}`;

export function SearchResultsView({ query, initialResults, peopleAvailable = true }: {
    query: string; initialResults: SearchResultSet; peopleAvailable?: boolean;
}) {
    const params = useSearchParams();
    const selectedFilter = searchMediaFilter(params.get("type") ?? undefined);
    const filter = selectedFilter === "person" && !peopleAvailable ? "all" : selectedFilter;
    const [store] = useState(() => createSearchResultsStore(initialResults, async (type, page, signal) => {
        const params = new URLSearchParams({ q: query, type, page: String(page) });
        const response = await fetch(`/api/search/results?${params}`, { signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load more titles. Try again.");
        if (!Array.isArray(data.results) || !Number.isFinite(data.totalPages) || !Number.isFinite(data.totalResults)) {
            throw new Error("Could not load more titles. Try again.");
        }
        return data;
    }));
    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    const source = snapshot[filter];
    const sentinel = useRef<HTMLDivElement>(null);
    const [automatic, setAutomatic] = useState(true);
    const hasMore = source.nextPage <= Math.min(500, source.totalPages);

    useEffect(() => {
        store.activate(filter);
        return () => store.stop();
    }, [store, filter]);
    useEffect(() => {
        const target = sentinel.current;
        if (!target || !hasMore || source.loading || source.error) return;
        if (typeof IntersectionObserver === "undefined") { setAutomatic(false); return; }
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) void store.loadMore(filter);
        }, { root: target.closest("[data-page-scroll]"), rootMargin: "600px 0px" });
        observer.observe(target);
        return () => observer.disconnect();
    }, [store, filter, hasMore, source.loading, source.error, source.nextPage]);

    const firstResult = source.results[0];
    const firstArtwork = firstResult && firstResult.type !== "person" ? mediaArtwork(firstResult) : undefined;
    const total = filter === "all" ? snapshot.movie.totalResults + snapshot.series.totalResults + snapshot.person.totalResults : source.totalResults;
    const pool = useMemo(() => {
        const cards = new Map<string, SearchResultSet["all"]["results"][number]>();
        for (const kind of ["all", "movie", "series", "person"] as const) {
            for (const item of snapshot[kind].results) if (!cards.has(identity(item))) cards.set(identity(item), item);
        }
        return cards;
    }, [snapshot]);
    const visible = new Set(source.results.map(identity));
    // Reorder stable keys into TMDB's order; hide other cards instead of
    // unmounting them, retaining decoded images and failed-source state.
    const ordered = [...source.results.map(identity), ...Array.from(pool.keys()).filter(key => !visible.has(key))];
    const changeType = (next: string) => {
        const selected = searchMediaFilter(next);
        if (selected === filter) return;
        window.history.pushState(null, "", searchPageUrl(query, selected));
    };

    return <div className={styles.results}>
        <HomeInitialPalette
            primary={firstResult?.poster || firstArtwork?.poster}
            fallback={firstArtwork?.background}
            resetInteraction
        />
        <div className={styles.toolbar}>
            <SearchTypeFilters value={filter} movies={snapshot.movie.totalResults} shows={snapshot.series.totalResults} people={peopleAvailable ? snapshot.person.totalResults : undefined} onValueChange={changeType} />
        </div>
        <ul aria-label="Search results" aria-busy={source.loading} className={styles.grid} hidden={!source.results.length}>
            {ordered.map(key => {
                const item = pool.get(key)!;
                return <li key={key} hidden={!visible.has(key)}>
                    {item.type === "person" ? <SearchPersonCard item={item} /> : <MediaCard item={item} fullWidth titleLines={2} revealArtwork={false}
                        subtitleContent={<>{item.year ? `${item.year} · ` : ""}{item.type === "movie" ? "Movie" : "TV Series"}</>} />}
                </li>;
            })}
        </ul>
        {!source.results.length && <Empty className={styles.empty}>
            <EmptyHeader>
                <EmptyMedia variant="icon"><SearchIcon aria-hidden="true" /></EmptyMedia>
                <EmptyTitle>{total > 0 ? "No results for this type" : "Nothing made the cut"}</EmptyTitle>
                <EmptyDescription>{total > 0 ? "Choose another result type" : "Try another title, name, or spelling"}</EmptyDescription>
            </EmptyHeader>
            <div className={styles.emptyActions}>
                {filter !== "all" && <Button variant="outline" onClick={() => changeType("all")}>Show all types</Button>}
                <Button asChild variant="outline"><Link draggable={false} href="/">Browse titles</Link></Button>
            </div>
        </Empty>}
        {source.error && <div className={styles.loadStatus}>
            <p role="alert">{source.error}</p>
            <Button variant="outline" onClick={() => void store.loadMore(filter, true)}>Try again</Button>
        </div>}
        {hasMore && !source.error && <div ref={sentinel} className={styles.loadStatus}>
            <p role="status">{source.loading && <ActivityTextShimmer>Loading more results…</ActivityTextShimmer>}</p>
            <Button variant="ghost" disabled={source.loading} className={automatic ? "sr-only focus:not-sr-only" : undefined}
                onClick={() => void store.loadMore(filter)}>Load more results</Button>
        </div>}
    </div>;
}
