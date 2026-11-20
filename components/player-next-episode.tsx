"use client";

import { useEffect, useId, useRef, type CSSProperties } from "react";
import { SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MediaPlayerTooltip } from "@/components/ui/media-player";
import { ArtworkImage } from "@/components/artwork-image";
import { DigitWheel } from "@/components/arc/number-field/digit-wheel";
import digitStyles from "@/components/arc/number-field/number-field.module.css";
import floatingSurface from "@/components/arc/floating-surface.module.css";
import { UP_NEXT_SECONDS } from "@/lib/media/episode-continuation";
import type { Episode } from "@/app/actions/tv-shows";

export function PlayerNextEpisode({ next, advancing, onAdvance }: {
    next: Episode | null; advancing: boolean; onAdvance(): void;
}) {
    if (!next) return null;
    return <MediaPlayerTooltip tooltip={`S${next.season} E${next.episode} · ${next.title}`}>
        <Button type="button" variant="player-control" loading={advancing}
            aria-label={`Play next episode: ${next.title}`} onClick={onAdvance}>
            <SkipForward aria-hidden="true" />
        </Button>
    </MediaPlayerTooltip>;
}

function UpNextCountdown({ seconds, running }: { seconds: number; running: boolean }) {
    const remaining = seconds / UP_NEXT_SECONDS;
    const offset = 1 - remaining;
    const ringStyle = {
        "--ring-offset": offset,
        "--ring-next-offset": Math.min(1, offset + 1 / UP_NEXT_SECONDS),
    } as CSSProperties;

    return (
        <span role="timer" aria-label={`Plays in ${seconds} ${seconds === 1 ? "second" : "seconds"}`}
            className="relative grid size-9 shrink-0 place-items-center text-sm font-medium tabular-nums">
            <svg aria-hidden="true" viewBox="0 0 36 36" className="absolute inset-0 size-full -rotate-90" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="18" cy="18" r="16" className="opacity-15" />
                <circle key={seconds} cx="18" cy="18" r="16" pathLength="1" strokeDasharray="1"
                    strokeDashoffset={offset} strokeLinecap="round" style={ringStyle}
                    data-player-up-next-ring={running ? "running" : "still"} />
            </svg>
            <span className={digitStyles.column} aria-hidden="true">
                <DigitWheel digit={seconds} direction={-1} instant={false} />
            </span>
        </span>
    );
}

export function PlayerUpNext({ next, thumbnail, seconds, timerRunning = true, onPlay, onCancel }: {
    next: Episode; thumbnail?: string; seconds: number | null; timerRunning?: boolean; onPlay(): void; onCancel(): void;
}) {
    const cancelRef = useRef<HTMLButtonElement>(null);
    const titleId = useId();
    const counting = seconds !== null;
    useEffect(() => {
        if (counting) cancelRef.current?.focus({ preventScroll: true });
    }, [counting]);
    return (
        <section data-player-up-next="" data-player-native-glass="" data-player-hdr-glass="" aria-label="Up Next"
            className={`${floatingSurface.surface} absolute end-4 z-[60] w-[min(27.5rem,calc(100%_-_2rem))] rounded-xl border border-border p-3.5 text-popover-foreground shadow-lg`}
            onKeyDown={event => {
                if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); }
            }}>
            <div data-player-up-next-content="" className="flex items-stretch gap-3.5">
                {thumbnail && (
                    <div className="relative w-[clamp(3.5rem,33%,9rem)] shrink-0 overflow-hidden rounded-lg bg-muted">
                        <ArtworkImage src={thumbnail} alt="" reveal={false} fallbackText="" draggable={false}
                            className="absolute inset-0 block size-full object-cover" />
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-xs text-muted-foreground">Up Next</p>
                            <p id={titleId} className="mt-0.5 break-words text-base font-semibold leading-snug">{next.title}</p>
                        </div>
                        {counting && <UpNextCountdown seconds={seconds} running={timerRunning} />}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-2 gap-y-1">
                        <Button type="button" size="xs" onClick={onPlay}>Play now</Button>
                        <Button ref={cancelRef} type="button" variant="ghost" size="xs" aria-label="Cancel autoplay"
                            aria-describedby={titleId} onClick={onCancel}>Cancel</Button>
                    </div>
                </div>
            </div>
        </section>
    );
}
