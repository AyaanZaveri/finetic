import { HomeHero } from '@/components/home/home-hero';
import { MediaSection } from '@/components/media/media-section';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useMetadataProvider } from '@/lib/metadata-provider';
import { loadHome } from '@/lib/home-api';
import { selectFeatured, type MediaItem } from '@/lib/home-catalog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, Platform, RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import { THEME } from '@/lib/theme';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const roomy = width - insets.left - insets.right >= 720;
  const { provider } = useMetadataProvider();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const query = useQuery({ queryKey: ['home-discovery', provider], queryFn: ({ signal }) => loadHome(signal, provider), staleTime: 5 * 60 * 1000, retry: false });
  const featured = useMemo(() => selectFeatured(query.data?.sections ?? []), [query.data]);
  const open = useCallback((item: MediaItem) => {
    queryClient.setQueryData(['title-summary', item.type, item.id], item);
    router.push({ pathname: item.type === 'movie' ? '/movie/[id]' : '/series/[id]', params: { id: item.id } });
  }, [queryClient, router]);
  const hasHero = featured.length > 0;
  return (
    <ScrollView testID="home-scroll" className="flex-1 bg-background"
        contentInsetAdjustmentBehavior={Platform.OS === 'ios' ? 'never' : 'automatic'}
        // The hero already includes its top safe area. On iOS, preserve the
        // full-bleed artwork and reserve the native floating tab bar at the end.
        contentContainerStyle={{ paddingBottom: Platform.OS === 'ios' ? Math.max(insets.bottom, 90) + 16 : 24 }}
        refreshControl={<RefreshControl refreshing={query.isRefetching} tintColor={theme.foreground} onRefresh={() => void query.refetch()} />}>
        {hasHero && <HomeHero key={provider} items={featured} onOpen={open} />}
        {!hasHero && <View className="items-center justify-center gap-4 px-8" style={{ minHeight: 380, paddingTop: insets.top + 64 }}>
          {query.isPending ? <><ActivityIndicator color={theme.foreground} /><Text variant="muted">Loading titles…</Text></> : query.isError ? <>
            <Text className="text-center text-xl font-nav-semibold">Catalogs are unavailable</Text><Text className="text-center text-muted-foreground">Check your connection and try again.</Text>
            <Button onPress={() => void query.refetch()}><Text>Try again</Text></Button>
          </> : <Text className="text-xl font-nav-semibold">Browse movies and TV shows</Text>}
        </View>}
        <View className="pb-2" style={{ gap: roomy ? 32 : 20, paddingTop: hasHero ? (roomy ? 16 : 8) : 0, backgroundColor: theme.background }}>
          {query.data?.sections.map(section => <MediaSection key={section.key} section={section} onOpen={open} />)}
        </View>
    </ScrollView>
  );
}
