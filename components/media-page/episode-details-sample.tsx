import { Check, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EpisodeDetailsView } from "./episode-details-view";

// No artwork URLs, playback hooks, history lookups, or expandable text effects:
// measuring a hidden sample must never start a real media request.
export function EpisodeDetailsSample() {
  return (
    <EpisodeDetailsView
      inertSample
      showName="Television series"
      title="An unexpected turn"
      seasonNumber={1}
      episodeNumber={12}
      released="2024-01-01T12:00:00Z"
      rating="8.5"
      thumbnail={<div skullet-block="" className="h-full w-full" />}
      actions={
        <div className="mt-3 flex max-w-full flex-wrap items-center gap-2">
          <Button disabled variant="media-primary" size="lg" className="h-10 min-w-0 gap-2 rounded-full bg-foreground px-5 text-[15px] font-semibold text-background has-[>svg]:px-5">
            <Play aria-hidden="true" data-icon="inline-start" className="size-4 fill-current" />
            <span>Play</span>
          </Button>
          <Button disabled variant="media-secondary" size="icon-lg" className="rounded-full" aria-label="Mark watched">
            <Check aria-hidden="true" className="size-4" />
          </Button>
        </div>
      }
      description={
        <div className="min-w-0 max-w-prose">
          <p className="line-clamp-3 break-words text-base leading-relaxed">
            An unexpected arrival changes everyone’s plans. As the family comes together,
            a small misunderstanding turns into a surprising adventure, and each of them
            finds a different way to make things right before the evening is over.
          </p>
        </div>
      }
    />
  );
}
