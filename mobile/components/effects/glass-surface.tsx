import { THEME } from '@/lib/theme';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useColorScheme } from 'nativewind';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

type GlassSurfaceProps = ViewProps & {
  isInteractive?: boolean;
  tintColor?: string;
  fallbackStyle?: StyleProp<ViewStyle>;
};

/** Native glass for controls, with a legible solid surface on other devices. */
export function GlassSurface({ children, style, isInteractive, tintColor, fallbackStyle, ...props }: GlassSurfaceProps) {
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
    return <GlassView {...props} glassEffectStyle="regular" isInteractive={isInteractive} tintColor={tintColor} colorScheme={colorScheme ?? 'light'} style={[styles.surface, style]}>{children}</GlassView>;
  }
  return <View {...props} style={[styles.surface, { backgroundColor: theme.card, borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth }, style, fallbackStyle]}>{children}</View>;
}

const styles = StyleSheet.create({ surface: { borderRadius: 16, padding: 12 } });
