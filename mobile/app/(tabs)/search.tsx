import { MediaCard } from '@/components/media/media-card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { searchTitles } from '@/lib/home-api';
import { mediaKey, type MediaItem } from '@/lib/home-catalog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function SearchScreen() {
  const { top } = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [value, setValue] = useState('');
  const [term, setTerm] = useState('');
  const router = useRouter();
  const client = useQueryClient();
  useEffect(() => {
    const timer = setTimeout(() => setTerm(value.trim()), 300);
    return () => clearTimeout(timer);
  }, [value]);
  const query = useQuery({ queryKey: ['title-search', term], queryFn: ({ signal }) => searchTitles(term, signal), enabled: !!term, retry: false });
  const columns = Math.max(2, Math.floor((width - 32) / 128));
  const cardWidth = (width - 32 - (columns - 1) * 12) / columns;
  const open = useCallback((item: MediaItem) => {
    client.setQueryData(['title-summary', item.type, item.id], item);
    router.push({ pathname: item.type === 'movie' ? '/movie/[id]' : '/series/[id]', params: { id: item.id } });
  }, [client, router]);
  return (
    <View testID="search-page" className="flex-1 bg-background" style={{ paddingTop: top + 12 }}>
      <View className="gap-3 px-4 pb-4">
        <Text role="heading" className="text-3xl font-nav-semibold tracking-tight">Search</Text>
        <Input testID="search-input" placeholder="Search movies and TV shows" accessibilityLabel="Search movies and TV shows" value={value} onChangeText={setValue} maxLength={300} clearButtonMode="while-editing" returnKeyType="search" autoCorrect={false} />
      </View>
      <FlatList key={columns} data={term ? query.data ?? [] : []} keyExtractor={mediaKey} numColumns={columns} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 16 }} columnWrapperStyle={{ gap: 12 }}
        renderItem={({ item }) => <MediaCard item={item} width={cardWidth} onOpen={open} />}
        ListEmptyComponent={<View className="items-center gap-3 py-8">
          {term && query.isPending ? <ActivityIndicator /> : query.isError && term ? <><Text variant="muted">Search is unavailable.</Text><Button variant="outline" onPress={() => void query.refetch()}><Text>Try again</Text></Button></> : <Text variant="muted">{term ? 'No titles found.' : 'Find a movie or TV show.'}</Text>}
        </View>} />
    </View>
  );
}
