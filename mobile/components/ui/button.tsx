import { TextClassContext } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { triggerHaptic, type HapticFeedback } from '@/lib/haptics';
import { pressScale } from '@/lib/interaction-policy';
import { cva, type VariantProps } from 'class-variance-authority';
import { ActivityIndicator, Platform, Pressable, type ViewStyle, type StyleProp } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { cssInterop, useColorScheme } from 'nativewind';
import { THEME } from '@/lib/theme';

// Reusables source, adapted locally to Navigator's neutral actions and touch targets.
const buttonVariants = cva('group shrink-0 flex-row items-center justify-center gap-2 rounded-[12px] border border-transparent', {
  variants: {
    variant: {
      default: 'bg-foreground active:opacity-[0.85]',
      destructive: 'bg-destructive/20 active:bg-destructive/30',
      outline: 'border-border bg-card active:bg-muted',
      secondary: 'bg-secondary active:bg-muted',
      ghost: 'active:bg-accent',
      link: 'bg-transparent',
    },
    size: {
      default: 'min-h-12 px-4 py-2',
      sm: 'min-h-12 px-3 py-2',
      lg: 'min-h-[50px] rounded-[14px] px-5 py-3',
      icon: 'size-12',
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

const buttonTextVariants = cva('text-sm font-nav-medium', {
  variants: {
    variant: {
      default: 'text-background',
      destructive: 'text-destructive',
      outline: 'text-foreground',
      secondary: 'text-secondary-foreground',
      ghost: 'text-foreground',
      link: 'text-primary',
    },
    size: { default: '', sm: '', lg: '', icon: '' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
// NativeWind registers Pressable, but not newly created animated wrappers.
cssInterop(AnimatedPressable, { className: 'style' });

type ButtonProps = Omit<React.ComponentProps<typeof Pressable>, 'style'> &
  VariantProps<typeof buttonVariants> & {
    style?: StyleProp<ViewStyle>;
    loading?: boolean;
    haptic?: HapticFeedback;
  };

function Button({
  className, variant = 'default', size, style, loading = false, haptic = 'none',
  disabled, children, onPress, onPressIn, onPressOut, accessibilityState, ...props
}: ButtonProps) {
  const pressed = useSharedValue(1);
  const reduceMotion = useReducedMotion();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const inert = disabled || loading;
  const motion = useAnimatedStyle(() => ({ transform: [{ scale: pressed.get() }] }));
  const spinnerColor = variant === 'default' ? theme.background : variant === 'destructive' ? theme.destructive : theme.foreground;
  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant, size })}>
      <AnimatedPressable
        {...props}
        role="button"
        disabled={inert}
        accessibilityState={{ ...accessibilityState, disabled: !!inert, busy: loading }}
        className={cn(buttonVariants({ variant, size }), inert && 'opacity-50', className)}
        style={[style, motion]}
        onPressIn={(event) => {
          pressed.set(withTiming(pressScale(Platform.OS, reduceMotion), {
            duration: 110, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System,
          }));
          onPressIn?.(event);
        }}
        onPressOut={(event) => {
          pressed.set(withTiming(1, { duration: 150, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System }));
          onPressOut?.(event);
        }}
        onPress={(event) => {
          if (inert) return;
          if (onPress) triggerHaptic(haptic);
          onPress?.(event);
        }}
      >
        {loading ? <ActivityIndicator color={spinnerColor} /> : children}
      </AnimatedPressable>
    </TextClassContext.Provider>
  );
}

export { Button, buttonTextVariants, buttonVariants };
export type { ButtonProps };
