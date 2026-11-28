import { THEME } from '@/lib/theme';
import { useColorScheme } from 'nativewind';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** A centered, content-sized form for roomy windows. It is not a new page. */
export function SignInDialog({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  return <Modal visible={visible} transparent animationType="fade" presentationStyle="overFullScreen"
    statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
    <View style={styles.root}>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss sign-in" onPress={onClose}
        style={[StyleSheet.absoluteFill, styles.backdrop]} />
      <KeyboardAvoidingView pointerEvents="box-none" behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.position, {
          paddingLeft: insets.left + 24,
          paddingRight: insets.right + 24,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        }]}>
        <View testID="sign-in-dialog" accessibilityViewIsModal accessible={false} onAccessibilityEscape={onClose}
          style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          {children}
        </View>
      </KeyboardAvoidingView>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { backgroundColor: '#00000059' },
  position: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { width: '100%', maxWidth: 520, maxHeight: '100%', borderRadius: 28, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
});
