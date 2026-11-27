import { ArtworkImage } from '@/components/media/artwork-image';
import { Text } from '@/components/ui/text';
import { triggerHaptic } from '@/lib/haptics';
import { pressScale } from '@/lib/interaction-policy';
import { mediaKey, type MediaItem } from '@/lib/home-catalog';
import { memo } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

interface MediaCardProps {
  item: MediaItem;
  width: number;
  onOpen: (item: MediaItem) => void;
}

export const MediaCard = memo(function MediaCard({ item, width, onOpen }: MediaCardProps) {
  const scale = useSharedValue(1);
  const reducedMotion = useReducedMotion();
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const year = item.year?.toString() ?? item.releaseInfo;
  const id = mediaKey(item);
  return (
    <Pressable testID={`media-card-${id}`} role="button" accessibilityLabel={`${item.name}${year ? `, ${year}` : ''}`} style={{ width }}
      onPressIn={() => scale.set(withTiming(pressScale(Platform.OS, reducedMotion), { duration: 110, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System }))}
      onPressOut={() => scale.set(withTiming(1, { duration: 150, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System }))}
      onPress={() => { triggerHaptic('selection'); onOpen(item); }}>
      <Animated.View style={animated}>
        <View className="overflow-hidden rounded-lg border-border bg-muted" style={[styles.poster, { borderWidth: StyleSheet.hairlineWidth }]}>
          <ArtworkImage uri={item.poster} fallback={item.background} recyclingKey={id} />
        </View>
        <View className="gap-0.5 pt-2">
          <Text className="text-sm font-nav-medium" numberOfLines={2}>{item.name}</Text>
          {year && <Text className="text-xs text-muted-foreground" numberOfLines={1}>{year}</Text>}
        </View>
      </Animated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({ poster: { aspectRatio: 2 / 3 } });
