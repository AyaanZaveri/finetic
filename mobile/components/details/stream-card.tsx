import { DetailChip } from './detail-chip';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { triggerHaptic } from '@/lib/haptics';
import { THEME } from '@/lib/theme';
import { Check, Star, Zap } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { Pressable, StyleSheet, View } from 'react-native';

export type StreamCardPresentation = {
  resolution?: string;
  source?: string;
  lightning: boolean;
  stars: boolean[];
  details: string[];
};

export function StreamCard({ presentation, label, filename, size, selected, disabled, onSelect }: {
  presentation: StreamCardPresentation;
  label: string;
  filename?: string;
  size?: number;
  selected?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const { resolution, source, lightning, stars, details } = presentation;
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const fileSize = typeof size === 'number' && Number.isFinite(size) && size > 0 ? `${(size / 1024 ** 3).toFixed(2)} GB` : undefined;
  return <Pressable
    accessibilityRole="button" accessibilityState={{ selected: !!selected, disabled: !!disabled }}
    accessibilityHint={disabled ? 'This source cannot be selected' : 'Select this stream'}
    disabled={disabled} onPress={() => { triggerHaptic('selection'); onSelect(); }}
    style={({ pressed }) => [styles.card, {
      backgroundColor: pressed ? theme.muted : colorScheme === 'dark' ? '#292929b3' : '#ffffffb3',
      borderColor: selected ? theme.primary : theme.border,
      opacity: disabled ? 0.55 : 1,
    }]}>
    <View className="flex-row flex-wrap items-center gap-2">
      {resolution && <Text className="font-nav-semibold text-[15px]">{resolution}</Text>}
      {lightning && <Icon as={Zap} size={15} color="#eab308" fill="#eab308" accessibilityLabel="Lightning" />}
      {source && <DetailChip material={false}><Text>{source}</Text></DetailChip>}
      {!resolution && !source && !lightning && <Text className="font-nav-medium text-[15px] shrink">{label}</Text>}
      {selected && <Icon as={Check} color={theme.primary} size={18} style={{ marginLeft: 'auto' }} accessibilityLabel="Selected" />}
    </View>
    {stars.length > 0 && <View accessible accessibilityLabel={`${stars.filter(Boolean).length} of ${stars.length} stars`} className="flex-row flex-wrap items-center gap-0.5 py-0.5">
      {stars.map((filled, index) => <Icon key={index} as={Star} size={14} color={theme.foreground} fill={filled ? theme.foreground : 'none'} />)}
    </View>}
    {details.map((line, index) => line !== label || resolution || source || lightning ? <Text key={index} variant="muted">{line}</Text> : null)}
    {(filename || fileSize) && <Text variant="muted">{filename}{filename && fileSize ? ' · ' : ''}{fileSize && <Text className="text-sm font-nav-medium text-muted-foreground">{fileSize}</Text>}</Text>}
  </Pressable>;
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderCurve: 'continuous', borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 3, minHeight: 48 },
});
