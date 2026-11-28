// A static radius ramp. Slides use the same two masks before, during and
// after a gesture so our crossfade is between finished artwork composites.
const BLUR_LAYERS = [
  { radius: 4, start: 0.42, end: 0.68 },
  { radius: 12, start: 0.58, end: 0.82 },
  { radius: 24, start: 0.72, end: 0.96 },
] as const;
const COMPACT_LAYERS = [BLUR_LAYERS[0], BLUR_LAYERS[2]] as const;

export type ArtworkQuality = 'full' | 'carousel';

export function artworkBlurLayers(quality: ArtworkQuality, platform: string) {
  return quality === 'carousel' || platform === 'android' ? COMPACT_LAYERS : BLUR_LAYERS;
}

/** Protect dark system icons in light mode without whitening the full image. */
export function lightArtworkTopScrim(topInset: number) {
  const protectedHeight = Math.max(24, topInset);
  const height = protectedHeight + 72;
  return {
    height,
    colors: ['rgba(255,255,255,0.68)', 'rgba(255,255,255,0.60)', 'rgba(255,255,255,0.24)', 'rgba(255,255,255,0)'] as const,
    locations: [0, protectedHeight / height, (protectedHeight + 28) / height, 1] as const,
  };
}

/** True only when the final unique native image layer has finished displaying. */
export function createArtworkLoadTracker(parts: number) {
  const settled = new Set<number>();
  return (part: number) => {
    if (part < 0 || part >= parts || settled.has(part)) return false;
    settled.add(part);
    return settled.size === parts;
  };
}
