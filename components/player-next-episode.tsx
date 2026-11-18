"use client";

import { useEffect, useId, useRef } from "react";
import { SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MediaPlayerTooltip } from "@/components/ui/media-player";
import { ArtworkImage } from "@/components/artwork-image";
import { DigitWheel } from "@/components/arc/number-field/digit-wheel";
import digitStyles from "@/components/arc/number-field/number-field.module.css";
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

export function PlayerUpNext({ next, thumbnail, seconds, onPlay, onCancel }: {
    next: Episode; thumbnail?: string; seconds: number | null; onPlay(): void; onCancel(): void;
}) {
    const cancelRef = useRef<HTMLButtonElement>(null);
    const titleId = useId();
    const counting = seconds !== null;
    useEffect(() => {
        if (counting) cancelRef.current?.focus({ preventScroll: true });
    }, [counting]);
    return (
        <section data-player-up-next="" data-player-glass="" aria-label="Up Next"
            className="absolute end-4 z-[60] w-[min(22rem,calc(100%_-_2rem))] rounded-xl p-4 shadow-lg"
            onKeyDown={event => {
                if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); }
            }}>
            <div className="flex items-center gap-3">
                {thumbnail && (
                    <ArtworkImage src={thumbnail} alt="" reveal={false} fallbackText="" draggable={false}
                        className="aspect-video w-24 shrink-0 rounded-lg bg-black/20 object-cover" />
                )}
                <div className="min-w-0 flex-1">
                    <p className="flex items-baseline justify-between gap-2 text-sm text-muted-foreground">
                        <span>Up Next</span>
                        {counting && (
                            <span role="timer" aria-label={`${seconds} seconds remaining`} className="shrink-0 tabular-nums">
                                <span className={digitStyles.column} aria-hidden="true">
                                    <DigitWheel digit={seconds} direction={-1} instant={false} />
                                </span>
                                <span aria-hidden="true">s</span>
                            </span>
                        )}
                    </p>
                    <p id={titleId} className="mt-1 line-clamp-2 break-words text-base font-semibold">{next.title}</p>
                </div>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button ref={cancelRef} type="button" variant="ghost" size="sm" aria-label="Cancel autoplay"
                    aria-describedby={titleId} onClick={onCancel}>Cancel</Button>
                <Button type="button" size="sm" onClick={onPlay}>Play now</Button>
            </div>
        </section>
    );
}
