import { MediaCard } from '@/components/media/media-card';
import { SearchField } from '@/components/search/search-field';
import { SearchFilters } from '@/components/search/search-filters';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useMetadataProvider } from '@/lib/metadata-provider';
import { searchTitles } from '@/lib/home-api';
import { mediaKey, type MediaItem } from '@/lib/home-catalog';
import { searchGridLayout, searchPhase, searchPresentation, type SearchFilter } from '@/lib/search-presentation';
import { THEME } from '@/lib/theme';
import { rememberTitleSummary, useTitlePrefetch } from '@/lib/title-cache';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused, useRouter } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const EMPTY: MediaItem[] = [];
const RowSeparator = () => <View style={styles.rowGap} />;

export default function SearchScreen() {
  const { top, left, right } = useSafeAreaInsets();
  const { provider } = useMetadataProvider();
  const { width, fontScale } = useWindowDimensions();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [value, setValue] = useState('');
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<SearchFilter>('all');
  const list = useRef<FlatList<MediaItem>>(null);
  const router = useRouter();
  const client = useQueryClient();
  const focused = useIsFocused();
  const editedTerm = value.trim();
  useEffect(() => {
    if (editedTerm === term) return;
    const timer = setTimeout(() => setTerm(editedTerm), 300);
    return () => clearTimeout(timer);
  }, [editedTerm, term]);
  const query = useQuery({
    queryKey: ['title-search', provider, term], queryFn: ({ signal }) => searchTitles(term, signal, provider),
    enabled: !!term && term === editedTerm, staleTime: 5 * 60 * 1000, retry: false,
  });
  const { gutter, columns, cardWidth, columnGap } = searchGridLayout(measuredWidth || width - left - right, fontScale);
  const presentation = useMemo(() => searchPresentation(term === editedTerm ? query.data ?? EMPTY : EMPTY, filter, term), [term, editedTerm, query.data, filter]);
  const phase = searchPhase(value, term, query.isPending, query.isError, presentation.counts.all, presentation.items.length);
  useTitlePrefetch(focused && phase === 'results' ? presentation.items : EMPTY, 3);
  const showFilters = phase === 'results' || phase === 'filtered-empty' || phase === 'empty';
  const scrollToTop = useCallback(() => list.current?.scrollToOffset({ offset: 0, animated: false }), []);
  const changeText = useCallback((next: string) => {
    setValue(next);
    setFilter('all');
    if (!next.trim()) setTerm('');
    scrollToTop();
  }, [scrollToTop]);
  const clear = useCallback(() => changeText(''), [changeText]);
  const changeFilter = useCallback((next: SearchFilter) => { setFilter(next); scrollToTop(); }, [scrollToTop]);
  const open = useCallback((item: MediaItem) => {
    Keyboard.dismiss();
    rememberTitleSummary(client, item);
    router.push({ pathname: item.type === 'movie' ? '/movie/[id]' : '/series/[id]', params: { id: item.id } });
  }, [client, router]);
  const renderItem = useCallback(({ item }: { item: MediaItem }) =>
    <MediaCard item={item} width={cardWidth} onOpen={open} titleLines={2} showType={cardWidth >= 132} />, [cardWidth, open]);
  const browse = () => { Keyboard.dismiss(); router.navigate('/(tabs)'); };

  return (
    <View testID="search-page" className="flex-1 bg-background" style={{ paddingTop: top, paddingLeft: left, paddingRight: right }}>
      <View className="flex-1" onLayout={({ nativeEvent }) => setMeasuredWidth(nativeEvent.layout.width)}>
        <View className="gap-2.5 pb-4 pt-3" style={{ paddingHorizontal: gutter }}>
          <Text role="heading" className="text-3xl font-nav-semibold tracking-tight">Search</Text>
          <View style={{ width: '100%', maxWidth: 640 }}><SearchField value={value} onChangeText={changeText} onClear={clear} onSubmit={() => { setTerm(editedTerm); Keyboard.dismiss(); }} /></View>
        </View>
        <FlatList ref={list} key={columns} testID="search-results" data={phase === 'results' ? presentation.items : EMPTY}
          keyExtractor={mediaKey} numColumns={columns} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
          contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: 24 }}
          columnWrapperStyle={columns > 1 ? { gap: columnGap } : undefined}
          ItemSeparatorComponent={RowSeparator} renderItem={renderItem} initialNumToRender={columns * 3}
          ListHeaderComponent={showFilters ? <View className="pb-5" style={{ width: '100%', maxWidth: 640 }}>
            <SearchFilters value={filter} counts={presentation.counts} onChange={changeFilter} />
          </View> : null}
          ListEmptyComponent={<View className="items-center justify-center gap-3 px-2 py-8" style={styles.empty}>
            {phase === 'loading' ? <>
              <ActivityIndicator color={theme.foreground} />
              <Text variant="muted" accessibilityLiveRegion="polite">Searching titles…</Text>
            </> : <>
              <View className="size-12 items-center justify-center rounded-[14px] bg-muted">
                <Icon as={Search} size={24} className="text-muted-foreground" accessible={false} />
              </View>
              <Text role="heading" className="text-center text-xl font-nav-semibold tracking-tight" accessibilityLiveRegion="polite">
                {phase === 'idle' ? 'Find your next watch' : phase === 'error' ? 'Search is unavailable' : phase === 'filtered-empty' ? 'No results for this type' : 'No titles found'}
              </Text>
              <Text variant="muted" className="text-center" style={styles.description}>
                {phase === 'idle' ? 'Search for a movie or TV show by title, or browse titles.' : phase === 'error' ? 'Check your connection and try again.' : phase === 'filtered-empty' ? 'Choose another result type.' : 'Try another title or spelling.'}
              </Text>
              <View className="flex-row flex-wrap justify-center gap-2 pt-1">
                {phase === 'error' ? <Button variant="outline" onPress={() => void query.refetch()}><Text>Try again</Text></Button> : null}
                {phase === 'filtered-empty' ? <Button variant="outline" onPress={() => changeFilter('all')}><Text>Show all types</Text></Button> : null}
                <Button variant="secondary" onPress={browse}><Text>Browse titles</Text></Button>
              </View>
            </>}
          </View>} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rowGap: { height: 24 },
  empty: { minHeight: 260 },
  description: { maxWidth: 320 },
});
