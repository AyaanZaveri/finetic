import { ProgressiveArtwork } from '@/components/effects/progressive-artwork';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { triggerHaptic } from '@/lib/haptics';

function Wordmark({ item, light }: { item: MediaItem; light: boolean }) {
  const [failed, setFailed] = useState(false);
  if (item.logo && !failed) {
    return <Image source={item.logo} accessibilityLabel={item.name} style={styles.wordmark} tintColor={light ? "#272727" : undefined} contentFit="contain" cachePolicy="memory-disk" onError={() => setFailed(true)} />;
  }
  return <Text className="text-center text-3xl font-nav-bold tracking-tight" role="heading" style={{ color: light ? "#0a0a0a" : "#ffffff" }}>{item.name}</Text>;
}

export function HomeHero({ items, onOpen }: { items: MediaItem[]; onOpen: (item: MediaItem) => void }) {
  const [selection, setSelection] = useState(0);
  const { width, height } = useWindowDimensions();
  const { top } = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const light = colorScheme !== "dark";
  const entry = items[selection % Math.max(1, items.length)];
  const detail = useQuery({ queryKey: ['title', entry?.type, entry?.id], queryFn: ({ signal }) => loadTitle(entry!.type, entry!.id, signal),
    enabled: !!entry, placeholderData: entry, staleTime: 5 * 60 * 1000, retry: false });
  const item = detail.data ?? entry;
  const heroHeight = Math.min(704, Math.max(480, Math.min(width * 1.34, height * 0.8)));
  if (!item) return null;
  const background = resizeBackdrop(item.background, 1280);
  const rating = ratingLabel(item);
  const textColor = light ? theme.foreground : '#ffffffe6';
  const factIcon = light ? theme.mutedForeground : '#ffffff99';
  const dotDiameter = PixelRatio.roundToNearestPixel(6);
  return (
    <View testID="home-hero" style={{ minHeight: heroHeight, paddingTop: top + 24, paddingBottom: 12, backgroundColor: theme.background }} className="relative overflow-hidden justify-end">
      <View pointerEvents="none" style={styles.artworkStage}>
        {background && <ProgressiveArtwork key={background} uri={background} backgroundColor={theme.background} light={light} prominentLightScrim />}
        <LinearGradient style={StyleSheet.absoluteFill} colors={['transparent', 'transparent', light ? 'rgba(255,255,255,0.04)' : 'rgba(10,10,10,0.16)', theme.background, theme.background]} locations={[0, 0.74, 0.89, 0.96, 1]} />
      </View>
      {/* End the artwork before the catalog so native mask rounding cannot
          expose a row of source pixels along the bottom edge. */}
      <View pointerEvents="none" style={[styles.artworkEnd, { backgroundColor: theme.background }]} />
      <View className="items-center justify-end gap-2 px-4" style={{ width: '100%' }}>
        <Wordmark key={mediaKey(item)} item={item} light={light} />
        {(rating || item.year || item.runtime || !!item.genres?.length) && <View className="items-center gap-1.5">
          {(rating || item.year || item.runtime) && <View className="flex-row flex-wrap items-center justify-center gap-3">
            {rating && <View className="flex-row items-center gap-1.5"><Star color="#facc15" fill="#facc15" size={14} /><Text className="text-sm" style={{ color: textColor }}>{rating}</Text></View>}
            {item.year && <View className="flex-row items-center gap-1.5"><CalendarDays color={factIcon} size={14} /><Text className="text-sm" style={{ color: textColor }}>{item.year}</Text></View>}
            {item.runtime && <View className="flex-row items-center gap-1.5"><Clock color={factIcon} size={14} /><Text className="text-sm" style={{ color: textColor }}>{item.runtime}</Text></View>}
          </View>}
          {!!item.genres?.length && <View className="flex-row justify-center items-center gap-1.5 max-w-full">
            <Tag color={factIcon} size={14} /><Text className="text-center text-sm shrink" style={{ color: textColor }} numberOfLines={2}>{item.genres.slice(0, 3).join('  ·  ')}</Text>
          </View>}
        </View>}
        <Button testID="hero-primary" size="default" haptic="impact" onPress={() => onOpen(item)} accessibilityLabel={`View ${item.name}`} containerClassName="mt-2" className="rounded-full min-h-11 px-4 py-2" style={{ backgroundColor: light ? "#0a0a0a" : "#ffffff" }}>
          <Text className="text-[15px] font-nav-medium" style={{ color: light ? "#ffffff" : "#0a0a0a" }}>View</Text><Icon as={ArrowRight} color={light ? "#ffffff" : "#0a0a0a"} size={16} />
        </Button>
        {items.length > 1 && <View className="flex-row items-center justify-center px-1.5" style={styles.carouselControls} accessibilityLabel="Featured titles">
          <View pointerEvents="none" style={[styles.carouselPill, { backgroundColor: light ? "#0000000d" : "#ffffff0d" }]} />
          {items.map((entry, index) => <Pressable key={mediaKey(entry)} accessibilityLabel={`Featured title ${index + 1}: ${entry.name}`} accessibilityState={{ selected: index === selection }} role="button" testID={`hero-slide-${index}`}
            onPress={() => { if (index !== selection) { triggerHaptic('selection'); setSelection(index); } }} style={styles.dotButton}>
            <View style={{ height: dotDiameter, width: index === selection ? PixelRatio.roundToNearestPixel(16) : dotDiameter, borderRadius: dotDiameter / 2, backgroundColor: light ? (index === selection ? '#202020' : '#00000042') : (index === selection ? '#fff' : '#ffffff70') }} />
          </Pressable>)}
        </View>}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  wordmark: { maxWidth: 330, width: '100%', height: 86 },
  artworkStage: { position: 'absolute', top: 0, start: 0, end: 0, bottom: 4, overflow: 'hidden' },
  artworkEnd: { position: 'absolute', start: 0, end: 0, bottom: 0, height: 5 },
  carouselControls: { marginTop: 10, minHeight: 44 },
  carouselPill: { position: 'absolute', start: 0, end: 0, top: 6, bottom: 6, borderRadius: 999 },
  dotButton: { minWidth: 24, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
