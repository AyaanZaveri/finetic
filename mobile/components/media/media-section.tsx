import { MediaCard } from '@/components/media/media-card';
import { Text } from '@/components/ui/text';
import { mediaKey, type HomeSection, type MediaItem } from '@/lib/home-catalog';
import { useCallback } from 'react';
import { FlatList, View, useWindowDimensions } from 'react-native';

const GAP = 16;
function Separator() { return <View style={{ width: GAP }} />; }

export function MediaSection({ section, onOpen, onQuickActions }: { section: HomeSection; onOpen: (item: MediaItem) => void; onQuickActions?: (item: MediaItem) => void }) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(152, Math.max(116, Math.floor((width - 32 - 2.35 * GAP) / 2.7)));
  const renderItem = useCallback(({ item }: { item: MediaItem }) => <MediaCard item={item} width={cardWidth} onOpen={onOpen} onQuickActions={onQuickActions} />, [cardWidth, onOpen, onQuickActions]);
  return (
    <View className="gap-3" testID={`catalog-${section.key}`}>
      <Text role="heading" className="px-4 text-xl font-nav-semibold tracking-tight">{section.sectionName}</Text>
      <FlatList horizontal showsHorizontalScrollIndicator={false} data={section.mediaItems} keyExtractor={mediaKey} renderItem={renderItem}
        ItemSeparatorComponent={Separator} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 4 }} initialNumToRender={5} windowSize={5}
        getItemLayout={(_, index) => ({ length: cardWidth + GAP, offset: (cardWidth + GAP) * index, index })} />
    </View>
  );
}
