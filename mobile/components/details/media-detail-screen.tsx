import { ProgressiveArtwork } from '@/components/effects/progressive-artwork';
import { ArtworkImage } from '@/components/media/artwork-image';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { loadTitle } from '@/lib/home-api';
import { mediaKey, ratingLabel, resizeBackdrop, validMediaId, type MediaItem, type MediaType } from '@/lib/home-catalog';
import { THEME } from '@/lib/theme';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { ArrowLeft, Star } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { ActivityIndicator, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function MediaDetailScreen({ type, id }: { type: MediaType; id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { top, bottom } = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const cached = queryClient.getQueryData<MediaItem>(['title-summary', type, id]);
  const query = useQuery({ queryKey: ['title', type, id], queryFn: ({ signal }) => loadTitle(type, id, signal),
    enabled: validMediaId(id), placeholderData: cached, staleTime: 5 * 60 * 1000, retry: false });
  const item = query.data ?? cached;
  const art = resizeBackdrop(item?.background, 1280);
  const goBack = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };
  const rating = item ? ratingLabel(item) : undefined;
  return (
    <View testID="title-detail-page" className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ paddingBottom: bottom + 32 }} className="flex-1" showsVerticalScrollIndicator={false}>
        {item ? <>
          <View className="relative overflow-hidden justify-end" style={{ height: Math.min(360, Math.max(260, width * 0.72)), paddingTop: top + 64 }}>
            {art && <ProgressiveArtwork key={art} uri={art} backgroundColor={theme.background} />}
            <LinearGradient pointerEvents="none" style={StyleSheet.absoluteFill} colors={['transparent', 'transparent', theme.background]} locations={[0, 0.45, 1]} />
          </View>
          <View className="gap-6 px-4" style={{ marginTop: -105 }}>
            <View className="items-center gap-3 px-2">
              <View className="overflow-hidden rounded-lg border-border bg-muted" style={styles.poster}>
                <ArtworkImage uri={item.poster} fallback={item.background} recyclingKey={mediaKey(item)} />
              </View>
              <Text role="heading" testID="title-detail-name" className="text-center text-3xl font-nav-semibold tracking-tight">{item.name}</Text>
              <View className="flex-row flex-wrap items-center justify-center gap-3">
                {rating && <View className="flex-row items-center gap-1"><Star color="#facc15" fill="#facc15" size={15} /><Text className="text-sm font-nav-medium">{rating}</Text></View>}
                {item.year && <Text variant="muted">{item.year}</Text>}
                {item.runtime && <Text variant="muted">{item.runtime}</Text>}
                <Text variant="muted">{type === 'movie' ? 'Movie' : 'TV Show'}</Text>
              </View>
              {!!item.genres?.length && <Text variant="muted" className="text-center">{item.genres.join(' · ')}</Text>}
            </View>
            <View className="gap-2">
              <Text role="heading" className="text-xl font-nav-semibold">Overview</Text>
              <Text className="text-base leading-6">{item.description || 'No description is available.'}</Text>
            </View>
            {!!item.seasons?.length && <View className="gap-3">
              <Text role="heading" className="text-xl font-nav-semibold">Seasons</Text>
              {item.seasons.map(season => <View key={season.number} className="rounded-xl border border-border bg-card px-4 py-3 flex-row items-center justify-between gap-3">
                <Text className="flex-1 font-nav-medium">{season.name}</Text>
                <Text variant="muted">{season.episodeCount} {season.episodeCount === 1 ? 'episode' : 'episodes'}</Text>
              </View>)}
            </View>}
            {!!item.cast?.length && <View className="gap-2"><Text role="heading" className="text-xl font-nav-semibold">Cast</Text><Text className="text-base leading-6">{item.cast.join(', ')}</Text></View>}
            {query.isError && cached && <Text variant="muted">Showing cached title information.</Text>}
          </View>
        </> : <View className="items-center justify-center gap-4 px-6" style={{ paddingTop: top + 120 }}>
          {query.isPending && validMediaId(id) ? <ActivityIndicator color={theme.foreground} /> : <><Text className="text-xl font-nav-semibold">Title unavailable</Text><Button onPress={goBack}><Text>Go home</Text></Button></>}
        </View>}
      </ScrollView>
      <View pointerEvents="box-none" className="absolute left-4" style={{ top: top + 8 }}>
        <Button testID="title-detail-back" size="icon" variant="ghost" accessibilityLabel="Go back" className={art ? 'rounded-full bg-black/55' : 'rounded-full bg-card border-border'} onPress={goBack}>
          <Icon as={ArrowLeft} size={21} className={art ? 'text-white' : 'text-foreground'} />
        </Button>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({ poster: { width: 124, aspectRatio: 2 / 3, borderWidth: StyleSheet.hairlineWidth } });
