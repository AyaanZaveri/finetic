export type HapticFeedback = 'none' | 'selection' | 'impact' | 'carousel';

export function hapticAction(platform: string, feedback: HapticFeedback) {
  if (feedback === 'none') return null;
  if (platform === 'android') return feedback === 'carousel' ? 'android-carousel' : feedback === 'selection' ? 'android-selection' : 'android-impact';
  if (platform === 'ios') return feedback === 'selection' || feedback === 'carousel' ? 'ios-selection' : 'ios-impact';
  return null;
}

export function pressScale(platform: string, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  return platform === 'android' ? 0.95 : 0.97;
}
