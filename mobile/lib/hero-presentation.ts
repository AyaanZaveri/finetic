import type { MediaItem } from './home-catalog';

/** Keep the carousel about discovery. Detailed facts belong on the title page. */
export function heroMetadataParts(item: MediaItem): string[] {
  const genres = [...new Set((item.genres ?? []).map(genre => genre.trim()).filter(Boolean))].slice(0, 2);
  return [item.type === 'series' ? 'TV show' : 'Movie', ...genres, item.contentRating?.trim()]
    .filter((part): part is string => Boolean(part));
}

/** Use the available viewport rather than a device model for the tablet composition. */
export function heroLayout(width: number, height: number, leftInset: number, rightInset: number) {
  const availableWidth = Math.max(0, width - leftInset - rightInset);
  const roomy = availableWidth >= 768;
  return {
    roomy,
    height: roomy
      // Give the artwork a more cinematic aspect on wide windows while
      // retaining a preview of the next rail and adapting to portrait/split view.
      ? Math.min(740, height * 0.72, Math.max(384, Math.min(availableWidth * 0.66, height * 0.68)))
      : Math.min(704, Math.max(480, Math.min(width * 1.34, height * 0.8))),
    leadingPadding: leftInset + (roomy ? 32 : 16),
    trailingPadding: rightInset + (roomy ? 32 : 16),
    copyWidth: roomy ? Math.min(460, availableWidth * 0.50) : Math.max(0, availableWidth - 32),
    wordmarkHeight: roomy ? 136 : 112,
    wordmarkWidth: Math.max(0, Math.min(roomy ? Math.min(460, availableWidth * 0.50) : availableWidth - 32, roomy ? 440 : 340)),
    identityGap: roomy ? 16 : 12,
    descriptionGap: 12,
    actionGap: 18,
    controlsGap: 12,
    bottomGap: roomy ? 20 : 16,
  };
}
