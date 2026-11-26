"use client";

import { Button } from "@/components/ui/button";
import type { PlaybackError } from "@/lib/media/playback-error";

export function PlayerPlaybackError({ error, onRetry, onEnableProxy }: {
    error: PlaybackError;
    onRetry(): void;
    onEnableProxy(): void;
}) {
    return <div className="flex flex-col items-start gap-3">
        <div role="alert" className="max-w-sm space-y-1">
            <p className="text-sm/normal font-medium text-white text-pretty">{error.message}</p>
            {error.suggestInHouseProxy && <p className="text-[0.8125rem]/normal text-white/80 text-pretty">
                The in-house proxy stays on until you turn it off
            </p>}
        </div>
        <div className="flex flex-wrap gap-2">
            {error.suggestInHouseProxy && <Button variant="primary" onClick={onEnableProxy}>Enable proxy and retry</Button>}
            <Button variant="secondary" onClick={onRetry}>Try again</Button>
        </div>
    </div>;
}
