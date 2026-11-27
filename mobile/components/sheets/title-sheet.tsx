import { GlassSurface } from '@/components/effects/glass-surface';
import { ArtworkImage } from '@/components/media/artwork-image';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { mediaKey, ratingLabel, type MediaItem } from '@/lib/home-catalog';
import { THEME } from '@/lib/theme';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView, type BottomSheetBackdropProps, type BottomSheetBackgroundProps } from '@gorhom/bottom-sheet';
import { ArrowRight, X } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function SheetBackground({ style }: BottomSheetBackgroundProps) {
  return <GlassSurface style={[style, { borderRadius: 24, padding: 0 }]} />;
}

export function TitleSheet({ item, onDismiss, onView }: { item: MediaItem | null; onDismiss: () => void; onView: (item: MediaItem) => void }) {
  const modal = useRef<BottomSheetModal>(null);
  const pendingView = useRef<MediaItem | null>(null);
  const { top, bottom } = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const snapPoints = useMemo(() => ['42%', '70%'], []);
  const backdrop = useCallback((props: BottomSheetBackdropProps) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.48} pressBehavior="close" />, []);
  useEffect(() => { if (item) modal.current?.present(); }, [item]);
  return (
    <BottomSheetModal ref={modal} snapPoints={snapPoints} enableDynamicSizing={false} enablePanDownToClose detached bottomInset={bottom + 8} topInset={top}
      style={{ marginHorizontal: Math.max(8, (width - 610) / 2) }} backgroundComponent={SheetBackground} backdropComponent={backdrop}
      handleIndicatorStyle={{ backgroundColor: theme.mutedForeground, width: 32 }} onDismiss={() => { const next = pendingView.current; pendingView.current = null; onDismiss(); if (next) onView(next); }}>
      {item && <BottomSheetScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        <View testID="title-sheet" className="gap-4" accessibilityViewIsModal>
          <View className="flex-row items-start gap-4">
            <View style={styles.poster} className="overflow-hidden rounded-lg bg-muted"><ArtworkImage uri={item.poster} fallback={item.background} recyclingKey={mediaKey(item)} /></View>
            <View className="flex-1 gap-2">
              <Text role="heading" className="text-2xl font-nav-semibold tracking-tight">{item.name}</Text>
              <Text variant="muted">{[item.year, item.type === 'movie' ? 'Movie' : 'TV Show', ratingLabel(item) ? `★ ${ratingLabel(item)}` : undefined].filter(Boolean).join(' · ')}</Text>
              {!!item.genres?.length && <Text variant="muted">{item.genres.slice(0, 3).join(' · ')}</Text>}
            </View>
            <Button testID="title-sheet-close" variant="ghost" size="icon" accessibilityLabel="Close title details" onPress={() => modal.current?.dismiss()}><Icon as={X} size={20} /></Button>
          </View>
          <Button testID="quick-view-title" onPress={() => { pendingView.current = item; modal.current?.dismiss(); }}><Text>View</Text><Icon as={ArrowRight} size={18} /></Button>
        </View>
      </BottomSheetScrollView>}
    </BottomSheetModal>
  );
}
const styles = StyleSheet.create({ poster: { width: 86, aspectRatio: 2 / 3 } });
