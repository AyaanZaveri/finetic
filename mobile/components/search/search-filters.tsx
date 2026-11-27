import { Text } from '@/components/ui/text';
import { triggerHaptic } from '@/lib/haptics';
import type { SearchFilter } from '@/lib/search-presentation';
import { cn } from '@/lib/utils';
import { Pressable, View } from 'react-native';

const filters: { value: SearchFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'movie', label: 'Movies' },
  { value: 'series', label: 'TV shows' },
];

export function SearchFilters({ value, counts, onChange }: {
  value: SearchFilter;
  counts: Record<SearchFilter, number>;
  onChange: (value: SearchFilter) => void;
}) {
  return <View className="flex-row flex-wrap gap-1 self-start rounded-[16px] border border-border bg-muted p-1" accessibilityLabel="Result types">
    {filters.map(filter => {
      const selected = filter.value === value;
      const count = counts[filter.value];
      return <Pressable key={filter.value} testID={`search-filter-${filter.value}`} role="button"
        accessibilityLabel={`${filter.label}, ${count} ${count === 1 ? 'title' : 'titles'}`} accessibilityState={{ selected }}
        className={cn('min-h-11 max-w-full flex-row flex-wrap items-center justify-center gap-1.5 rounded-[12px] border border-transparent px-2.5 py-2 active:opacity-70', selected && 'border-border bg-card')}
        onPress={() => { if (!selected) { triggerHaptic('selection'); onChange(filter.value); } }}>
        <Text className={cn('text-sm font-nav-medium', !selected && 'text-muted-foreground')}>{filter.label}</Text>
        <Text className="text-xs tabular-nums text-muted-foreground">{count}</Text>
      </Pressable>;
    })}
  </View>;
}
