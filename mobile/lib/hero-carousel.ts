/** Pure, worklet-safe carousel math. Positive progress advances the gallery. */
export function carouselIndex(index: number, count: number): number {
  'worklet';
  return count > 0 ? ((index % count) + count) % count : 0;
}

export function dragProgress(previous: number, translation: number, distance: number): number {
  'worklet';
  return Math.max(-1, Math.min(1, previous + translation / Math.max(1, distance)));
}

export function snapDirection(progress: number, velocity: number, distance: number): -1 | 0 | 1 {
  'worklet';
  const projection = progress + velocity / Math.max(1, distance) * 0.15;
  if (projection >= 0.33) return 1;
  if (projection <= -0.33) return -1;
  return 0;
}

export function incomingIndex(base: number, direction: number, direct: number, count: number): number {
  'worklet';
  return direction > 0 && direct >= 0 ? direct : carouselIndex(base + (direction < 0 ? -1 : 1), count);
}

/** A cold incoming slide cannot participate in the blend until its entire
 * progressive artwork composition has decoded (or reached its error fallback). */
export function readySlideProgress<T extends number>(progress: T, base: number, direct: number, count: number, ready: readonly number[]): T | 0 {
  'worklet';
  return progress === 0 || ready.includes(incomingIndex(base, progress, direct, count)) ? progress : 0;
}

export function slideWeight(index: number, base: number, progress: number, direct: number, count: number): number {
  'worklet';
  const blend = Math.min(1, Math.abs(progress));
  if (index === base) return 1 - blend;
  return index === incomingIndex(base, progress, direct, count) ? blend : 0;
}
