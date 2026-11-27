import type { MediaItem, MediaType } from './home-catalog';

export type SearchFilter = 'all' | MediaType;
export type SearchPhase = 'idle' | 'loading' | 'error' | 'results' | 'empty' | 'filtered-empty';

const COLUMN_GAP = 16;

/** Base poster density follows the web grid; use wider columns for larger text. */
export function searchGridLayout(width: number, fontScale = 1) {
  const gutter = width >= 1024 ? 32 : width >= 640 ? 24 : 16;
  const available = Math.max(1, width - 2 * gutter);
  const minimum = (width >= 1024 ? 144 : 136) * Math.max(1, Math.min(fontScale, 1.5));
  const columns = Math.max(1, Math.floor((available + COLUMN_GAP) / (minimum + COLUMN_GAP)));
  return { gutter, columns, cardWidth: (available - (columns - 1) * COLUMN_GAP) / columns, columnGap: COLUMN_GAP };
}

/** Filter returned titles in provider order, without another network request. */
export function searchPresentation(items: MediaItem[], filter: SearchFilter) {
  const counts = { all: items.length, movie: 0, series: 0 };
  for (const item of items) counts[item.type]++;
  return { counts, items: filter === 'all' ? items : items.filter(item => item.type === filter) };
}

export function searchPhase(value: string, term: string, pending: boolean, error: boolean, total: number, visible: number): SearchPhase {
  const trimmed = value.trim();
  if (!trimmed) return 'idle';
  if (trimmed !== term || pending) return 'loading';
  if (error && total === 0) return 'error';
  if (visible) return 'results';
  return total ? 'filtered-empty' : 'empty';
}
