import { queryOptions } from "@tanstack/react-query";
import type { MediaItem } from "@/types/stremio";

/** The layout owns this account-scoped cache across page navigation. Refresh
 * progress in the background without replacing loaded cards with a skeleton. */
export function continueWatchingOptions(scope: string, read: () => Promise<MediaItem[]>) {
    return queryOptions({
        queryKey: ["continue-watching", scope],
        queryFn: read,
        staleTime: 0,
        gcTime: 30 * 60_000,
        refetchOnMount: "always",
        refetchOnWindowFocus: true,
        retry: false,
    });
}
