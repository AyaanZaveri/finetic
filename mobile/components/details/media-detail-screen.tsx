import { DetailActions, DetailBackControl } from './detail-actions';
import { EpisodeRail, episodeCode } from './episode-rail';
import { MediaRatingBadge } from './media-rating-badge';
import { ProgressiveArtwork } from '@/components/effects/progressive-artwork';
import { ArtworkImage } from '@/components/media/artwork-image';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { loadCertification, loadSeasonEpisodes, loadTitle } from '@/lib/home-api';
import { formatReleaseDate, resizeBackdrop, validMediaId, type MediaEpisode, type MediaItem, type MediaType } from '@/lib/home-catalog';
import { creditLabelWidth, detailWordmarkSize, mergeTitleDetails } from '@/lib/detail-presentation';
import { THEME } from '@/lib/theme';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { BlurTargetView } from 'expo-blur';
import { useColorScheme } from 'nativewind';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function TitleIdentity({ item, light, width, roomy }: { item: MediaItem; light: boolean; width: number; roomy: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [aspect, setAspect] = useState<number>();
  const size = detailWordmarkSize(width, roomy, aspect);
  return (
    <View className="items-center justify-end px-4" accessible accessibilityLabel={item.name} testID="title-detail-name">
      {item.logo && <Image source={item.logo} style={{ ...size, opacity: loaded ? 1 : 0, ...(loaded ? {} : { position: 'absolute' }) }} tintColor={light ? "#272727" : undefined} contentFit="contain" contentPosition="bottom" cachePolicy="memory-disk" onLoad={({ source }) => { setAspect(source.width / source.height); setLoaded(true); }} onError={() => setLoaded(false)} />}
      {(!item.logo || !loaded) && <Text className="text-center text-[32px] font-nav-semibold tracking-tight leading-[37px]" role="heading">{item.name}</Text>}
    </View>
  );
}

function TitleCredits({ item, fontScale, width }: { item: MediaItem; fontScale: number; width: number }) {
  const labelWidth = creditLabelWidth(!!item.director?.length, fontScale);
  // At high text sizes the values need the full available line width.
  const stacked = labelWidth + 8 > width * 0.3;
  const labelStyle = stacked ? undefined : { width: labelWidth };
  return (
    <View className="gap-3">
      {!!item.genres?.length && <View className={stacked ? 'gap-1' : 'flex-row items-start gap-2'}>
        <Text className="text-sm text-muted-foreground" style={stacked ? undefined : { width: labelWidth, paddingTop: 4 }}>Genres</Text>
        <View className={stacked ? 'flex-row flex-wrap gap-2' : 'flex-1 min-w-0 flex-row flex-wrap gap-2'}>
          {item.genres.map(genre => <Badge key={genre} variant="secondary" className="max-w-full px-2.5 py-1"><Text className="shrink">{genre}</Text></Badge>)}
        </View>
      </View>}
      {([['Director', item.director], ['Writer', item.writer]] as const).map(([label, values]) => !!values?.length && <View key={label} className={stacked ? 'gap-1' : 'flex-row items-start gap-2'}>
        <Text className="text-sm text-muted-foreground" style={labelStyle}>{label}</Text>
        <Text className={stacked ? 'text-sm' : 'flex-1 min-w-0 text-sm'}>{values.join(', ')}</Text>
      </View>)}
    </View>
  );
}

function CastAvatar({ name, image }: { name: string; image?: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('');
  return <View className="size-20 overflow-hidden rounded-full bg-muted items-center justify-center">
    <Text className="text-xl font-nav-medium text-muted-foreground">{initials}</Text>
    {image && !failed && <Image source={image} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" onError={() => setFailed(true)} />}
  </View>;
}

function Synopsis({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  return (
    <View className="gap-1">
      <Text className="absolute left-0 right-0 opacity-0 text-[15px] leading-[23px]" accessible={false} importantForAccessibility="no-hide-descendants" onTextLayout={event => { setClamped(event.nativeEvent.lines.length > 3); }}>{description}</Text>
      <Text className="text-[15px] leading-[23px]" numberOfLines={expanded ? undefined : 3}>{description}</Text>
      {clamped && <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} hitSlop={8} className="self-start min-h-9 flex-row items-center gap-1.5"><Text className="text-sm font-nav-medium text-muted-foreground">{expanded ? 'Read less' : 'Read more'}</Text><Icon as={expanded ? ChevronUp : ChevronDown} className="text-muted-foreground" size={14} /></Pressable>}
    </View>
  );
}

export function MediaDetailScreen({ type, id, episode }: { type: MediaType; id: string; episode?: { season: number; number: number } }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { top, bottom, left, right } = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const availableWidth = width - left - right;
  const roomy = availableWidth >= 720;
  const gutter = roomy ? 32 : 16;
  const bodyWidth = Math.min(1024, availableWidth - 2 * gutter);
  const sideBySide = roomy && bodyWidth / Math.max(1, fontScale) >= 640;
  const artHeight = roomy ? Math.min(520, Math.max(260, Math.min(height * 0.55, width * 0.52))) : Math.min(400, Math.max(288, width * 0.96));
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const light = colorScheme !== 'dark';
  const blurTarget = useRef<View>(null);
  const [chosenSeason, setChosenSeason] = useState<number | undefined>(episode?.season);
  const [selectedId, setSelectedId] = useState<string>();
  const cached = queryClient.getQueryData<MediaItem>(['title-summary', type, id]);
  const query = useQuery({ queryKey: ['title', type, id], queryFn: ({ signal }) => loadTitle(type, id, signal),
    enabled: validMediaId(id), placeholderData: cached, staleTime: 5 * 60 * 1000, retry: false });
  const item = mergeTitleDetails(cached, query.data);
  const certificationQuery = useQuery({ queryKey: ['certification', type, id], queryFn: async ({ signal }) => (await loadCertification(type, id, signal)) ?? null,
    enabled: !!item && !item.contentRating && validMediaId(id), retry: false, staleTime: 30 * 60 * 1000 });
  const certification = item?.contentRating ?? certificationQuery.data;
  const season = chosenSeason ?? item?.seasons?.find(row => row.number > 0)?.number ?? item?.seasons?.[0]?.number ?? 1;
  const episodeQuery = useQuery({ queryKey: ['season', id, season], queryFn: ({ signal }) => loadSeasonEpisodes(id, season, signal),
    enabled: type === 'series' && id.startsWith('tmdb:') && !!item?.seasons?.some(row => row.number === season), staleTime: 5 * 60 * 1000, retry: false });
  const episodes = id.startsWith('tmdb:') ? episodeQuery.data ?? [] : item?.episodes?.filter(row => row.season === season) ?? [];
  const episodeIdentityQuery = useQuery({ queryKey: ['season', id, episode?.season], queryFn: ({ signal }) => loadSeasonEpisodes(id, episode!.season, signal),
    enabled: !!episode && id.startsWith('tmdb:') && episode.season !== season, staleTime: 5 * 60 * 1000, retry: false });
  const currentEpisode = episode ? (id.startsWith('tmdb:') ? episode.season === season ? episodes : episodeIdentityQuery.data ?? [] : item?.episodes ?? []).find(row => row.season === episode.season && row.number === episode.number) : undefined;
  const selectedEpisode = (currentEpisode?.season === season ? currentEpisode : undefined) ?? episodes.find(row => row.id === selectedId) ?? episodes[0];
  const openEpisode = (entry: MediaEpisode) => {
    setSelectedId(entry.id);
    router.push({ pathname: '/series/[id]/[season]/[episode]', params: { id, season: String(entry.season), episode: String(entry.number) } });
  };
  const art = currentEpisode?.thumbnail ?? resizeBackdrop(item?.background, 1280) ?? item?.poster;
  const goBack = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };
  const seasonCount = item?.seasons?.filter(row => row.number > 0).length ?? 0;
  const releaseDate = formatReleaseDate(currentEpisode?.released ?? item?.released ?? item?.releaseInfo, item?.year);
  const credits = item?.castMembers?.length ? item.castMembers : item?.cast?.map(name => ({ id: name, name, image: undefined, role: undefined }));
  return (
    <View testID="title-detail-page" className="flex-1 bg-background">
      <BlurTargetView ref={blurTarget} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: bottom + 24 }} className="flex-1" showsVerticalScrollIndicator={false}>
        {item ? <>
          <View className="relative overflow-hidden justify-end" style={{ minHeight: art ? artHeight : top + 112, paddingTop: top + 48, paddingBottom: roomy ? 16 : 6 }}>
            {art && <View pointerEvents="none" style={{ position: 'absolute', top: 0, start: 0, end: 0, bottom: 4, overflow: 'hidden' }}>
              <ProgressiveArtwork key={art} uri={art} backgroundColor={theme.background} light={light} contentPosition={{ top: '38%', left: '50%' }} />
              <LinearGradient style={StyleSheet.absoluteFill} colors={[light ? 'rgba(255,255,255,0.24)' : 'rgba(0,0,0,0.44)', 'transparent', 'transparent', theme.background, theme.background]} locations={[0, 0.32, 0.62, 0.96, 1]} />
            </View>}
            {art && <View pointerEvents="none" style={{ position: 'absolute', start: 0, end: 0, bottom: 0, height: 5, backgroundColor: theme.background }} />}
            <TitleIdentity key={item.id + (item.logo ?? '')} item={item} light={light} width={availableWidth - 2 * gutter} roomy={roomy} />
          </View>
          <View style={{ paddingLeft: left, paddingRight: right }}>
            <View className="self-center" style={{ width: bodyWidth, gap: roomy ? 32 : 20 }}>
              <View style={{ flexDirection: sideBySide ? 'row' : 'column', gap: roomy ? 32 : 20, alignItems: sideBySide ? 'center' : 'stretch', justifyContent: 'center' }}>
                {sideBySide && !episode && item.poster && <View testID="tablet-detail-poster" accessible accessibilityRole="image" accessibilityLabel={`${item.name} poster`} className="overflow-hidden rounded-lg bg-muted" style={{ width: Math.min(224, bodyWidth * 0.26), aspectRatio: 2 / 3 }}>
                  <ArtworkImage uri={item.poster} recyclingKey={item.id} />
                </View>}
                <View style={{ width: '100%', flexShrink: 1, gap: 20, maxWidth: roomy ? 720 : undefined, alignSelf: 'center' }}>
                  {sideBySide && !episode && <Text role="heading" className="text-3xl font-nav-semibold tracking-tight">{item.name}</Text>}
                  {currentEpisode && <Text testID="episode-detail-name" className="text-center text-xl font-nav-semibold">{episodeCode(currentEpisode)} · {currentEpisode.name}</Text>}
                  <View className="flex-row flex-wrap items-center gap-2" style={{ justifyContent: sideBySide && !episode ? 'flex-start' : 'center' }}>
                    {releaseDate && <Badge variant="secondary"><Text>{releaseDate}</Text></Badge>}
                    {type === 'series' && seasonCount > 0 && !episode && <Badge variant="secondary"><Text>{seasonCount} {seasonCount === 1 ? 'Season' : 'Seasons'}</Text></Badge>}
                    {(type === 'movie' || episode) && (currentEpisode?.runtime || item.runtime) && <Badge variant="secondary"><Text>{currentEpisode?.runtime || item.runtime}</Text></Badge>}
                    <MediaRatingBadge item={item} light={light} />
                    {certification && <Badge variant="outline" className="rounded-md"><Text>{certification}</Text></Badge>}
                  </View>
                  <View style={{ width: '100%', maxWidth: roomy ? 360 : undefined, alignSelf: sideBySide && !episode ? 'flex-start' : 'center' }}>
                    <DetailActions item={item} episode={currentEpisode ?? selectedEpisode} episodes={episodes} onShuffle={openEpisode} />
                  </View>
                  <Synopsis key={currentEpisode?.id ?? item.id} description={currentEpisode?.description || item.description || 'No description is available.'} />
                  {!!(item.genres?.length || item.director?.length || item.writer?.length) && <TitleCredits item={item} fontScale={fontScale} width={sideBySide && !episode && item.poster ? bodyWidth - Math.min(224, bodyWidth * 0.26) - 32 : bodyWidth} />}
                </View>
              </View>
              {!!item.seasons?.length && <EpisodeRail item={item} season={season} onSeason={value => { setChosenSeason(value); setSelectedId(undefined); }} episodes={episodes} selected={selectedEpisode?.id} onOpen={openEpisode} loading={query.isFetching && !episodes.length || episodeQuery.isFetching} />}
              {!!credits?.length && <View className="gap-3">
                <Text role="heading" className="text-xl font-nav-semibold">Cast</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 16 }}>
                  {credits.map(person => <View key={person.id} className="w-24 items-center gap-1.5">
                    <CastAvatar name={person.name} image={person.image} />
                    <Text className="text-center text-sm font-nav-semibold" numberOfLines={2}>{person.name}</Text>
                    {person.role && <Text variant="muted" className="text-center" numberOfLines={2}>{person.role}</Text>}
                  </View>)}
                </ScrollView>
              </View>}
              {query.isError && cached && <Text variant="muted">Showing cached title information.</Text>}
            </View>
          </View>
        </> : <View className="items-center justify-center gap-4 px-6" style={{ paddingTop: top + 120 }}>
          {query.isPending && validMediaId(id) ? <ActivityIndicator color={theme.foreground} /> : <><Text className="text-xl font-nav-semibold">Title unavailable</Text><Button onPress={goBack}><Text>Go home</Text></Button></>}
        </View>}
      </ScrollView>
      </BlurTargetView>
      <View pointerEvents="box-none" className="absolute" style={{ left: left + gutter, top: top + 8 }}>
        <DetailBackControl onBack={goBack} blurTarget={blurTarget} />
      </View>
    </View>
  );
}
