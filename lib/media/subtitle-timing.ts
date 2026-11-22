import { useCallback, useState } from "react";
import type { MediaToPlay } from "@/lib/atoms";

export const SUBTITLE_TIMING_LIMIT = 30;

export function normalizeSubtitleDelay(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.round(Math.max(-SUBTITLE_TIMING_LIMIT, Math.min(SUBTITLE_TIMING_LIMIT, seconds)) * 10) / 10 || 0;
}

export function subtitleVideoKey(media: MediaToPlay | null): string | null {
  return media ? JSON.stringify([media.type, media.seriesId || media.id, media.seasonNumber ?? null, media.episodeNumber ?? null]) : null;
}

/** Positive delay shows the cue later; negative delay brings it forward. */
export function subtitleTime(playbackSeconds: number, delaySeconds: number): number {
  return playbackSeconds - delaySeconds;
}

export function subtitleDelayForMarks(delay: number, heard: number, saw: number): number | null {
  const next = delay + (heard - saw);
  if (!Number.isFinite(next) || Math.abs(next) > SUBTITLE_TIMING_LIMIT + 1e-9) return null;
  return normalizeSubtitleDelay(next);
}

/** Timing is scoped to each video for this app session, never a global preference. */
export function useSubtitleTiming(media: MediaToPlay | null) {
  const key = subtitleVideoKey(media);
  const [delays, setDelays] = useState<Record<string, number>>({});
  const onChange = useCallback((seconds: number) => {
    if (key) setDelays(previous => ({ ...previous, [key]: normalizeSubtitleDelay(seconds) }));
  }, [key]);
  return { key, seconds: key ? delays[key] ?? 0 : 0, onChange };
}
