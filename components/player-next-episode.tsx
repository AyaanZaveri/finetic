"use client";

import { useEffect, useId, useRef } from "react";
import { SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MediaPlayerTooltip } from "@/components/ui/media-player";
import type { Episode } from "@/app/actions/tv-shows";

export function PlayerNextEpisode({ next, advancing, onAdvance }: {
    next: Episode | null; advancing: boolean; onAdvance(): void;
}) {
    if (!next) return <span data-player-next-slot="" className="size-8 shrink-0" aria-hidden="true" />;
    return <MediaPlayerTooltip tooltip={`S${next.season} E${next.episode} · ${next.title}`}>
        <Button data-player-next-slot="" type="button" variant="ghost" size="icon-sm" loading={advancing}
            aria-label={`Play next episode: ${next.title}`} onClick={onAdvance}>
            <SkipForward aria-hidden="true" />
        </Button>
    </MediaPlayerTooltip>;
}

export function PlayerUpNext({ next, seconds, onPlay, onCancel }: {
    next: Episode; seconds: number; onPlay(): void; onCancel(): void;
}) {
    const cancelRef = useRef<HTMLButtonElement>(null);
    const titleId = useId();
    useEffect(() => { cancelRef.current?.focus({ preventScroll: true }); }, []);
    return (
        <section data-player-up-next="" aria-label="Up Next"
            className="absolute end-4 z-[60] w-[min(22rem,calc(100%_-_2rem))] rounded-xl border border-white/10 bg-background p-4 text-foreground shadow-lg"
            onKeyDown={event => {
                if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); }
            }}>
            <p className="flex justify-between gap-2 text-sm text-muted-foreground">
                <span>Up Next</span><span role="timer" className="tabular-nums">{seconds}s</span>
            </p>
            <p id={titleId} className="mt-1 line-clamp-2 break-words text-base font-semibold">{next.title}</p>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button ref={cancelRef} type="button" variant="ghost" size="sm" aria-label="Cancel autoplay"
                    aria-describedby={titleId} onClick={onCancel}>Cancel</Button>
                <Button type="button" size="sm" onClick={onPlay}>Play now</Button>
            </div>
        </section>
    );
}
