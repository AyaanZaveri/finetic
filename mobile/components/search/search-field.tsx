import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { triggerHaptic } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import { Search, XCircle } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

export function SearchField({ value, onChangeText, onSubmit, onClear }: {
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return <View className={cn('min-h-12 flex-row items-center rounded-[12px] border border-input bg-card pl-3', focused && 'border-ring')}>
    <Icon as={Search} size={20} className="text-muted-foreground" accessible={false} />
    <Input testID="search-input" placeholder="Search titles" accessibilityLabel="Search movies and TV shows"
      className="min-h-12 w-auto flex-1 rounded-none border-0 bg-transparent px-2 py-2"
      value={value} onChangeText={onChangeText} maxLength={300} returnKeyType="search"
      autoCorrect={false} clearButtonMode="never" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onSubmitEditing={onSubmit} />
    {value.length > 0 ? <Pressable testID="search-clear" role="button" accessibilityLabel="Clear search"
      className="min-h-12 min-w-12 items-center justify-center active:opacity-60"
      onPress={() => { triggerHaptic('selection'); onClear(); }}>
      <Icon as={XCircle} size={20} className="text-muted-foreground" accessible={false} />
    </Pressable> : null}
  </View>;
}
