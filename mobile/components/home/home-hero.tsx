import { ProgressiveArtwork } from '@/components/effects/progressive-artwork';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useHeroCarousel } from './use-hero-carousel';
import { slideWeight } from '@/lib/hero-carousel';
import { mediaKey, ratingLabel, resizeBackdrop, type MediaItem } from '@/lib/home-catalog';
import { loadTitle } from '@/lib/home-api';
import { useQuery } from '@tanstack/react-query';
import { THEME } from '@/lib/theme';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight, CalendarDays, Clock, Star, Tag } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useState } from 'react';
import { PixelRatio, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { interpolateColor, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type BlendState = { base: SharedValue<number>; progress: SharedValue<number>; direct: SharedValue<number>; count: number };

function Wordmark({ item, light }: { item: MediaItem; light: boolean }) {
  const [failed, setFailed] = useState(false);
  if (item.logo && !failed) {
    return <Image source={item.logo} accessibilityLabel={item.name} style={styles.wordmark} tintColor={light ? '#272727' : undefined} contentFit="contain" cachePolicy="memory-disk" onError={() => setFailed(true)} />;
  }
  return <Text className="text-center text-3xl font-nav-bold tracking-tight" role="heading" style={{ color: light ? '#0a0a0a' : '#ffffff' }}>{item.name}</Text>;
}

function HeroMetadata({ item, light }: { item: MediaItem; light: boolean }) {
  const theme = THEME[light ? 'light' : 'dark'];
  const rating = ratingLabel(item);
  const textColor = light ? theme.foreground : '#ffffffe6';
  const factIcon = light ? theme.mutedForeground : '#ffffff99';
  if (!rating && !item.year && !item.runtime && !item.genres?.length) return null;
  return (
    <View className="items-center gap-1.5">
      {(rating || item.year || item.runtime) && <View className="flex-row flex-wrap items-center justify-center gap-3">
        {rating && <View className="flex-row items-center gap-1.5"><Star color="#facc15" fill="#facc15" size={14} /><Text className="text-sm" style={{ color: textColor }}>{rating}</Text></View>}
        {item.year && <View className="flex-row items-center gap-1.5"><CalendarDays color={factIcon} size={14} /><Text className="text-sm" style={{ color: textColor }}>{item.year}</Text></View>}
        {item.runtime && <View className="flex-row items-center gap-1.5"><Clock color={factIcon} size={14} /><Text className="text-sm" style={{ color: textColor }}>{item.runtime}</Text></View>}
      </View>}
      {!!item.genres?.length && <View className="flex-row justify-center items-center gap-1.5 max-w-full">
        <Tag color={factIcon} size={14} /><Text className="text-center text-sm shrink" style={{ color: textColor }} numberOfLines={2}>{item.genres.slice(0, 3).join('  ·  ')}</Text>
      </View>}
    </View>
  );
}

function ArtworkLayer({ item, index, current, light, blend }: {
  item: MediaItem; index: number; current: boolean; light: boolean; blend: BlendState;
}) {
  const theme = THEME[light ? 'light' : 'dark'];
  const background = resizeBackdrop(item.background, 1280);
  const { base, progress, direct, count } = blend;
  const animated = useAnimatedStyle(() => {
    // The outgoing image stays opaque underneath. The incoming opaque layer
    // blends over it, so 50% progress is a true 50/50 image blend.
    return { opacity: index === base.get() ? 1 : slideWeight(index, base.get(), progress.get(), direct.get(), count), zIndex: index === base.get() ? 0 : 1 };
  });
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }, animated]}>
      {background && <ProgressiveArtwork key={background} uri={background} backgroundColor={theme.background} light={light} prominentLightScrim quality={current ? 'full' : 'preview'} />}
    </Animated.View>
  );
}

function CopyLayer({ item, index, current, light, blend }: {
  item: MediaItem; index: number; current: boolean; light: boolean; blend: BlendState;
}) {
  const { base, progress, direct, count } = blend;
  const animated = useAnimatedStyle(() => ({
    opacity: slideWeight(index, base.get(), progress.get(), direct.get(), count),
  }));
  return <Animated.View testID={current ? `hero-current-${index}` : undefined} pointerEvents="none" importantForAccessibility={current ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!current}
    style={[styles.copyPanel, !current && styles.copyOverlay, animated]}>
    <Wordmark key={mediaKey(item) + (item.logo ?? '')} item={item} light={light} />
    <HeroMetadata item={item} light={light} />
  </Animated.View>;
}

function SlideDot({ item, index, selected, light, blend, onChoose }: {
  item: MediaItem; index: number; selected: boolean; light: boolean; blend: BlendState; onChoose: (index: number) => void;
}) {
  const diameter = PixelRatio.roundToNearestPixel(6);
  const capsule = PixelRatio.roundToNearestPixel(16);
  const { base, progress, direct, count } = blend;
  const inactive = light ? '#00000042' : '#ffffff70';
  const active = light ? '#202020' : '#ffffff';
  const animated = useAnimatedStyle(() => {
    const weight = slideWeight(index, base.get(), progress.get(), direct.get(), count);
    return {
      width: diameter + (capsule - diameter) * weight,
      backgroundColor: interpolateColor(weight, [0, 1], [inactive, active]),
    };
  });
  return <Pressable accessibilityLabel={`Featured title ${index + 1}: ${item.name}`} accessibilityState={{ selected }} role="button" testID={`hero-slide-${index}`}
    onPress={() => onChoose(index)} style={styles.dotButton}>
    <Animated.View style={[{ position: 'absolute', height: diameter, borderRadius: diameter / 2 }, animated]} />
  </Pressable>;
}

export function HomeHero({ items, onOpen }: { items: MediaItem[]; onOpen: (item: MediaItem) => void }) {
  const { width, height } = useWindowDimensions();
  const { top } = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const light = colorScheme !== 'dark';
  const { selection, base, progress, direct, indices, choose, pan } = useHeroCarousel(items.length, width);
  const entry = items[selection % Math.max(1, items.length)];
  const detail = useQuery({ queryKey: ['title', entry?.type, entry?.id], queryFn: ({ signal }) => loadTitle(entry!.type, entry!.id, signal),
    enabled: !!entry, placeholderData: entry, staleTime: 5 * 60 * 1000, retry: false });
  const item = detail.data ?? entry;
  const heroHeight = width >= 768
    ? Math.min(520, Math.max(384, Math.min(width * 0.52, height * 0.60)))
    : Math.min(704, Math.max(480, Math.min(width * 1.34, height * 0.8)));
  if (!item) return null;
  const blend = { base, progress, direct, count: items.length };
  const layers = indices.flatMap(index => {
    const layer = index === selection ? item : items[index];
    return layer ? [{ index, item: layer }] : [];
  });
  return (
    <GestureDetector gesture={pan}>
      <View collapsable={false} testID="home-hero" style={{ minHeight: heroHeight, paddingTop: top + 24, paddingBottom: 12, backgroundColor: theme.background }} className="relative overflow-hidden justify-end">
        <View pointerEvents="none" style={styles.artworkStage}>
          {layers.map(layer => <ArtworkLayer key={mediaKey(layer.item)} item={layer.item} index={layer.index} current={layer.index === selection} light={light} blend={blend} />)}
          <LinearGradient style={[StyleSheet.absoluteFill, { zIndex: 2 }]} colors={['transparent', 'transparent', light ? 'rgba(255,255,255,0.04)' : 'rgba(10,10,10,0.16)', theme.background, theme.background]} locations={[0, 0.74, 0.89, 0.96, 1]} />
        </View>
        <View pointerEvents="none" style={[styles.artworkEnd, { backgroundColor: theme.background }]} />
        <View className="items-center justify-end gap-2 px-4" style={{ width: '100%' }}>
          <View style={{ width: '100%' }}>
            {layers.map(layer => <CopyLayer key={mediaKey(layer.item)} item={layer.item} index={layer.index} current={layer.index === selection} light={light} blend={blend} />)}
          </View>
          <Button testID="hero-primary" size="default" haptic="impact" onPress={() => onOpen(item)} accessibilityLabel={`View ${item.name}`} containerClassName="mt-2" className="rounded-full min-h-11 px-4 py-2" style={{ backgroundColor: light ? '#0a0a0a' : '#ffffff' }}>
            <Text className="text-[15px] font-nav-medium" style={{ color: light ? '#ffffff' : '#0a0a0a' }}>View</Text><Icon as={ArrowRight} color={light ? '#ffffff' : '#0a0a0a'} size={16} />
          </Button>
          {items.length > 1 && <View className="flex-row items-center justify-center px-1.5" style={styles.carouselControls} accessibilityLabel="Featured titles">
            <View pointerEvents="none" style={[styles.carouselPill, { backgroundColor: light ? '#0000000d' : '#ffffff0d' }]} />
            {items.map((entry, index) => <SlideDot key={mediaKey(entry)} item={entry} index={index} selected={index === selection} light={light} blend={blend} onChoose={choose} />)}
          </View>}
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wordmark: { maxWidth: 330, width: '100%', height: 86 },
  artworkStage: { position: 'absolute', top: 0, start: 0, end: 0, bottom: 4, overflow: 'hidden' },
  artworkEnd: { position: 'absolute', start: 0, end: 0, bottom: 0, height: 5 },
  copyPanel: { alignItems: 'center', justifyContent: 'flex-end', gap: 8, width: '100%' },
  copyOverlay: { position: 'absolute', bottom: 0, start: 0, end: 0 },
  carouselControls: { marginTop: 2, minHeight: 44 },
  carouselPill: { position: 'absolute', start: 0, end: 0, top: 6, bottom: 6, borderRadius: 999 },
  dotButton: { minWidth: 24, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
