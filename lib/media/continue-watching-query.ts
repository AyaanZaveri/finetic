import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { MediaItem } from "@/types/stremio";

export const continueWatchingKey = (scope: string) => ["continue-watching", scope] as const;
export const continueWatchingRemovalKey = (scope: string) => ["remove-continue-watching", scope] as const;

export function continueWatchingCardKey(item: MediaItem) {
    const video = item.mediaSourceId || item.episodeId || (item.seasonNumber !== undefined && item.episodeNumber !== undefined
        ? `${item.seasonNumber}:${item.episodeNumber}` : null);
    return JSON.stringify([item.type, item.id, video]);
}

export function removeContinueWatchingCard(
    client: QueryClient, scope: string, item: MediaItem, save: () => Promise<boolean>,
) {
    const queryKey = continueWatchingKey(scope);
    return client.getMutationCache().build(client, {
        mutationKey: continueWatchingRemovalKey(scope),
        mutationFn: async (_cardKey: string) => {
            if (!await save()) throw new Error("Could not update Continue Watching");
        },
        onSuccess: async (_, cardKey) => {
            // Drop a read started before the write, then commit the removal
            // before the pending mutation stops hiding the card.
            const visible = client.getQueryData<MediaItem[]>(queryKey);
            await client.cancelQueries({ queryKey, exact: true });
            client.setQueryData<MediaItem[]>(queryKey, items => (items ?? visible)?.filter(item => continueWatchingCardKey(item) !== cardKey));
        },
    }).execute(continueWatchingCardKey(item));
}

/** The layout owns this account-scoped cache across page navigation. Refresh
 * progress in the background without replacing loaded cards with a skeleton. */
export function continueWatchingOptions(scope: string, read: () => Promise<MediaItem[]>) {
    return queryOptions({
        queryKey: continueWatchingKey(scope),
        queryFn: read,
        staleTime: 0,
        gcTime: 30 * 60_000,
        refetchOnMount: "always",
        refetchOnWindowFocus: true,
        retry: false,
    });
}
