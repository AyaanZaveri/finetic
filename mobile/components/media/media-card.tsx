import { ArtworkImage } from '@/components/media/artwork-image';
import { Text } from '@/components/ui/text';
import { triggerHaptic } from '@/lib/haptics';
import { mediaKey, type MediaItem } from '@/lib/home-catalog';
import { memo, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

interface MediaCardProps {
  item: MediaItem;
  width: number;
  onOpen: (item: MediaItem) => void;
  titleLines?: 1 | 2;
  showType?: boolean;
}

// Keep the spring on the UI thread, with the same tactile response on both OSes.
const PRESS_SPRING = { duration: 120, dampingRatio: 1, reduceMotion: ReduceMotion.System };
const RELEASE_SPRING = { duration: 300, dampingRatio: 0.8, reduceMotion: ReduceMotion.System };

export const MediaCard = memo(function MediaCard({ item, width, onOpen, titleLines = 1, showType = false }: MediaCardProps) {
  const scale = useSharedValue(1);
  const reducedMotion = useReducedMotion();
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const year = item.year?.toString() ?? item.releaseInfo;
  const type = item.type === 'series' ? 'TV Series' : 'Movie';
  const subtitle = [year, showType ? type : undefined].filter(Boolean).join(' · ');
  const id = mediaKey(item);

  // A virtualized grid can reuse this component for a different title.
  useEffect(() => { scale.set(1); }, [id, scale]);

  return (
    <Pressable testID={`media-card-${id}`} role="button" accessibilityLabel={`${item.name}${subtitle ? `, ${subtitle}` : ''}`} accessibilityHint="Open title details" style={{ width }}
      pressRetentionOffset={16}
      onPressIn={() => scale.set(withSpring(reducedMotion ? 1 : 0.97, PRESS_SPRING))}
      onPressOut={() => scale.set(withSpring(1, RELEASE_SPRING))}
      onPress={() => { triggerHaptic('selection'); onOpen(item); }}>
      <Animated.View style={animated}>
        <View className="overflow-hidden rounded-lg border-border bg-muted" style={[styles.poster, { borderWidth: StyleSheet.hairlineWidth }]}>
          <ArtworkImage uri={item.poster} fallback={item.background} recyclingKey={id} />
        </View>
        <View className="gap-0.5 pt-2">
          <Text className="text-sm font-nav-medium" numberOfLines={titleLines}>{item.name}</Text>
          {subtitle ? <Text className="text-xs text-muted-foreground" numberOfLines={1}>{subtitle}</Text> : null}
        </View>
      </Animated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({ poster: { aspectRatio: 2 / 3 } });
