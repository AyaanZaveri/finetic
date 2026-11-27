import { GlassSurface } from '@/components/effects/glass-surface';
import { Text } from '@/components/ui/text';
import { triggerHaptic } from '@/lib/haptics';
import type { SearchFilter } from '@/lib/search-presentation';
import { THEME } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { useColorScheme } from 'nativewind';
import { useEffect, useState } from 'react';
import { I18nManager, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

const filters: { value: SearchFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'movie', label: 'Movies' },
  { value: 'series', label: 'TV shows' },
];
const INSET = 4;

export function SearchFilters({ value, counts, onChange }: {
  value: SearchFilter;
  counts: Record<SearchFilter, number>;
  onChange: (value: SearchFilter) => void;
}) {
  const { colorScheme } = useColorScheme();
  const { fontScale } = useWindowDimensions();
  const theme = THEME[colorScheme ?? 'light'];
  const [width, setWidth] = useState(0);
  const selectedIndex = filters.findIndex(filter => filter.value === value);
  const segmentWidth = Math.max(0, width - INSET * 2) / filters.length;
  const position = useSharedValue(selectedIndex);
  const direction = I18nManager.isRTL ? -1 : 1;
  useEffect(() => {
    position.set(withSpring(selectedIndex, { duration: 240, dampingRatio: 1, reduceMotion: ReduceMotion.System }));
  }, [position, selectedIndex]);
  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: position.get() * segmentWidth * direction }] }));
  // The indicator is separate from the labels so rapid taps can interrupt the spring without changing layout.
  return <View className="w-full flex-row rounded-full bg-muted" style={styles.track}
    onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)} accessible={false}>
    {segmentWidth > 0 && <Animated.View pointerEvents="none" style={[styles.indicator, { width: segmentWidth }, indicator]}>
      {Platform.OS === 'ios'
        ? <GlassSurface style={styles.glass} fallbackStyle={{ backgroundColor: theme.background }} />
        : <View style={[styles.glass, { backgroundColor: theme.background }]} />}
    </Animated.View>}
    {filters.map(filter => {
      const selected = filter.value === value;
      const count = counts[filter.value];
      // The result counts stay available to assistive technology, without crowding the labels.
      const labelColor = selected ? theme.foreground : theme.mutedForeground;
      const compactLabel = filter.value === 'series' && segmentWidth > 0 && segmentWidth - 16 < 56 * fontScale;
      return <Pressable key={filter.value} testID={`search-filter-${filter.value}`} role="tab"
        accessibilityLabel={`${filter.label}, ${count} ${count === 1 ? 'title' : 'titles'}`} accessibilityState={{ selected }}
        className="min-h-11 min-w-0 flex-1 items-center justify-center rounded-full px-2 py-2 active:opacity-70"
        onPress={() => { if (!selected) { triggerHaptic('selection'); onChange(filter.value); } }}>
        <Text className={cn('text-sm font-nav-medium', selected && 'font-nav-semibold')} style={{ color: labelColor }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{compactLabel ? 'TV' : filter.label}</Text>
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  track: { padding: INSET },
  indicator: { position: 'absolute', start: INSET, top: INSET, bottom: INSET },
  glass: { flex: 1, borderRadius: 999, padding: 0, borderWidth: 0 },
});
