"use client";

import { useEffect, useRef, useState } from "react";
import { Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePlaybackActions } from "@/contexts/MediaPlayerContext";
import { getRandomEpisodeForSeries } from "@/app/actions/tv-shows";
import { pickRandomEpisode, type ShuffleEpisode } from "@/lib/media/shuffle-episode";
import type { MediaToPlay } from "@/lib/atoms";

export function ShuffleEpisodeButton({ media, episodes, preview = false }: { media: MediaToPlay; episodes?: ShuffleEpisode[]; preview?: boolean }) {
    const { playMedia } = usePlaybackActions();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const active = useRef(true);
    const pending = useRef(false);
    const id = media.seriesId || media.id;
    useEffect(() => {
        active.current = true;
        return () => { active.current = false; };
    }, []);

    return (
        <>
            <Tooltip delayDuration={600}>
                <TooltipTrigger asChild>
                    <Button
                        type="button"
                        variant="media-secondary"
                        size="icon-lg"
                        className="shrink-0 rounded-full"
                        aria-label="Shuffle episodes"
                        aria-busy={loading || undefined}
                        disabled={loading}
                        onClick={async () => {
                            if (preview || pending.current) return;
                            pending.current = true;
                            setLoading(true);
                            setError(null);
                            try {
                                // The overview already has the full episode list.
                                // Only fall back to a server lookup when it is absent.
                                const episode: ShuffleEpisode | null = episodes ? pickRandomEpisode(episodes) : await getRandomEpisodeForSeries(id);
                                if (!active.current) return;
                                if (!episode) {
                                    setError("No released episodes are available to shuffle.");
                                    return;
                                }
                                const title = episode.title || episode.name || `Episode ${episode.episode}`;
                                await playMedia({
                                    id, type: "series", seriesId: id,
                                    details: media.details, detailsLoaded: media.detailsLoaded,
                                    name: title, showName: media.showName || media.name,
                                    mediaSourceId: episode.id, episodeTitle: title,
                                    seasonNumber: episode.season, episodeNumber: episode.episode,
                                    resumePositionTicks: 0, backdropUrl: media.backdropUrl,
                                });
                            } catch {
                                if (active.current) setError("Couldn't choose an episode. Try again.");
                            } finally {
                                pending.current = false;
                                if (active.current) setLoading(false);
                            }
                        }}
                    >
                        <Shuffle aria-hidden="true" strokeWidth={2.5} className="size-4" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent sideOffset={8}>Shuffle episodes</TooltipContent>
            </Tooltip>
            {error && <span role="alert" className="basis-full text-sm text-destructive">{error}</span>}
        </>
    );
}
