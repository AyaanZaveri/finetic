import type { MediaItem } from './home-catalog';

function validIMDbRating(value: MediaItem['imdbRating']) {
  const score = Number(value);
  return Number.isFinite(score) && score > 0 && score <= 10;
}

/** Keep real catalog data when a more detailed provider response omits a field. */
export function mergeTitleDetails(summary?: MediaItem, detail?: MediaItem): MediaItem | undefined {
  if (!summary || !detail || summary.id !== detail.id || summary.type !== detail.type) return detail ?? summary;
  return {
    ...summary,
    ...Object.fromEntries(Object.entries(detail).filter(([, value]) => value !== undefined)),
    ...(validIMDbRating(summary.imdbRating) && !validIMDbRating(detail.imdbRating) ? { imdbRating: summary.imdbRating } : undefined),
  } as MediaItem;
}

type WordmarkPadding = { top: number; bottom: number };
const NO_PADDING: WordmarkPadding = { top: 0, bottom: 0 };

/**
 * Estimate transparent top/bottom margins from Expo Image's native ThumbHash.
 * The alpha channel contains a 5x5 low-frequency cosine transform. Its cx=0
 * coefficients describe average opacity across each row. This requires no extra
 * download, pixel buffer, or native dependency. The estimate is used only for
 * sizing and spacing; the complete original artwork is always rendered.
 */
export function estimateWordmarkPadding(thumbhash?: string): WordmarkPadding {
  if (!thumbhash || thumbhash.length > 64) return NO_PADDING;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  let bits = 0, value = 0;
  for (const character of thumbhash.replace(/=+$/, '')) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return NO_PADDING;
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 255);
    }
  }
  if (bytes.length < 6 || (bytes[2] & 128) === 0) return NO_PADDING;
  const landscape = (bytes[4] & 128) !== 0;
  const shortSide = Math.max(3, bytes[3] & 7);
  if (shortSide > 5) return NO_PADDING;
  const countAC = (nx: number, ny: number) => {
    let count = 0;
    for (let y = 0; y < ny; y++) {
      for (let x = y === 0 ? 1 : 0; x * ny < nx * (ny - y); x++) count++;
    }
    return count;
  };
  // Skip the luminance and the two chrominance channels.
  let index = countAC(landscape ? 5 : shortSide, landscape ? shortSide : 5) + 2 * countAC(3, 3);
  if (bytes.length < 6 + Math.ceil((index + countAC(5, 5)) / 2)) return NO_PADDING;
  const alphaDC = (bytes[5] & 15) / 15;
  const alphaScale = (bytes[5] >> 4) / 15;
  const vertical = [alphaDC];
  for (let y = 0; y < 5; y++) {
    for (let x = y === 0 ? 1 : 0; x + y < 5; x++, index++) {
      if (x === 0) vertical.push((((bytes[6 + (index >> 1)] >> ((index & 1) * 4)) & 15) / 7.5 - 1) * alphaScale);
    }
  }
  const samples = 48;
  const profile = Array.from({ length: samples }, (_, row) => Math.max(0,
    vertical.reduce((opacity, coefficient, frequency) => opacity + (frequency === 0 ? coefficient : 2 * coefficient * Math.cos(Math.PI * frequency * (row + 0.5) / samples)), 0),
  ));
  const peak = Math.max(...profile);
  if (peak < 0.08) return NO_PADDING;
  // Ignore faint DCT ringing but keep compensation conservative so decorative
  // details and unusual logos remain clear of the facts row.
  const visible = profile.map((opacity, row) => opacity >= Math.max(0.025, peak * 0.18) ? row : -1).filter(row => row >= 0);
  if (!visible.length) return NO_PADDING;
  return {
    top: Math.min(0.28, visible[0] / samples),
    bottom: Math.min(0.28, (samples - 1 - visible[visible.length - 1]) / samples),
  };
}

/** Optical size: give sparse, heavily padded wordmarks more room. */
export function detailWordmarkSize(availableWidth: number, roomy: boolean, aspect?: number, padding = NO_PADDING) {
  const maxWidth = Math.min(availableWidth * 0.94, roomy ? 460 : 360);
  const maxHeight = Math.min(roomy ? 164 : 136, (roomy ? 124 : 104) / Math.max(0.6, 1 - padding.top - padding.bottom));
  const validAspect = aspect && Number.isFinite(aspect) && aspect > 0 ? aspect : undefined;
  const height = validAspect ? Math.min(maxHeight, maxWidth / validAspect) : maxHeight;
  const width = validAspect ? height * validAspect : maxWidth;
  // Move the actual image down by the estimated transparent lower margin. No
  // pixels are clipped. Limit the adjustment to protect unusual artwork.
  return { width, height, bottomOffset: Math.min(height * padding.bottom, roomy ? 42 : 36) };
}

export function detailIdentityGap(roomy: boolean) {
  return roomy ? 24 : 18;
}

/** Reserve one compact value edge, without the old 82pt credit-label gutter. */
export function creditLabelWidth(hasDirector: boolean, fontScale: number) {
  return (hasDirector ? 56 : 48) * Math.max(1, fontScale);
}
