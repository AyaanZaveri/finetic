import { ProgressiveArtwork } from '@/components/effects/progressive-artwork';
import { ArtworkImage } from '@/components/media/artwork-image';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { loadTitle } from '@/lib/home-api';
import { ratingLabel, resizeBackdrop, validMediaId, type MediaItem, type MediaType } from '@/lib/home-catalog';
import { THEME } from '@/lib/theme';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { ArrowLeft, Star } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function TitleIdentity({ item, useLogo }: { item: MediaItem; useLogo: boolean }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <View className="items-center justify-end px-4" accessible accessibilityLabel={item.name} testID="title-detail-name">
      {useLogo && item.logo && <Image source={item.logo} style={{ width: '84%', maxWidth: 320, height: 72, opacity: loaded ? 1 : 0, ...(loaded ? {} : { position: 'absolute' }) }} contentFit="contain" contentPosition="bottom" cachePolicy="memory-disk" onLoad={() => setLoaded(true)} onError={() => setLoaded(false)} />}
      {(!useLogo || !item.logo || !loaded) && <Text className="text-center text-[32px] font-nav-semibold tracking-tight leading-[37px]" role="heading">{item.name}</Text>}
    </View>
  );
}

function Synopsis({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  return (
    <View className="gap-1">
      <Text className="absolute opacity-0 text-[15px] leading-[23px]" accessible={false} importantForAccessibility="no-hide-descendants" onTextLayout={event => setClamped(event.nativeEvent.lines.length > 3)}>{description}</Text>
      <Text className="text-[15px] leading-[23px]" numberOfLines={expanded ? undefined : 3}>{description}</Text>
      {clamped && <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} hitSlop={8} className="self-start min-h-9 justify-center"><Text className="text-sm font-nav-medium">{expanded ? 'Read less' : 'Read more'}</Text></Pressable>}
    </View>
  );
}

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
  const art = resizeBackdrop(item?.background, 1280) ?? item?.poster;
  const goBack = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };
  const rating = item ? ratingLabel(item) : undefined;
  const credits = item?.castMembers?.length ? item.castMembers : item?.cast?.map(name => ({ id: name, name, image: undefined, role: undefined }));
  return (
    <View testID="title-detail-page" className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ paddingBottom: bottom + 24 }} className="flex-1" showsVerticalScrollIndicator={false}>
        {item ? <>
          <View className="relative overflow-hidden justify-end pb-6" style={{ minHeight: art ? Math.min(400, Math.max(288, width * 0.96)) : top + 112, paddingTop: top + 48 }}>
            {art && <ProgressiveArtwork key={art} uri={art} backgroundColor={theme.background} contentPosition={{ top: '38%', left: '50%' }} />}
            {art && <LinearGradient pointerEvents="none" style={StyleSheet.absoluteFill} colors={['rgba(0,0,0,0.44)', 'transparent', 'transparent', theme.background]} locations={[0, 0.32, 0.62, 1]} />}
            <TitleIdentity key={item.id + (item.logo ?? '')} item={item} useLogo={colorScheme === 'dark' && !!item.background} />
          </View>
          <View className="gap-5 px-4">
            <View className="flex-row flex-wrap items-center justify-center gap-2">
              {rating && <Badge variant="outline"><Star color="#facc15" fill="#facc15" size={12} /><Text>{rating}</Text></Badge>}
              {item.year && <Badge variant="outline"><Text>{item.year}</Text></Badge>}
              {item.runtime && <Badge variant="outline"><Text>{item.runtime}</Text></Badge>}
              <Badge variant="outline"><Text>{type === 'movie' ? 'Movie' : 'TV Show'}</Text></Badge>
            </View>
            <Synopsis key={item.id} description={item.description || 'No description is available.'} />
            <View className="gap-2">
              {([['Genres', item.genres], ['Director', item.director], ['Writer', item.writer]] as const).map(([label, values]) => !!values?.length && <View key={label} className="flex-row gap-2"><Text className="w-[82px] text-sm">{label}</Text><Text className="flex-1 text-sm text-muted-foreground">{values.join(', ')}</Text></View>)}
            </View>
            {!!item.seasons?.length && <View className="gap-2">
              <Text role="heading" className="text-xl font-nav-semibold">Seasons</Text>
              {item.seasons.map(season => <View key={season.number} className="rounded-lg border border-border px-3 py-3 flex-row items-center justify-between gap-2">
                <Text className="flex-1 font-nav-medium text-sm">{season.name}</Text>
                <Text variant="muted">{season.episodeCount} {season.episodeCount === 1 ? 'episode' : 'episodes'}</Text>
              </View>)}
            </View>}
            {!!credits?.length && <View className="gap-3">
              <Text role="heading" className="text-xl font-nav-semibold">Cast</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                {credits.map(person => <View key={person.id} className="w-[104px] gap-1.5">
                  <View className="overflow-hidden rounded-lg bg-muted aspect-[2/3]"><ArtworkImage uri={person.image} recyclingKey={person.id} /></View>
                  <Text className="text-sm font-nav-medium" numberOfLines={2}>{person.name}</Text>
                  {person.role && <Text variant="muted" numberOfLines={2}>{person.role}</Text>}
                </View>)}
              </ScrollView>
            </View>}
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
