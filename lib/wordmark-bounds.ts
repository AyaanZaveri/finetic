export interface WordmarkBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Solid lettering has more visual weight than sparse text and decorative trails. */
export function getWordmarkDensity(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  bounds: WordmarkBounds,
): number {
  let coverage = 0;
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (pixels[offset] > 32) coverage += pixels[offset] / 255;
  }
  return coverage / Math.max(1, width * height * bounds.width * bounds.height);
}

/** Dim pale ink on light artwork without flattening the logo's color or detail. */
export function getWordmarkLightBrightness(pixels: ArrayLike<number>): number | undefined {
  const tones = new Uint32Array(256);
  let visible = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] < 128) continue;
    const tone = Math.round(pixels[offset] * .2126 + pixels[offset + 1] * .7152 + pixels[offset + 2] * .0722);
    tones[tone]++;
    visible++;
  }
  if (!visible) return undefined;

  // Ignore isolated highlights and small badges when choosing the main ink tone.
  const targetTone = 112;
  const upperQuartile = Math.ceil(visible * .75);
  let count = 0;
  for (let tone = 0; tone < tones.length; tone++) {
    count += tones[tone];
    if (count >= upperQuartile) return tone > targetTone ? targetTone / tone : 1;
  }
}

/** Normalized visible bounds; transparent canvas padding should not determine logo size. */
export function getWordmarkBounds(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
): WordmarkBounds | null {
  if (width < 1 || height < 1) return null;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] <= 32) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return null;
  // A sample pixel of breathing room protects soft edges from being clipped.
  left = Math.max(0, left - 1);
  top = Math.max(0, top - 1);
  right = Math.min(width, right + 2);
  bottom = Math.min(height, bottom + 2);
  return {
    left: left / width,
    top: top / height,
    width: (right - left) / width,
    height: (bottom - top) / height,
  };
}
