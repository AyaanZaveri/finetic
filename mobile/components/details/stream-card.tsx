import { DetailChip } from './detail-chip';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { triggerHaptic } from '@/lib/haptics';
import type { StreamPlayback } from '@/lib/stream-selection';
import { THEME } from '@/lib/theme';
import { ExternalLink, Star, Zap } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { Pressable, StyleSheet, View } from 'react-native';

export type StreamCardPresentation = {
  resolution?: string;
  source?: string;
  lightning: boolean;
  stars: boolean[];
  details: string[];
};

export function StreamCard({ presentation, label, filename, size, action, onSelect }: {
  presentation: StreamCardPresentation;
  label: string;
  filename?: string;
  size?: number;
  action?: StreamPlayback['kind'];
  onSelect: () => void;
}) {
  const { resolution, source, lightning, stars, details } = presentation;
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const fileSize = typeof size === 'number' && Number.isFinite(size) && size > 0 ? `${(size / 1024 ** 3).toFixed(2)} GB` : undefined;
  const disabled = !action;
  return <Pressable
    accessibilityRole="button" accessibilityState={{ disabled }}
    accessibilityHint={action === 'native' ? 'Play this stream' : action === 'external' ? 'Open this link in another app' : 'This source cannot play'}
    disabled={disabled} onPress={() => { triggerHaptic('selection'); onSelect(); }}
    style={({ pressed }) => [styles.card, {
      backgroundColor: pressed ? theme.muted : colorScheme === 'dark' ? '#292929b3' : '#ffffffb3',
      borderColor: theme.border,
      opacity: disabled ? 0.55 : 1,
    }]}>
    <View className="flex-row flex-wrap items-center gap-2">
      {resolution && <Text className="font-nav-semibold text-[15px]">{resolution}</Text>}
      {lightning && <Icon as={Zap} size={15} color="#eab308" fill="#eab308" accessibilityLabel="Lightning" />}
      {source && <DetailChip material={false}><Text>{source}</Text></DetailChip>}
      {!resolution && !source && !lightning && <Text className="font-nav-medium text-[15px] shrink">{label}</Text>}
      {action === 'external' && <Icon as={ExternalLink} color={theme.mutedForeground} size={16} style={{ marginLeft: 'auto' }} />}
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
