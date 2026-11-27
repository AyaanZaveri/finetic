import { ProgressiveArtwork } from '@/components/effects/progressive-artwork';
import { GlassSurface } from '@/components/effects/glass-surface';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useHeroCarousel } from './use-hero-carousel';
import { slideWeight } from '@/lib/hero-carousel';
import { heroLayout } from '@/lib/hero-presentation';
import { mergeTitleDetails } from '@/lib/detail-presentation';
import { mediaKey, ratingLabel, resizeBackdrop, type MediaItem } from '@/lib/home-catalog';
import { titleQueryOptions, useTitleLogo, useTitlePrefetch } from '@/lib/title-cache';
import { useQuery } from '@tanstack/react-query';
import { THEME } from '@/lib/theme';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from 'expo-router';
import { ArrowRight, CalendarDays, Clock, Star, Tag } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useCallback, useLayoutEffect } from 'react';
import { I18nManager, PixelRatio, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { interpolateColor, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnUI } from 'react-native-worklets';

type BlendState = { base: SharedValue<number>; progress: SharedValue<number>; direct: SharedValue<number>; count: number };
const EMPTY: MediaItem[] = [];
const leading = I18nManager.isRTL ? 'right' : 'left';

function Wordmark({ item, light, roomy }: { item: MediaItem; light: boolean; roomy: boolean }) {
  const logo = useTitleLogo(item.logo);
  const fallback = <Text className="text-3xl font-nav-bold tracking-tight" role="heading" style={{ color: light ? '#0a0a0a' : '#ffffff', textAlign: roomy ? leading : 'center' }}>{item.name}</Text>;
  if (!item.logo) return fallback;
  // Keep the same title slot while a cold logo decodes. The shared ImageRef
  // cache lets the detail route reuse this image without a second decode.
  return <View style={[styles.wordmark, roomy && styles.roomyWordmark]}>
    {logo ? <Image source={Platform.OS === 'ios' ? item.logo : logo.image} cachePolicy="memory-disk" transition={0} tintColor={Platform.OS === 'ios' && light ? '#272727' : undefined} accessibilityLabel={item.name} style={StyleSheet.absoluteFill} contentFit="contain" contentPosition={roomy ? leading : 'center'} /> : fallback}
  </View>;
}

function HeroMetadata({ item, light, roomy }: { item: MediaItem; light: boolean; roomy: boolean }) {
  const theme = THEME[light ? 'light' : 'dark'];
  const rating = ratingLabel(item);
  const textColor = light ? theme.foreground : '#ffffffe6';
  const factIcon = light ? theme.mutedForeground : '#ffffff99';
  if (!rating && !item.year && !item.runtime && !item.genres?.length) return null;
  return (
    <View className="gap-1.5" style={{ alignItems: roomy ? 'flex-start' : 'center' }}>
      {(rating || item.year || item.runtime) && <View className="flex-row flex-wrap items-center gap-3" style={{ justifyContent: roomy ? 'flex-start' : 'center' }}>
        {rating && <View className="flex-row items-center gap-1.5"><Star color="#facc15" fill="#facc15" size={14} /><Text className="text-sm" style={{ color: textColor }}>{rating}</Text></View>}
        {item.year && <View className="flex-row items-center gap-1.5"><CalendarDays color={factIcon} size={14} /><Text className="text-sm" style={{ color: textColor }}>{item.year}</Text></View>}
        {item.runtime && <View className="flex-row items-center gap-1.5"><Clock color={factIcon} size={14} /><Text className="text-sm" style={{ color: textColor }}>{item.runtime}</Text></View>}
      </View>}
      {!!item.genres?.length && <View className="flex-row items-center gap-1.5 max-w-full" style={{ justifyContent: roomy ? 'flex-start' : 'center' }}>
        <Tag color={factIcon} size={14} /><Text className="text-sm shrink" style={{ color: textColor, textAlign: roomy ? leading : 'center' }} numberOfLines={2}>{item.genres.slice(0, 3).map((genre, index) => <Text key={`${genre}-${index}`} className="text-sm" style={{ color: textColor }}>{index > 0 && <Text className="text-sm" style={{ color: factIcon }}>{' · '}</Text>}{genre}</Text>)}</Text>
      </View>}
    </View>
  );
}

function ArtworkLayer({ background, index, light, blend, onArtworkReady }: {
  background: string | undefined; index: number; light: boolean; blend: BlendState;
  onArtworkReady: (index: number, ready: boolean) => void;
}) {
  const theme = THEME[light ? 'light' : 'dark'];
  const { base, progress, direct, count } = blend;
  const reveal = useSharedValue(0);
  const onReady = useCallback(() => {
    scheduleOnUI(() => {
      'worklet';
      reveal.set(base.get() === index ? withTiming(1, { duration: 300, reduceMotion: ReduceMotion.System }) : 1);
    });
    onArtworkReady(index, true);
  }, [base, index, onArtworkReady, reveal]);
  useLayoutEffect(() => {
    if (!background) onReady();
    return () => onArtworkReady(index, false);
  }, [background, index, onReady, onArtworkReady]);
  const animated = useAnimatedStyle(() => {
    // The outgoing image stays opaque underneath. The incoming opaque layer
    // blends over it only after its entire progressive blur is ready.
    const outgoing = index === base.get();
    return {
      opacity: reveal.get() * (outgoing ? 1 : slideWeight(index, base.get(), progress.get(), direct.get(), count)),
      zIndex: outgoing ? 0 : 1,
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }, animated]}>
      {background && <ProgressiveArtwork uri={background} backgroundColor={theme.background} light={light} prominentLightScrim quality="carousel" onReady={onReady} />}
    </Animated.View>
  );
}

function CopyLayer({ item, index, current, light, blend, roomy }: {
  item: MediaItem; index: number; current: boolean; light: boolean; blend: BlendState; roomy: boolean;
}) {
  const { base, progress, direct, count } = blend;
  const animated = useAnimatedStyle(() => ({
    opacity: slideWeight(index, base.get(), progress.get(), direct.get(), count),
  }));
  return <Animated.View testID={current ? `hero-current-${index}` : undefined} pointerEvents="none" importantForAccessibility={current ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!current}
    style={[styles.copyPanel, roomy && styles.roomyCopyPanel, !current && styles.copyOverlay, animated]}>
    <Wordmark key={mediaKey(item) + (item.logo ?? '')} item={item} light={light} roomy={roomy} />
    <HeroMetadata item={item} light={light} roomy={roomy} />
    {roomy && <View style={styles.roomyDescription}>
      {!!item.description && <Text numberOfLines={2} className="text-[15px] leading-5" style={{ color: light ? '#202020' : '#ffffffe0', textAlign: leading }}>{item.description}</Text>}
    </View>}
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
  const { top, left, right } = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const light = colorScheme !== 'dark';
  const focused = useIsFocused();
  const { selection, base, progress, direct, indices, choose, pan, onArtworkReady } = useHeroCarousel(items.length, width);
  const entry = items[selection % Math.max(1, items.length)];
  useTitlePrefetch(focused ? indices.map(index => items[index]).filter(Boolean) : EMPTY, 3);
  const detail = useQuery({ ...titleQueryOptions(entry?.type ?? 'movie', entry?.id ?? ''), enabled: !!entry, placeholderData: entry });
  const item = mergeTitleDetails(entry, detail.data);
  const layout = heroLayout(width, height, left, right);
  if (!item) return null;
  const blend = { base, progress, direct, count: items.length };
  const layers = indices.flatMap(index => {
    // Metadata can be enriched by a title lookup after the snap. Its backdrop
    // must not replace the catalog artwork that was already decoded mid-swipe.
    const catalogItem = items[index];
    const layer = index === selection ? item : catalogItem;
    return layer && catalogItem ? [{ index, item: layer, catalogItem }] : [];
  });
  return (
    <GestureDetector gesture={pan}>
      <View collapsable={false} testID="home-hero" style={{ minHeight: layout.height, paddingTop: top + 24, paddingBottom: 12, backgroundColor: theme.background, zIndex: Platform.OS === 'ios' ? 1 : undefined }} className="relative justify-end">
        {/* Clip only the artwork. Native glass shadows must fall naturally
            beyond the hero so they do not end in a visible horizontal seam. */}
        <View pointerEvents="none" style={styles.artworkStage}>
          {layers.filter(layer => focused || layer.index === selection).map(layer => {
            const background = resizeBackdrop(layer.catalogItem.background, 1280);
            return <ArtworkLayer key={mediaKey(layer.catalogItem) + ':' + (background ?? '')} background={background} index={layer.index} light={light} blend={blend} onArtworkReady={onArtworkReady} />;
          })}
          {layout.roomy && <LinearGradient style={[StyleSheet.absoluteFill, { zIndex: 2 }]} start={{ x: I18nManager.isRTL ? 1 : 0, y: 0.7 }} end={{ x: I18nManager.isRTL ? 0.2 : 0.8, y: 0.15 }}
            colors={light ? ['rgba(255,255,255,0.38)', 'rgba(255,255,255,0.14)', 'rgba(255,255,255,0)'] : ['rgba(10,10,10,0.44)', 'rgba(10,10,10,0.16)', 'rgba(10,10,10,0)']}
            locations={[0, 0.42, 1]} />}
          <LinearGradient style={[StyleSheet.absoluteFill, { zIndex: 2 }]} colors={['transparent', 'transparent', light ? 'rgba(255,255,255,0.04)' : 'rgba(10,10,10,0.16)', theme.background, theme.background]} locations={[0, 0.74, 0.89, 0.96, 1]} />
        </View>
        <View pointerEvents="none" style={[styles.artworkEnd, { backgroundColor: theme.background }]} />
        <View className="justify-end gap-2" style={{ width: '100%', alignItems: layout.roomy ? 'flex-start' : 'center', paddingLeft: layout.leadingPadding, paddingRight: layout.trailingPadding }}>
          <View style={{ width: '100%', maxWidth: layout.roomy ? layout.copyWidth : undefined }}>
            {layers.map(layer => <CopyLayer key={mediaKey(layer.item)} item={layer.item} index={layer.index} current={layer.index === selection} light={light} blend={blend} roomy={layout.roomy} />)}
          </View>
          <Button testID="hero-primary" size="default" haptic="impact" onPress={() => onOpen(item)} accessibilityLabel={`View ${item.name}`} containerClassName="mt-2" className="rounded-full min-h-11 px-4 py-2" style={{ backgroundColor: light ? '#0a0a0a' : '#ffffff' }}>
            <Text className="text-[15px] font-nav-medium" style={{ color: light ? '#ffffff' : '#0a0a0a' }}>View</Text><Icon as={ArrowRight} color={light ? '#ffffff' : '#0a0a0a'} size={16} />
          </Button>
          {items.length > 1 && <View className="flex-row items-center justify-center px-1.5" style={styles.carouselControls} accessibilityLabel="Featured titles">
            {Platform.OS === 'ios'
              ? <GlassSurface pointerEvents="none" style={[styles.carouselPill, { padding: 0 }]} fallbackStyle={{ borderWidth: 0, backgroundColor: theme.secondary }} />
              : <View pointerEvents="none" style={[styles.carouselPill, { backgroundColor: light ? '#0000000d' : '#ffffff0d' }]} />}
            {items.map((entry, index) => <SlideDot key={mediaKey(entry)} item={entry} index={index} selected={index === selection} light={light} blend={blend} onChoose={choose} />)}
          </View>}
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wordmark: { maxWidth: 330, width: '100%', minHeight: 86, alignItems: 'center', justifyContent: 'center' },
  roomyWordmark: { maxWidth: 400, minHeight: 100, alignItems: 'flex-start' },
  artworkStage: { position: 'absolute', top: 0, start: 0, end: 0, bottom: 4, overflow: 'hidden' },
  artworkEnd: { position: 'absolute', start: 0, end: 0, bottom: 0, height: 5 },
  copyPanel: { alignItems: 'center', justifyContent: 'flex-end', gap: 14, width: '100%' },
  roomyDescription: { minHeight: 40, width: '100%' },
  roomyCopyPanel: { alignItems: 'flex-start' },
  copyOverlay: { position: 'absolute', bottom: 0, start: 0, end: 0 },
  carouselControls: { marginTop: 2, minHeight: 44, alignSelf: 'center' },
  carouselPill: { position: 'absolute', start: 0, end: 0, top: 6, bottom: 6, borderRadius: 999 },
  dotButton: { minWidth: 24, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
