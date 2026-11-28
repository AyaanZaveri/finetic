import { GlassSurface } from '@/components/effects/glass-surface';
import { Button, type ButtonProps } from '@/components/ui/button';
import { THEME } from '@/lib/theme';
import { useColorScheme } from 'nativewind';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';

/** Reuse the same native iOS glass material for locally owned action buttons. */
export function GlassButton({ surfaceStyle, glassAppearance, glassTintColor, androidVariant = 'secondary', className, ...props }: ButtonProps & {
  surfaceStyle?: StyleProp<ViewStyle>;
  glassAppearance?: 'light' | 'dark';
  glassTintColor?: string;
  androidVariant?: ButtonProps['variant'];
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[glassAppearance ?? colorScheme ?? 'light'];
  if (Platform.OS !== 'ios') return <Button {...props} variant={androidVariant} className={className} />;
  return <GlassSurface isInteractive={!props.disabled} appearance={glassAppearance} tintColor={glassTintColor} style={[{ borderRadius: 999, padding: 0 }, surfaceStyle]}
    fallbackStyle={{ backgroundColor: theme.secondary, borderWidth: 0 }}>
    <Button {...props} variant="ghost" className={className} style={[{ backgroundColor: 'transparent', borderWidth: 0 }, props.style]} />
  </GlassSurface>;
}
