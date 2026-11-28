import { DetailActions, DetailBackControl } from './detail-actions';
import { EpisodeRail, episodeCode } from './episode-rail';
import { MediaRatingBadge } from './media-rating-badge';
import { DetailChip } from './detail-chip';
import { StreamSelector, type StreamSelectorHandle } from './stream-selector';
import { ArtworkTopScrim, ProgressiveArtwork } from '@/components/effects/progressive-artwork';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { formatReleaseDate, resizeBackdrop, validMediaId, type MediaEpisode, type MediaItem, type MediaType } from '@/lib/home-catalog';
import { creditLabelWidth, detailIdentityGap, detailWordmarkSize, estimateWordmarkPadding, mergeTitleDetails } from '@/lib/detail-presentation';
import { THEME } from '@/lib/theme';
import { detailStreamTarget } from '@/lib/stream-selection';
import { streamTargetId } from '@/lib/stream-api';
import { titleQueryOptions, titleSummaryKey, useTitleLogo } from '@/lib/title-cache';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { BlurTargetView } from 'expo-blur';
import { useColorScheme } from 'nativewind';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function TitleIdentity({ item, width, roomy, left, right, light }: { item: MediaItem; width: number; roomy: boolean; left: number; right: number; light: boolean }) {
  const logo = useTitleLogo(item.logo);
  const padding = useMemo(() => estimateWordmarkPadding(logo?.thumbhash), [logo?.thumbhash]);
  const size = detailWordmarkSize(width, roomy, logo && logo.image.width / logo.image.height, padding);
  return (
    <View
      accessible
      accessibilityLabel={item.name}
      testID="title-detail-name"
      style={{ width, alignSelf: 'center', alignItems: roomy ? 'flex-start' : 'center', justifyContent: 'flex-end', marginLeft: left, marginRight: right }}>
      {logo ? <Image source={Platform.OS === 'ios' ? item.logo : logo.image} cachePolicy="memory-disk" transition={0} tintColor={Platform.OS === 'ios' && light ? '#272727' : undefined} style={{ width: size.width, height: size.height, marginBottom: -size.bottomOffset }} contentFit="contain" contentPosition="bottom" />
        : <Text className="text-[32px] font-nav-semibold tracking-tight leading-[37px]" style={{ textAlign: roomy ? 'auto' : 'center' }} role="heading">{item.name}</Text>}
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
        <Text className="text-sm text-muted-foreground" style={stacked ? undefined : { width: labelWidth, paddingTop: 2 }}>Genres</Text>
        <View className={stacked ? 'flex-row flex-wrap items-start gap-1.5' : 'flex-1 min-w-0 flex-row flex-wrap items-start gap-1.5'}>
          {item.genres.map(genre => <DetailChip key={genre} material={false}><Text>{genre}</Text></DetailChip>)}
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
  const bodyWidth = Math.max(1, availableWidth - 2 * gutter);
  const artHeight = roomy ? Math.min(520, Math.max(260, Math.min(height * 0.55, width * 0.52))) : Math.min(400, Math.max(288, width * 0.96));
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const light = colorScheme !== 'dark';
  const blurTarget = useRef<View>(null);
  const streamSelector = useRef<StreamSelectorHandle>(null);
  const [chosenSeason, setChosenSeason] = useState<number | undefined>(episode?.season);
  const [selectedId, setSelectedId] = useState<string>();
  const cached = queryClient.getQueryData<MediaItem>(titleSummaryKey(type, id));
  const query = useQuery({ ...titleQueryOptions(type, id), enabled: validMediaId(id), placeholderData: cached });
  const item = mergeTitleDetails(cached, query.data);
  const season = chosenSeason ?? item?.seasons?.find(row => row.number > 0)?.number ?? item?.seasons?.[0]?.number ?? 1;
  const episodes = item?.episodes?.filter(row => row.season === season) ?? [];
  const currentEpisode = episode ? item?.episodes?.find(row => row.season === episode.season && row.number === episode.number) : undefined;
  const selectedEpisode = (currentEpisode?.season === season ? currentEpisode : undefined) ?? episodes.find(row => row.id === selectedId) ?? episodes[0];
  const playEpisode = episode ?? selectedEpisode;
  const streamTarget = detailStreamTarget(type, id, episode, selectedEpisode);
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
    // Keep sheet portals in this native stack screen's accessibility tree.
    <BottomSheetModalProvider>
    <View testID="title-detail-page" className="flex-1 bg-background">
      <BlurTargetView ref={blurTarget} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: bottom + 24 }} className="flex-1" showsVerticalScrollIndicator={false}>
        {item ? <>
          <View className="relative justify-end" style={{ minHeight: art ? artHeight : top + 112, paddingTop: top + 48, paddingBottom: detailIdentityGap(roomy) }}>
            {art && <View pointerEvents="none" style={{ position: 'absolute', top: 0, start: 0, end: 0, bottom: 4, overflow: 'hidden' }}>
              <ProgressiveArtwork key={art} uri={art} backgroundColor={theme.background} light={light} contentPosition={{ top: '38%', left: '50%' }} />
              <LinearGradient style={StyleSheet.absoluteFill} colors={[light ? 'transparent' : 'rgba(0,0,0,0.44)', 'transparent', 'transparent', theme.background, theme.background]} locations={[0, 0.32, 0.62, 0.96, 1]} />
              <ArtworkTopScrim light={light} topInset={top} artworkHeight={artHeight - 4} />
            </View>}
            {art && <View pointerEvents="none" style={{ position: 'absolute', start: 0, end: 0, bottom: 0, height: 5, backgroundColor: theme.background }} />}
            <TitleIdentity item={item} light={light} width={bodyWidth} roomy={roomy} left={left} right={right} />
          </View>
          <View style={{ paddingLeft: left, paddingRight: right }}>
            <View className="self-center" style={{ width: bodyWidth, gap: roomy ? 32 : 20 }}>
              <View testID="title-detail-content" style={{ width: '100%', gap: 20, maxWidth: roomy ? 680 : undefined, alignSelf: roomy ? 'flex-start' : 'center' }}>
                  {currentEpisode && <Text testID="episode-detail-name" className="text-xl font-nav-semibold" style={{ textAlign: roomy ? 'auto' : 'center' }}>{episodeCode(currentEpisode)} · {currentEpisode.name}</Text>}
                  <View className="flex-row flex-wrap items-center gap-2" style={{ justifyContent: roomy ? 'flex-start' : 'center' }}>
                    {releaseDate && <DetailChip><Text>{releaseDate}</Text></DetailChip>}
                    {type === 'series' && seasonCount > 0 && !episode && <DetailChip><Text>{seasonCount} {seasonCount === 1 ? 'Season' : 'Seasons'}</Text></DetailChip>}
                    {(type === 'movie' || episode) && (currentEpisode?.runtime || item.runtime) && <DetailChip><Text>{currentEpisode?.runtime || item.runtime}</Text></DetailChip>}
                    <MediaRatingBadge item={item} light={light} />
                    {item.contentRating && <DetailChip><Text>{item.contentRating}</Text></DetailChip>}
                  </View>
                  <View style={{ width: '100%', maxWidth: roomy ? 360 : undefined, alignSelf: roomy ? 'flex-start' : 'center' }}>
                    <DetailActions item={item} episode={playEpisode} episodes={episodes} onShuffle={openEpisode}
                      onPlay={streamTarget ? () => streamSelector.current?.present() : undefined} />
                  </View>
                  <Synopsis key={currentEpisode?.id ?? item.id} description={currentEpisode?.description || item.description || 'No description is available.'} />
                  {!!(item.genres?.length || item.director?.length || item.writer?.length) && <TitleCredits item={item} fontScale={fontScale} width={roomy ? Math.min(bodyWidth, 680) : bodyWidth} />}
              </View>
              {!!item.seasons?.length && <EpisodeRail blurTarget={blurTarget} item={item} season={season} onSeason={value => { setChosenSeason(value); setSelectedId(undefined); }} episodes={episodes} selected={selectedEpisode?.id} onOpen={openEpisode} loading={query.isFetching && !episodes.length} />}
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
      {item && streamTarget && <StreamSelector key={streamTargetId(streamTarget)} ref={streamSelector} target={streamTarget}
        title={playEpisode ? `${item.name} · ${episodeCode(playEpisode)}` : item.name} blurTarget={blurTarget} />}
    </View>
    </BottomSheetModalProvider>
  );
}
