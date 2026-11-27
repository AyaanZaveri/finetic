import { GlassSurface } from '@/components/effects/glass-surface';
import { BlurView } from 'expo-blur';
import { ArtworkImage } from '@/components/media/artwork-image';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { triggerHaptic } from '@/lib/haptics';
import { formatReleaseDate, type MediaEpisode, type MediaItem } from '@/lib/home-catalog';
import { THEME } from '@/lib/theme';
import { seasonSheetLayout } from '@/lib/season-sheet';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView, type BottomSheetBackdropProps, type BottomSheetBackgroundProps } from '@gorhom/bottom-sheet';
import { Check, ChevronDown } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useRef, useState, type RefObject } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

function SeasonBackdrop(props: BottomSheetBackdropProps) {
  return <BottomSheetBackdrop {...props} opacity={0.26} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />;
}

export const episodeCode = (episode: Pick<MediaEpisode, 'season' | 'number'>) =>
  `S${String(episode.season).padStart(2, '0')}E${String(episode.number).padStart(2, '0')}`;

export function EpisodeRail({ item, season, onSeason, episodes, selected, onOpen, loading, blurTarget }: {
  item: MediaItem; season: number; onSeason: (season: number) => void; episodes: MediaEpisode[];
  selected?: string; onOpen: (episode: MediaEpisode) => void; loading?: boolean; blurTarget?: RefObject<View | null>;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const availableWidth = width - insets.left - insets.right;
  const roomy = availableWidth >= 720;
  const sheet = useRef<BottomSheetModal>(null);
  const sheetLayout = seasonSheetLayout(width, height, insets, item.seasons?.length ?? 0, fontScale);
  const SheetBackground = useCallback(({ style, pointerEvents }: BottomSheetBackgroundProps) => {
    const surfaceStyle = [style, styles.sheetBackground];
    if (Platform.OS === 'ios') return <GlassSurface pointerEvents={pointerEvents} style={surfaceStyle}
      fallbackStyle={{ backgroundColor: theme.card, borderWidth: 0 }} />;
    const canBlur = Platform.OS === 'android' && Number(Platform.Version) >= 31 && blurTarget;
    return <View pointerEvents={pointerEvents} style={[surfaceStyle, { backgroundColor: canBlur ? 'transparent' : theme.card }]}>
      {canBlur && <>
        <BlurView blurTarget={blurTarget} blurMethod="dimezisBlurViewSdk31Plus" tint={colorScheme ?? 'light'} intensity={45} style={StyleSheet.absoluteFill} />
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colorScheme === 'dark' ? '#171717db' : '#ffffffde' }]} />
      </>}
    </View>;
  }, [colorScheme, theme.card, blurTarget]);
  const [focused, setFocused] = useState<string>();
  const cardWidth = roomy ? Math.min(288, Math.round(availableWidth * 0.32)) : Math.min(240, Math.max(160, Math.round(availableWidth * 0.53)));
  const seasonName = item.seasons?.find(row => row.number === season)?.name ?? `Season ${season}`;
  return (
    <View className="gap-3" testID="episode-carousel">
      <Pressable testID="season-picker" accessibilityRole="button" accessibilityLabel={`Choose season, ${seasonName}`} accessibilityHint="Opens the season list"
        style={styles.seasonTrigger} onPress={() => { triggerHaptic('selection'); sheet.current?.present(); }}>
        {Platform.OS === 'ios' ? <GlassSurface pointerEvents="none" style={styles.seasonPill} fallbackStyle={{ backgroundColor: theme.secondary, borderWidth: 0 }}>
          <Text className="text-sm font-nav-medium">{seasonName}</Text><Icon as={ChevronDown} size={14} className="text-muted-foreground" />
        </GlassSurface> : <View pointerEvents="none" style={[styles.seasonPill, { backgroundColor: theme.secondary }]}>
          <Text className="text-sm font-nav-medium">{seasonName}</Text><Icon as={ChevronDown} size={14} className="text-muted-foreground" />
        </View>}
      </Pressable>
      {loading ? <ActivityIndicator color={theme.foreground} /> : episodes.length ? <FlatList horizontal data={episodes} keyExtractor={value => value.id} showsHorizontalScrollIndicator={false} initialNumToRender={4} windowSize={4}
        contentContainerStyle={{ paddingHorizontal: roomy ? 6 : 16, paddingVertical: 6, gap: 12 }} style={{ marginHorizontal: roomy ? -6 : -16 }}
        renderItem={({ item: episode }) => {
          const active = selected === episode.id || focused === episode.id;
          return <Pressable testID={`episode-card-${episode.season}-${episode.number}`} style={{ width: cardWidth }} onFocus={() => setFocused(episode.id)} onBlur={() => setFocused(undefined)}
            accessibilityRole="button" accessibilityLabel={`${episodeCode(episode)}, ${episode.name}`} accessibilityState={{ selected: selected === episode.id }}
            onPress={() => { triggerHaptic('selection'); onOpen(episode); }}>
            <View style={[styles.frame, { borderColor: active ? theme.primary : 'transparent', backgroundColor: theme.background }, active && { shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 9, shadowOffset: { width: 0, height: 3 }, elevation: 3 }]}>
              <View className="overflow-hidden rounded-lg bg-muted" style={{ aspectRatio: 16 / 9 }}>
                <ArtworkImage uri={episode.thumbnail} fallback={item.background} recyclingKey={episode.id} />
              </View>
            </View>
            <View className="gap-1 px-1 pt-1">
              <Text variant="muted">{episodeCode(episode)}{episode.released ? ` · ${formatReleaseDate(episode.released) ?? ''}` : ''}</Text>
              <Text className="font-nav-medium text-sm" numberOfLines={2}>{episode.name}</Text>
            </View>
          </Pressable>;
        }} /> : <Text variant="muted">Episode details are not available for this season.</Text>}
      <BottomSheetModal ref={sheet} accessible={false} style={[styles.sheet, { marginLeft: sheetLayout.marginLeft, marginRight: sheetLayout.marginRight }]} detached bottomInset={sheetLayout.bottomInset} topInset={sheetLayout.topInset} snapPoints={[sheetLayout.snapHeight]} backdropComponent={SeasonBackdrop} enableDynamicSizing={false} backgroundComponent={SheetBackground} handleIndicatorStyle={{ backgroundColor: theme.mutedForeground }}>
        <BottomSheetScrollView accessibilityViewIsModal accessible={false} contentContainerStyle={{ padding: 16, paddingBottom: 16, gap: 8 }}>
          <Text role="heading" className="text-xl font-nav-semibold pb-2">Choose a season</Text>
          {item.seasons?.map(row => <Button key={row.number} testID={`season-option-${row.number}`} variant={row.number === season ? 'secondary' : 'ghost'} className="justify-start" accessibilityState={{ selected: row.number === season }} onPress={() => { onSeason(row.number); sheet.current?.dismiss(); }} haptic="selection">
            <Text className="flex-1">{row.name}</Text><Text variant="muted">{row.episodeCount} episodes</Text>{row.number === season && <Icon as={Check} size={16} />}
          </Button>)}
        </BottomSheetScrollView>
      </BottomSheetModal>
    </View>
  );
}
const styles = StyleSheet.create({
  seasonTrigger: { minHeight: 48, alignSelf: 'flex-start', justifyContent: 'center' },
  seasonPill: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 0 },
  frame: { borderWidth: 2, padding: 2, borderRadius: 13 },
  sheetBackground: { borderRadius: 28, overflow: 'hidden', padding: 0, borderWidth: 0 },
  sheet: { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
});
