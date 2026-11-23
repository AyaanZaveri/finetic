"use client";

import { useWatchedStatus } from "@/contexts/watch-history-context";

/** The check can show the artwork or use a fixed color over changing artwork. */
export function WatchedIndicator({ id, type, videoId, aboveProgress = false }: {
    id: string;
    type: string;
    videoId?: string;
    aboveProgress?: boolean;
}) {
    const watched = useWatchedStatus(id, type, videoId);
    if (!watched) return null;
    return (
        <span
            data-slot="watched-indicator"
            role="img"
            aria-label="Watched"
            title="Watched"
            className={`pointer-events-none absolute end-2 z-40 size-5 text-white/80 ${aboveProgress ? "bottom-5" : "bottom-2"}`}
        >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-full">
                <circle cx="12" cy="12" r="8" fill="var(--watched-check, transparent)" />
                <path fill="currentColor" fillRule="evenodd" clipRule="evenodd"
                    d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm5.7 6.3a1 1 0 0 0-1.4 0L10 14.6l-2.3-2.3a1 1 0 0 0-1.4 1.4l3 3a1 1 0 0 0 1.4 0l7-7a1 1 0 0 0 0-1.4Z" />
            </svg>
        </span>
    );
}
