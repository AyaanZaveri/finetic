import { HomeHero } from '@/components/home/home-hero';
import { MediaSection } from '@/components/media/media-section';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { loadHome } from '@/lib/home-api';
import { selectFeatured, type MediaItem } from '@/lib/home-catalog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import { THEME } from '@/lib/theme';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const query = useQuery({ queryKey: ['home-discovery'], queryFn: ({ signal }) => loadHome(signal), staleTime: 5 * 60 * 1000, retry: false });
  const featured = useMemo(() => selectFeatured(query.data?.sections ?? []), [query.data]);
  const open = useCallback((item: MediaItem) => {
    queryClient.setQueryData(['title-summary', item.type, item.id], item);
    router.push({ pathname: item.type === 'movie' ? '/movie/[id]' : '/series/[id]', params: { id: item.id } });
  }, [queryClient, router]);
  const hasHero = featured.length > 0;
  return (
    <View className="flex-1 bg-background">
      <ScrollView testID="home-scroll" className="flex-1" contentContainerStyle={{ paddingBottom: 16 }}
        refreshControl={<RefreshControl refreshing={query.isRefetching} tintColor={theme.foreground} onRefresh={() => void query.refetch()} />}>
        {hasHero && <HomeHero items={featured} onOpen={open} />}
        {!hasHero && <View className="items-center justify-center gap-4 px-8" style={{ minHeight: 380, paddingTop: insets.top + 64 }}>
          {query.isPending ? <><ActivityIndicator color={theme.foreground} /><Text variant="muted">Loading titles…</Text></> : query.isError ? <>
            <Text className="text-center text-xl font-nav-semibold">Catalogs are unavailable</Text><Text className="text-center text-muted-foreground">Check your connection and try again.</Text>
            <Button onPress={() => void query.refetch()}><Text>Try again</Text></Button>
          </> : <Text className="text-xl font-nav-semibold">Browse movies and TV shows</Text>}
        </View>}
        <View className="gap-5 pb-2">
          {query.data?.sections.map(section => <MediaSection key={section.key} section={section} onOpen={open} />)}
        </View>
      </ScrollView>
    </View>
  );
}
