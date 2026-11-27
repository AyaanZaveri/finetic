import type { MediaItem } from './home-catalog';

/** Keep the carousel about discovery. Detailed facts belong on the title page. */
export function heroMetadata(item: MediaItem): string {
  const genres = [...new Set((item.genres ?? []).map(genre => genre.trim()).filter(Boolean))].slice(0, 2);
  return [item.type === 'series' ? 'TV show' : 'Movie', ...genres, item.contentRating?.trim()]
    .filter(Boolean)
    .join(' · ');
}

/** Use the available viewport rather than a device model for the tablet composition. */
export function heroLayout(width: number, height: number, leftInset: number, rightInset: number) {
  const availableWidth = Math.max(0, width - leftInset - rightInset);
  const roomy = availableWidth >= 768;
  return {
    roomy,
    height: roomy
      ? Math.min(520, Math.max(384, Math.min(width * 0.52, height * 0.60)))
      : Math.min(704, Math.max(480, Math.min(width * 1.34, height * 0.8))),
    leadingPadding: leftInset + (roomy ? 32 : 16),
    trailingPadding: rightInset + (roomy ? 32 : 16),
    copyWidth: roomy ? Math.min(460, availableWidth * 0.50) : availableWidth,
  };
}
