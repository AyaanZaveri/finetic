"use client";

import { useMediaPlayer } from "@/contexts/MediaPlayerContext";
import type { SubtitleEvidence } from "@/lib/navigator-subtitles";

export function SubtitleEvidenceLinks({ evidence = [], sourceId }: { evidence?: SubtitleEvidence[]; sourceId?: string }) {
    const { currentMediaWithSource, isPlayerVisible, skipToTimestamp } = useMediaPlayer();
    const canSeek = isPlayerVisible && sourceId === (currentMediaWithSource?.mediaSourceId || currentMediaWithSource?.id);
    if (!evidence.length) return null;
    return <span className="mt-2 flex flex-wrap gap-2">
        {evidence.map(entry => <button
            key={entry.timestamp}
            type="button"
            disabled={!canSeek}
            title={entry.text}
            aria-label={`Jump to supporting dialogue at ${entry.timestampFormatted}: ${entry.text}`}
            className="cursor-pointer rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default disabled:opacity-50"
            onClick={() => skipToTimestamp(entry.timestamp)} draggable={false}
        >{entry.timestampFormatted}</button>)}
    </span>;
}
