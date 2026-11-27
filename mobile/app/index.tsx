import { HomeHero } from '@/components/home/home-hero';
import { MediaSection } from '@/components/media/media-section';
import { TitleSheet } from '@/components/sheets/title-sheet';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { loadHome } from '@/lib/home-api';
import { selectFeatured, type MediaItem } from '@/lib/home-catalog';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Settings2 } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import { THEME } from '@/lib/theme';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const query = useQuery({ queryKey: ['home-discovery'], queryFn: ({ signal }) => loadHome(signal), staleTime: 5 * 60 * 1000, retry: false });
  const featured = useMemo(() => selectFeatured(query.data?.sections ?? []), [query.data]);
  const open = useCallback((item: MediaItem) => setSelected(item), []);
  const close = useCallback(() => setSelected(null), []);
  const hasHero = featured.length > 0;
  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView testID="home-scroll" className="flex-1" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={query.isRefetching} tintColor={theme.foreground} onRefresh={() => void query.refetch()} />}>
        {hasHero && <HomeHero items={featured} onOpen={open} />}
        {!hasHero && <View className="items-center justify-center gap-4 px-8" style={{ minHeight: 380, paddingTop: insets.top + 64 }}>
          {query.isPending ? <><ActivityIndicator color={theme.foreground} /><Text variant="muted">Loading titles…</Text></> : query.isError ? <>
            <Text className="text-center text-xl font-nav-semibold">Catalogs are unavailable</Text><Text className="text-center text-muted-foreground">Check your connection and try again.</Text>
            <Button onPress={() => void query.refetch()}><Text>Try again</Text></Button>
          </> : <Text className="text-xl font-nav-semibold">Browse movies and TV shows</Text>}
        </View>}
        <View className="gap-7 pb-3">
          {query.data?.sections.map(section => <MediaSection key={section.key} section={section} onOpen={open} />)}
        </View>
      </ScrollView>
      <View className="absolute left-0 right-0 flex-row items-center justify-between px-4" style={{ top: insets.top + 8 }} pointerEvents="box-none">
        <View className="size-12 items-center justify-center" accessibilityLabel="Navigator home" accessible>
          <Image source={require('../assets/images/ship.png')} style={{ width: 34, height: 34 }} contentFit="contain" />
        </View>
        <Button testID="open-design-system" variant="ghost" size="icon" accessibilityLabel="Appearance and component preview" className={hasHero ? 'rounded-full bg-black/50' : 'rounded-full bg-card border-border'} onPress={() => router.push('/design-system')}>
          <Icon as={Settings2} size={21} className={hasHero ? 'text-white' : 'text-foreground'} />
        </Button>
      </View>
      <TitleSheet item={selected} onDismiss={close} />
    </View>
  );
}
