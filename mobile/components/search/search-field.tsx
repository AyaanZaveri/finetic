import { GlassSurface } from '@/components/effects/glass-surface';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { triggerHaptic } from '@/lib/haptics';
import { THEME } from '@/lib/theme';
import { Search, X } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

export function SearchField({ value, onChangeText, onSubmit, onClear }: {
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const surface = [styles.surface, { paddingEnd: value ? 4 : 16 }];
  return <View style={[surface, Platform.OS !== 'ios' && { backgroundColor: theme.muted }]}>
    {/* Keep the input mounted when the glass accessibility fallback changes. */}
    {Platform.OS === 'ios' && <GlassSurface pointerEvents="none" style={styles.glass}
      fallbackStyle={{ backgroundColor: theme.muted, borderWidth: 0 }} />}
    <Icon as={Search} size={20} className="text-muted-foreground" accessible={false} />
    <Input testID="search-input" placeholder="Search titles" accessibilityLabel="Search movies and TV shows"
      className="min-h-[52px] w-auto flex-1 rounded-none border-0 bg-transparent px-2.5 py-2 font-nav-medium"
      style={styles.input}
      value={value} onChangeText={onChangeText} maxLength={300} returnKeyType="search"
      autoCorrect={false} clearButtonMode="never" onSubmitEditing={onSubmit} />
    {value.length > 0 ? <Pressable testID="search-clear" role="button" accessibilityLabel="Clear search"
      className="min-h-12 min-w-12 items-center justify-center rounded-full active:opacity-60"
      onPress={() => { triggerHaptic('selection'); onClear(); }}>
      <Icon as={X} size={22} className="text-muted-foreground" accessible={false} />
    </Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  surface: { minHeight: 52, flexDirection: 'row', alignItems: 'center', borderRadius: 999, padding: 0, paddingStart: 16 },
  glass: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 999, padding: 0, borderWidth: 0 },
  input: { textAlignVertical: 'center', includeFontPadding: false, minWidth: 0 },
});
