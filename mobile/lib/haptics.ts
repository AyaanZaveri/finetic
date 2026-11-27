import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { hapticAction, type HapticFeedback } from './interaction-policy';

export type { HapticFeedback } from './interaction-policy';

/** Feedback is opt-in per committed action. Hardware support never gates input. */
export function triggerHaptic(feedback: HapticFeedback) {
  switch (hapticAction(Platform.OS, feedback)) {
    case 'android-carousel':
      void Haptics.performAndroidHapticsAsync(Number(Platform.Version) >= 34 ? Haptics.AndroidHaptics.Segment_Tick : Haptics.AndroidHaptics.Clock_Tick).catch(() => {});
      break;
    case 'android-selection':
      void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Clock_Tick).catch(() => {});
      break;
    case 'android-impact':
      void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Context_Click).catch(() => {});
      break;
    case 'ios-selection':
      void Haptics.selectionAsync().catch(() => {});
      break;
    case 'ios-impact':
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      break;
  }
}
