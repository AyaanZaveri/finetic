import { ArtworkImage } from '@/components/media/artwork-image';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { triggerHaptic } from '@/lib/haptics';
import { formatReleaseDate, type MediaEpisode, type MediaItem } from '@/lib/home-catalog';
import { THEME } from '@/lib/theme';
import { BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Check, ChevronDown } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

export const episodeCode = (episode: Pick<MediaEpisode, 'season' | 'number'>) =>
  `S${String(episode.season).padStart(2, '0')}E${String(episode.number).padStart(2, '0')}`;

export function EpisodeRail({ item, season, onSeason, episodes, selected, onOpen, loading }: {
  item: MediaItem; season: number; onSeason: (season: number) => void; episodes: MediaEpisode[];
  selected?: string; onOpen: (episode: MediaEpisode) => void; loading?: boolean;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const availableWidth = width - insets.left - insets.right;
  const roomy = availableWidth >= 720;
  const sheetMargin = roomy ? Math.max(12, (availableWidth - 560) / 2) : 12;
  const sheet = useRef<BottomSheetModal>(null);
  const [focused, setFocused] = useState<string>();
  const cardWidth = roomy ? Math.min(288, Math.round(availableWidth * 0.32)) : Math.min(240, Math.max(160, Math.round(availableWidth * 0.53)));
  const seasonName = item.seasons?.find(row => row.number === season)?.name ?? `Season ${season}`;
  return (
    <View className="gap-3" testID="episode-carousel">
      <Button variant="outline" testID="season-picker" className="justify-between rounded-xl self-start min-w-[148px]" onPress={() => sheet.current?.present()} haptic="selection" accessibilityLabel={`Choose season, ${seasonName}`}>
        <Text>{seasonName}</Text><Icon as={ChevronDown} size={16} className="text-muted-foreground" />
      </Button>
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
      <BottomSheetModal ref={sheet} style={{ marginLeft: insets.left + sheetMargin, marginRight: insets.right + sheetMargin }} detached bottomInset={insets.bottom + 12} topInset={insets.top + 12} snapPoints={['40%', '70%']} enableDynamicSizing={false} backgroundStyle={{ backgroundColor: theme.card, borderRadius: 28 }} handleIndicatorStyle={{ backgroundColor: theme.mutedForeground }}>
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
const styles = StyleSheet.create({ frame: { borderWidth: 2, padding: 2, borderRadius: 13 } });
