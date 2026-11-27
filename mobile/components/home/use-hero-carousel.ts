import { carouselIndex, dragProgress, incomingIndex, snapDirection } from '@/lib/hero-carousel';
import { triggerHaptic } from '@/lib/haptics';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { I18nManager } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { cancelAnimation, Easing, ReduceMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

export function useHeroCarousel(count: number, width: number) {
  const [selection, setSelection] = useState(0);
  const [tapTarget, setTapTarget] = useState<number | null>(null);
  const selectedRef = useRef(0);
  const base = useSharedValue(0);
  const progress = useSharedValue(0);
  const direct = useSharedValue(-1);
  const start = useSharedValue(0);
  const dragging = useSharedValue(false);
  const settling = useSharedValue(false);
  const direction = I18nManager.isRTL ? 1 : -1;

  const commit = useCallback((index: number) => {
    if (index !== selectedRef.current) {
      selectedRef.current = index;
      triggerHaptic('carousel');
      setSelection(index);
    }
    setTapTarget(null);
  }, []);

  // Keep the current and incoming keyed layers visible until React has adopted
  // the new selection. Reset the UI-runtime state together before the next frame.
  useLayoutEffect(() => {
    const next = carouselIndex(selection, count);
    if (next !== selection) {
      selectedRef.current = next;
      setSelection(next);
    }
    scheduleOnUI(() => {
      'worklet';
      base.set(next);
      progress.set(0);
      direct.set(-1);
      settling.set(false);
    });
  }, [selection, count, base, progress, direct, settling]);

  const clearTap = useCallback(() => setTapTarget(null), []);
  const pan = useMemo(() => Gesture.Pan()
    .enabled(count > 1)
    .activeOffsetX([-10, 10])
    .failOffsetY([-12, 12])
    .onStart(() => {
      cancelAnimation(progress);
      start.set(progress.get());
      dragging.set(true);
      settling.set(false);
    })
    .onUpdate(event => {
      progress.set(dragProgress(start.get(), event.translationX * direction, width));
    })
    .onEnd((event, success) => {
      dragging.set(false);
      const velocity = event.velocityX * direction;
      const snap = success ? snapDirection(progress.get(), velocity, width) : 0;
      const next = snap ? incomingIndex(base.get(), snap, direct.get(), count) : base.get();
      settling.set(true);
      progress.set(withSpring(snap, {
        duration: 300, dampingRatio: 1, velocity: velocity / Math.max(width, 1),
        overshootClamping: true, reduceMotion: ReduceMotion.System,
      }, finished => {
        if (!finished) return;
        if (snap && next !== base.get()) scheduleOnRN(commit, next);
        else {
          direct.set(-1);
          settling.set(false);
          scheduleOnRN(clearTap);
        }
      }));
    })
    .onFinalize(() => {
      if (!dragging.get()) return;
      dragging.set(false);
      progress.set(withSpring(0, { duration: 300, dampingRatio: 1, overshootClamping: true, reduceMotion: ReduceMotion.System }, finished => {
        if (finished) {
          direct.set(-1);
          settling.set(false);
          scheduleOnRN(clearTap);
        }
      }));
    }), [count, width, direction, base, progress, start, direct, dragging, settling, commit, clearTap]);

  const choose = useCallback((index: number) => {
    if (index === selectedRef.current) return;
    setTapTarget(index);
  }, []);

  useEffect(() => {
    if (tapTarget === null || tapTarget === selection) return;
    const target = tapTarget;
    // A dot tap is a short crossfade, not a swipe through all intermediate titles.
    scheduleOnUI(() => {
      'worklet';
      cancelAnimation(progress);
      const priorTarget = incomingIndex(base.get(), progress.get(), direct.get(), count);
      const initial = priorTarget === target ? Math.abs(progress.get()) : 0;
      direct.set(target);
      progress.set(initial);
      settling.set(true);
      progress.set(withTiming(1, {
        duration: 200, easing: Easing.bezier(0.23, 1, 0.32, 1), reduceMotion: ReduceMotion.System,
      }, finished => { if (finished) scheduleOnRN(commit, target); }));
    });
  }, [tapTarget, selection, count, base, direct, progress, settling, commit]);

  const indices = useMemo(() => Array.from(new Set([
    carouselIndex(selection, count),
    carouselIndex(selection - 1, count),
    carouselIndex(selection + 1, count),
    ...(tapTarget === null ? [] : [tapTarget]),
  ])).filter(index => index < count), [selection, count, tapTarget]);

  return { selection, base, progress, direct, indices, choose, pan };
}
