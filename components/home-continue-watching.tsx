"use client";

import { useEffect } from "react";
import { useMutationState, useQuery } from "@tanstack/react-query";
import { fetchResumeItems, fetchResumeMovieYear } from "@/app/actions/media";
import { continueWatchingCardKey, continueWatchingOptions, continueWatchingRemovalKey } from "@/lib/media/continue-watching-query";
import { WATCH_HISTORY_CHANGED } from "@/lib/watch-history";
import { useStreamQueries } from "@/components/stream-query-provider";
import { ContinueWatchingWarmup } from "@/components/continue-watching-warmup";
import { HomeInitialPalette } from "@/components/home-palette-provider";
import { MediaSection } from "@/components/media-section";
import { Button } from "@/components/ui/button";
import { MediaSectionSkeleton } from "@/components/media-section-skeleton";
import { mediaArtwork } from "@/lib/artwork";

function ResumeMovieYear({ id, scope }: { id: string; scope: string }) {
    const { data } = useQuery({ queryKey: ["resume-movie-year", scope, id], queryFn: () => fetchResumeMovieYear(id),
        staleTime: Infinity, gcTime: 30 * 60_000, retry: false });
    return data?.toString() ?? null;
}

export function ContinueWatchingSection() {
    const queries = useStreamQueries();
    const scope = queries?.scope ?? "anonymous";
    const { data, isPending, refetch } = useQuery(continueWatchingOptions(scope, fetchResumeItems));
    const pendingRemovals = useMutationState({
        filters: { mutationKey: continueWatchingRemovalKey(scope), exact: true, status: "pending" },
        select: mutation => mutation.state.variables,
    });
    useEffect(() => {
        const refresh = (event: Event) => {
            // The player owns live progress. Refresh the row when playback
            // closes instead of fetching the full library at every heartbeat.
            const playback = (event as CustomEvent).detail?.playback;
            if (playback === "progress" || playback === "start") return;
            void refetch();
        };
        window.addEventListener(WATCH_HISTORY_CHANGED, refresh);
        return () => window.removeEventListener(WATCH_HISTORY_CHANGED, refresh);
    }, [refetch]);
    if (isPending) return <MediaSectionSkeleton sectionName="Continue Watching" continueWatching />;
    if (!data) return <section className="relative z-10 mb-8"><h2 className="mb-4 text-xl sm:text-2xl font-semibold">Continue Watching</h2>
        <p role="alert" className="text-sm text-muted-foreground">Couldn’t load Continue Watching</p>
        <Button type="button" variant="outline" size="sm" onClick={() => { void refetch(); }} className="mt-2">Try again</Button>
    </section>;
    const visible = pendingRemovals.length ? data.filter(item => !pendingRemovals.includes(continueWatchingCardKey(item))) : data;
    const items = visible.slice(0, 20);
    if (items.length === 0) return null;
    const artwork = mediaArtwork(items[0]);
    return <>
        {artwork && <HomeInitialPalette primary={artwork.background} fallback={artwork.poster} />}
        <ContinueWatchingWarmup items={items}><MediaSection sectionName="Continue Watching" mediaItems={items} continueWatching revealArtwork
            cardSubtitles={items.map(item => item.type === "movie" && !item.year && !item.releaseInfo
                ? <ResumeMovieYear key={item.id} id={item.id} scope={scope} /> : undefined)} />
        </ContinueWatchingWarmup>
    </>;
}
