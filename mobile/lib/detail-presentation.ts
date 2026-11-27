import type { MediaItem } from './home-catalog';

/** Keep real catalog data when a more detailed provider response omits a field. */
export function mergeTitleDetails(summary?: MediaItem, detail?: MediaItem): MediaItem | undefined {
  if (!summary || !detail || summary.id !== detail.id || summary.type !== detail.type) return detail ?? summary;
  return {
    ...summary,
    ...Object.fromEntries(Object.entries(detail).filter(([, value]) => value !== undefined)),
  } as MediaItem;
}

export function detailWordmarkSize(availableWidth: number, roomy: boolean, aspect?: number) {
  const width = Math.min(availableWidth * 0.84, roomy ? 400 : 320);
  const maxHeight = roomy ? 108 : 92;
  return { width, height: aspect && Number.isFinite(aspect) && aspect > 0 ? Math.min(maxHeight, width / aspect) : maxHeight };
}

/** Reserve one compact value edge, without the old 82pt credit-label gutter. */
export function creditLabelWidth(hasDirector: boolean, fontScale: number) {
  return (hasDirector ? 56 : 48) * Math.max(1, fontScale);
}
