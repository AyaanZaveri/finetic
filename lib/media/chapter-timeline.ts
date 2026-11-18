import type { Chapter } from "./chapters";
import type { SkipSegment } from "./skip-segments";

/** Sparse files can label everything between Intro and Credits as Intro.
 * Known skip boundaries are more precise for those labels; retain normal chapter
 * names, and leave unnamed story time without a misleading preview caption. */
export function boundSkipChapterLabels(chapters: readonly Chapter[], segments: readonly SkipSegment[]): Chapter[] {
    return chapters.flatMap(chapter => {
        const title = chapter.text.trim().toLowerCase();
        const kind = /^(intro|introduction|opening|opening credits)$/.test(title) ? "intro"
            : /^(recap|previously on.*)$/.test(title) ? "recap"
                : /^(credits|end credits|closing credits|outro|ending)$/.test(title) ? "credits" : null;
        if (!kind) return [chapter];
        const matches = segments.filter(segment => segment.kind === kind
            && Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start
            && segment.start < chapter.endTime && segment.end > chapter.startTime);
        if (!matches.length) return [chapter];
        return matches.map(segment => ({ ...chapter, startTime: Math.max(chapter.startTime, segment.start),
            endTime: Math.min(chapter.endTime, segment.end) }));
    });
}

/** Mask every track layer together so the gaps reveal the video, not a dark
 * separator painted above the played/buffered/skip ranges. The slider stays whole. */
export function chapterTrackMask(chapters: readonly Chapter[], start: number, end: number): string | undefined {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    const positions = [...new Set(chapters.flatMap(chapter => [chapter.startTime, chapter.endTime]))]
        .filter(time => Number.isFinite(time) && time > start && time < end).sort((a, b) => a - b)
        .map(time => (time - start) / (end - start) * 100);
    if (!positions.length) return;
    const gaps = positions.map(position => {
        // Keep the divider out of the rounded track caps on both edges.
        const center = `clamp(min(5px, 50%), ${position}%, max(50%, 100% - 5px))`;
        const left = `calc(${center} - 1px)`;
        const right = `calc(${center} + 1px)`;
        return `#000 ${left}, transparent ${left}, transparent ${right}, #000 ${right}`;
    });
    return `linear-gradient(to right, #000 0%, ${gaps.join(', ')}, #000 100%)`;
}
