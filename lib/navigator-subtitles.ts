export interface SubtitleEvidence {
  timestamp: number;
  endTimestamp?: number;
  timestampFormatted: string;
  text: string;
}

export function sceneSubtitles(entries: SubtitleEvidence[], timestamp: number, window: number, allowSpoilers = false) {
    return entries.filter(entry => entry.timestamp >= Math.max(0, timestamp - window)
    && (allowSpoilers ? entry.timestamp <= timestamp + window : (entry.endTimestamp ?? entry.timestamp) <= timestamp));
}
