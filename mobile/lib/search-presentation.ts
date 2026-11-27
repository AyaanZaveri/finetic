import type { MediaItem, MediaType } from './home-catalog';

export type SearchFilter = 'all' | MediaType;
export type SearchPhase = 'idle' | 'loading' | 'error' | 'results' | 'empty' | 'filtered-empty';

/** Three columns on typical phones, wider cards for narrow screens and larger text. */
export function searchGridLayout(width: number, fontScale = 1) {
  const gutter = width >= 1024 ? 32 : width >= 640 ? 24 : 16;
  const available = Math.max(1, width - 2 * gutter);
  const columnGap = width >= 640 ? 16 : 12;
  const textAdjustment = Math.max(1, Math.min(fontScale, 1.5));
  const minimum = (width >= 1024 ? 144 : width >= 640 ? 136 : 100) * textAdjustment;
  const columns = Math.max(1, Math.min(width < 640 ? 3 : Infinity, Math.floor((available + columnGap) / (minimum + columnGap))));
  return { gutter, columns, cardWidth: (available - (columns - 1) * columnGap) / columns, columnGap };
}

/** Prefer an exact title match, then retain the provider order without another network request. */
export function searchPresentation(items: MediaItem[], filter: SearchFilter, term = '') {
  const counts = { all: items.length, movie: 0, series: 0 };
  for (const item of items) counts[item.type]++;
  const visible = filter === 'all' ? items : items.filter(item => item.type === filter);
  const normalizedTerm = normalizeTitle(term);
  if (!normalizedTerm) return { counts, items: visible };
  const exact = visible.filter(item => normalizeTitle(item.name) === normalizedTerm);
  if (!exact.length) return { counts, items: visible };
  const remaining = visible.filter(item => normalizeTitle(item.name) !== normalizedTerm);
  return { counts, items: [...exact, ...remaining] };
}

function normalizeTitle(value: string) {
  return value.trim().normalize('NFKC').toLowerCase();
}

export function searchPhase(value: string, term: string, pending: boolean, error: boolean, total: number, visible: number): SearchPhase {
  const trimmed = value.trim();
  if (!trimmed) return 'idle';
  if (trimmed !== term || pending) return 'loading';
  if (error && total === 0) return 'error';
  if (visible) return 'results';
  return total ? 'filtered-empty' : 'empty';
}
