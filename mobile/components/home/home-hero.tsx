import { ProgressiveArtwork } from '@/components/effects/progressive-artwork';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { mediaKey, ratingLabel, resizeBackdrop, type MediaItem } from '@/lib/home-catalog';
import { THEME } from '@/lib/theme';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight, Star } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { triggerHaptic } from '@/lib/haptics';

function Wordmark({ item, light }: { item: MediaItem; light: boolean }) {
  const [failed, setFailed] = useState(false);
  if (item.logo && !failed) {
    return <Image source={item.logo} accessibilityLabel={item.name} style={styles.wordmark} tintColor={light ? "#666666" : undefined} contentFit="contain" cachePolicy="memory-disk" onError={() => setFailed(true)} />;
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
  const item = items[selection % Math.max(1, items.length)];
  const heroHeight = Math.min(704, Math.max(480, Math.min(width * 1.34, height * 0.8)));
  if (!item) return null;
  const background = resizeBackdrop(item.background, 1280);
  const rating = ratingLabel(item);
  return (
    <View testID="home-hero" style={{ minHeight: heroHeight, paddingTop: top + 24, paddingBottom: 12, backgroundColor: theme.background }} className="relative overflow-hidden justify-end">
      {background && <ProgressiveArtwork key={background} uri={background} backgroundColor={theme.background} light={light} />}
      <LinearGradient pointerEvents="none" style={StyleSheet.absoluteFill} colors={['transparent', 'transparent', colorScheme === 'dark' ? 'rgba(10,10,10,0.16)' : 'rgba(255,255,255,0.04)', theme.background]} locations={[0, 0.74, 0.91, 1]} />
      <View className="items-center justify-end gap-2 px-4" style={{ width: '100%' }}>
        <Wordmark key={mediaKey(item)} item={item} light={light} />
        <View className="items-center gap-1.5">
          <View className="flex-row flex-wrap items-center justify-center gap-3">
            {rating && <View className="flex-row items-center gap-1"><Star color="#facc15" fill="#facc15" size={14} /><Text className="text-sm font-nav-medium" style={{ color: light ? theme.foreground : "#ffffff" }}>{rating}</Text></View>}
            {item.year && <Text className="text-sm" style={{ color: light ? theme.foreground : "#ffffffe6" }}>{item.year}</Text>}
            <Text className="text-sm" style={{ color: light ? theme.foreground : "#ffffffe6" }}>{item.type === 'movie' ? 'Movie' : 'TV Show'}</Text>
          </View>
          {!!item.genres?.length && <Text className="text-center text-sm" style={{ color: light ? theme.foreground : "#ffffffe6" }} numberOfLines={2}>{item.genres.slice(0, 3).join('  ·  ')}</Text>}
        </View>
        <Button testID="hero-primary" size="default" haptic="impact" onPress={() => onOpen(item)} accessibilityLabel={`View ${item.name}`} containerClassName="mt-1" className="rounded-full min-h-11 px-4 py-2" style={{ backgroundColor: light ? "#0a0a0a" : "#ffffff" }}>
          <Text className="text-[15px] font-nav-medium" style={{ color: light ? "#ffffff" : "#0a0a0a" }}>View</Text><Icon as={ArrowRight} color={light ? "#ffffff" : "#0a0a0a"} size={16} />
        </Button>
        {items.length > 1 && <View className="flex-row items-center justify-center rounded-full px-1.5" accessibilityLabel="Featured titles" style={{ backgroundColor: light ? "#0000000d" : "#ffffff0d" }}>
          {items.map((entry, index) => <Pressable key={mediaKey(entry)} accessibilityLabel={`Featured title ${index + 1}: ${entry.name}`} accessibilityState={{ selected: index === selection }} role="button" testID={`hero-slide-${index}`}
            onPress={() => { if (index !== selection) { triggerHaptic('selection'); setSelection(index); } }} hitSlop={{ top: 6, bottom: 6 }} style={styles.dotButton}>
            <View style={{ height: 6, width: index === selection ? 16 : 5, borderRadius: 4, backgroundColor: light ? (index === selection ? '#202020' : '#00000042') : (index === selection ? '#fff' : '#ffffff70') }} />
          </Pressable>)}
        </View>}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  wordmark: { maxWidth: 330, width: '100%', height: 86 },
  dotButton: { minWidth: 24, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
});
