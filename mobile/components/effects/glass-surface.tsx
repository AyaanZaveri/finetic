import { THEME } from '@/lib/theme';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useColorScheme } from 'nativewind';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View, type ViewProps } from 'react-native';

/** Native glass is reserved for floating controls. The fallback is a legible solid surface. */
export function GlassSurface({ children, style, ...props }: ViewProps) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const [reduceTransparency, setReduceTransparency] = useState(true);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let active = true;
    let updated = false;
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', (value) => {
      updated = true;
      setReduceTransparency(value);
    });
    void AccessibilityInfo.isReduceTransparencyEnabled().then((value) => {
      if (active && !updated) setReduceTransparency(value);
    }).catch(() => {});
    return () => { active = false; sub.remove(); };
  }, []);
  const available = Platform.OS === 'ios' && !reduceTransparency && isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
  if (available) {
    return <GlassView {...props} glassEffectStyle="regular" colorScheme={colorScheme ?? 'light'} style={[styles.surface, style]}>{children}</GlassView>;
  }
  return <View {...props} style={[styles.surface, { backgroundColor: theme.card, borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth }, style]}>{children}</View>;
}

const styles = StyleSheet.create({ surface: { borderRadius: 16, padding: 12 } });
