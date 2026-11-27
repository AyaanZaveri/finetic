import { MediaCard } from '@/components/media/media-card';
import { Text } from '@/components/ui/text';
import { mediaKey, type HomeSection, type MediaItem } from '@/lib/home-catalog';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback } from 'react';
import { FlatList, View, useWindowDimensions } from 'react-native';

const GAP = 12;
function Separator() { return <View style={{ width: GAP }} />; }

export function MediaSection({ section, onOpen }: { section: HomeSection; onOpen: (item: MediaItem) => void }) {
  const { width } = useWindowDimensions();
  const { left, right } = useSafeAreaInsets();
  const availableWidth = width - left - right;
  const roomy = availableWidth >= 720;
  const gutter = roomy ? (availableWidth >= 1024 ? 32 : 24) : 16;
  const padding = { paddingLeft: gutter + left, paddingRight: gutter + right };
  const cardWidth = roomy ? 144 : Math.min(152, Math.max(116, Math.floor((availableWidth - 32 - 2.35 * GAP) / 2.7)));
  const renderItem = useCallback(({ item }: { item: MediaItem }) => <MediaCard item={item} width={cardWidth} onOpen={onOpen} />, [cardWidth, onOpen]);
  return (
    <View className="gap-3" testID={`catalog-${section.key}`}>
      <Text role="heading" className={roomy ? "text-2xl font-nav-semibold tracking-tight" : "text-xl font-nav-semibold tracking-tight"} style={padding}>{section.sectionName}</Text>
      <FlatList horizontal showsHorizontalScrollIndicator={false} data={section.mediaItems} keyExtractor={mediaKey} renderItem={renderItem}
        ItemSeparatorComponent={Separator} contentContainerStyle={{ ...padding, paddingBottom: 4 }} initialNumToRender={Math.ceil(availableWidth / (cardWidth + GAP)) + 1} windowSize={5}
        getItemLayout={(_, index) => ({ length: cardWidth + GAP, offset: (cardWidth + GAP) * index, index })} />
    </View>
  );
}
