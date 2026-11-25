"use client";

import { Radio } from "lucide-react";
import { StreamCard } from "./stream-card";
import { cn } from "@/lib/utils";
import { ResultCard, ResultBadge } from "./result-card";

interface StreamListCardProps {
  result: {
    success: boolean;
    mediaId?: string;
    mediaType?: string;
    selectionId?: string;
    streamCount?: number;
    addonCount?: number;
    streams?: Array<{
      choice?: number;
      streamId?: string | null;
      addonName?: string | null;
      title?: string | null;
      name?: string | null;
      resolution?: string | null;
      tags?: string[];
      playable?: boolean;
      filename?: string | null;
      videoSize?: number | null;
      score?: number;
    }>;
    bestStream?: {
      choice?: number;
      streamId?: string | null;
      addonName?: string | null;
      title?: string | null;
      name?: string | null;
      resolution?: string | null;
      tags?: string[];
      playable?: boolean;
      filename?: string | null;
      videoSize?: number | null;
    } | null;
    message?: string;
    error?: string;
  };
  className?: string;
  index?: number;
}

export function StreamListCard({
  result,
  className,
  index = 0,
}: StreamListCardProps) {
  if (!result.success || !result.streams?.length)
    return (
      <ResultCard
        className={className}
        index={index}
        title="No streams found"
        icon={Radio}
        description={
          result.error || result.message || "Try another title or check your add-ons"
        }
      />
    );
  const displayStreams = result.streams.slice(0, 20);
  const bestId = result.bestStream?.streamId;
  const bestChoice = result.bestStream?.choice;
  const bestTitle =
    result.bestStream?.title ||
    result.bestStream?.name ||
    result.bestStream?.filename;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <ResultCard
        index={index}
        title="Streams"
        icon={Radio}
        metadata={
          <>
            <ResultBadge>
              {result.streamCount ?? result.streams.length} found
            </ResultBadge>
            {result.addonCount != null && (
              <ResultBadge>
                {result.addonCount} add-on{result.addonCount === 1 ? "" : "s"}
              </ResultBadge>
            )}
          </>
        }
      />
      {displayStreams.map((stream, i) => {
        const best = bestId
          ? stream.streamId === bestId
          : bestChoice != null
            ? stream.choice === bestChoice
            : !!bestTitle &&
              (stream.title === bestTitle ||
                stream.name === bestTitle ||
                stream.filename === bestTitle);
        return (
          <StreamCard
            key={`${stream.streamId || stream.addonName}-${i}`}
            stream={stream}
            isBest={best}
            index={i}
          />
        );
      })}
      {result.streams.length > 20 && (
        <p className="px-2 text-xs text-muted-foreground">
          +{result.streams.length - 20} more streams
        </p>
      )}
    </div>
  );
}
