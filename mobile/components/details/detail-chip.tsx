import { GlassSurface } from '@/components/effects/glass-surface';
import { TextClassContext } from '@/components/ui/text';
import { THEME } from '@/lib/theme';
import { useColorScheme } from 'nativewind';
import { Platform, StyleSheet, View, type ViewProps } from 'react-native';

type DetailChipProps = ViewProps & { material?: boolean };

/** A compact, non-interactive label. The glass treatment is reserved for headline facts. */
export function DetailChip({ children, style, material = true, ...props }: DetailChipProps) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const surfaceStyle = [styles.chip, style];
  // The detail body is already a solid theme surface. On Android, a blur
  // would sample the same color (or recursively sample the containing scroll
  // view). Use the quiet, filled equivalent instead.
  return (
    <TextClassContext.Provider value="text-xs font-nav-medium text-secondary-foreground shrink">
      {material && Platform.OS === 'ios'
        ? <GlassSurface {...props} style={surfaceStyle} fallbackStyle={{ backgroundColor: theme.secondary, borderWidth: 0 }}>{children}</GlassSurface>
        : <View {...props} style={[{ backgroundColor: theme.secondary }, surfaceStyle]}>{children}</View>}
    </TextClassContext.Provider>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 1,
    maxWidth: '100%',
    minHeight: 24,
    borderRadius: 999,
    gap: 4,
    padding: 0,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
});
