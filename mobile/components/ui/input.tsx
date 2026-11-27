import { cn } from '@/lib/utils';
import { THEME } from '@/lib/theme';
import { useColorScheme } from 'nativewind';
import { useState } from 'react';
import { TextInput } from 'react-native';

function Input({ className, onFocus, onBlur, placeholderTextColor, selectionColor, ...props }: React.ComponentProps<typeof TextInput>) {
  const [focused, setFocused] = useState(false);
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  return (
    <TextInput
      {...props}
      className={cn(
        'min-h-12 w-full min-w-0 rounded-[12px] border border-input bg-card px-3 py-2 text-base font-nav text-foreground',
        focused && 'border-ring',
        props.editable === false && 'opacity-50',
        className,
      )}
      placeholderTextColor={placeholderTextColor ?? theme.mutedForeground}
      selectionColor={selectionColor ?? theme.primary}
      onFocus={(event) => { setFocused(true); onFocus?.(event); }}
      onBlur={(event) => { setFocused(false); onBlur?.(event); }}
    />
  );
}

export { Input };
