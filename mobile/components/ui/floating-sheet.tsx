import { GlassSurface } from '@/components/effects/glass-surface';
import { THEME } from '@/lib/theme';
import {
  BottomSheetBackdrop, BottomSheetModal,
  type BottomSheetBackdropProps, type BottomSheetBackgroundProps, type BottomSheetModalProps,
} from '@gorhom/bottom-sheet';
import { BlurView } from 'expo-blur';
import { useColorScheme } from 'nativewind';
import { useCallback, type Ref, type RefObject } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

export type FloatingSheetLayout = {
  marginLeft: number; marginRight: number; topInset: number; bottomInset: number; snapHeight: number;
};

function SheetBackdrop(props: BottomSheetBackdropProps) {
  return <BottomSheetBackdrop {...props} opacity={0.26} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />;
}

/** Shared detached drawer material and safe-area geometry for contextual actions. */
export function FloatingSheet({ ref, layout, blurTarget, children, ...props }: Pick<BottomSheetModalProps, 'children' | 'onDismiss' | 'keyboardBehavior' | 'keyboardBlurBehavior' | 'android_keyboardInputMode' | 'enableBlurKeyboardOnGesture'> & {
  ref: Ref<BottomSheetModal>;
  layout: FloatingSheetLayout;
  blurTarget?: RefObject<View | null>;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const SheetBackground = useCallback(({ style, pointerEvents }: BottomSheetBackgroundProps) => {
    const surfaceStyle = [style, styles.background];
    if (Platform.OS === 'ios') return <GlassSurface pointerEvents={pointerEvents} style={surfaceStyle}
      fallbackStyle={{ backgroundColor: theme.card, borderWidth: 0 }} />;
    const canBlur = Platform.OS === 'android' && Number(Platform.Version) >= 31 && blurTarget;
    return <View pointerEvents={pointerEvents} style={[surfaceStyle, { backgroundColor: canBlur ? 'transparent' : theme.card }]}>
      {canBlur && <>
        <BlurView blurTarget={blurTarget} blurMethod="dimezisBlurViewSdk31Plus" tint={colorScheme ?? 'light'} intensity={45} style={StyleSheet.absoluteFill} />
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colorScheme === 'dark' ? '#171717db' : '#ffffffde' }]} />
      </>}
    </View>;
  }, [colorScheme, theme.card, blurTarget]);
  return <BottomSheetModal {...props} ref={ref} accessible={false}
    style={[styles.sheet, { marginLeft: layout.marginLeft, marginRight: layout.marginRight }]}
    detached bottomInset={layout.bottomInset} topInset={layout.topInset} snapPoints={[layout.snapHeight]}
    backdropComponent={SheetBackdrop} enableDynamicSizing={false} backgroundComponent={SheetBackground}
    handleIndicatorStyle={{ backgroundColor: theme.mutedForeground }}>
    {children}
  </BottomSheetModal>;
}

const styles = StyleSheet.create({
  background: { borderRadius: 28, overflow: 'hidden', padding: 0, borderWidth: 0 },
  sheet: { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
});
