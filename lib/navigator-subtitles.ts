export interface SubtitleEvidence {
  timestamp: number;
  endTimestamp?: number;
  timestampFormatted: string;
  text: string;
  italicized?: boolean;
}

/** Preserve dialogue context and timeline coverage; isolated samples lose semantic scenes. */
export function sceneSubtitleCandidates(entries: SubtitleEvidence[], limit = 420): SubtitleEvidence[] {
    if (entries.length <= limit) return entries.map(entry => ({ ...entry, italicized: /<i(?:\s[^>]*)?>/i.test(entry.text) }));
    const size = Math.ceil(entries.length / limit);
    const passages: SubtitleEvidence[] = [];
    for (let index = 0; index < entries.length; index += size) {
        const group = entries.slice(index, index + size);
        passages.push({ ...group[0], endTimestamp: group.at(-1)?.endTimestamp,
            italicized: group.some(entry => /<i(?:\s[^>]*)?>/i.test(entry.text)),
            text: group.map(entry => entry.text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()).join(" ").slice(0, 1200) });
    }
    return passages;
}

export function sceneSubtitles(entries: SubtitleEvidence[], timestamp: number, window: number, allowSpoilers = false) {
    return entries.filter(entry => entry.timestamp >= Math.max(0, timestamp - window)
    && (allowSpoilers ? entry.timestamp <= timestamp + window : (entry.endTimestamp ?? entry.timestamp) <= timestamp));
}

export function matchedSubtitle(entries: SubtitleEvidence[], selection: { candidate: number | null; confidence: string }) {
    if (selection.confidence !== "high" || selection.candidate === null) return null;
    if (!Number.isInteger(selection.candidate) || selection.candidate < 1 || selection.candidate > entries.length) return null;
    return entries[selection.candidate - 1];
}
