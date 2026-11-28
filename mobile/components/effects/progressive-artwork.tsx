import { artworkBlurLayers, createArtworkLoadTracker, lightArtworkTopScrim, type ArtworkQuality } from '@/lib/progressive-artwork';
import MaskedView from '@react-native-masked-view/masked-view';
import { Image, type ImageProps } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

interface ProgressiveArtworkProps {
  uri: string;
  backgroundColor: string;
  light?: boolean;
  prominentLightScrim?: boolean;
  quality?: ArtworkQuality;
  contentPosition?: ImageProps['contentPosition'];
  onReady?: () => void;
}

function ArtworkComposite({
  uri, backgroundColor, light = false, prominentLightScrim = false,
  quality = 'full', contentPosition = 'center', onReady, focused,
}: ProgressiveArtworkProps & { focused: boolean }) {
  const layers = focused || quality === 'carousel' ? artworkBlurLayers(quality, Platform.OS) : [];
  const trackLoad = useRef(createArtworkLoadTracker(layers.length + 1));
  const reveal = useSharedValue(0);
  const opacity = useAnimatedStyle(() => ({ opacity: reveal.get() }));
  const settle = (part: number) => {
    if (!trackLoad.current(part)) return;
    // Do not reveal just the sharp backdrop. Both masks and the underlying
    // image are decoded first. The parent carousel controls the slide fade.
    reveal.set(onReady ? 1 : withTiming(1, { duration: 300, reduceMotion: ReduceMotion.System }));
    onReady?.();
  };
  return (
    <View pointerEvents="none" accessible={false} style={[StyleSheet.absoluteFill, { backgroundColor }]}>
      <Animated.View style={[StyleSheet.absoluteFill, opacity]}>
        <Image source={uri}
          style={[StyleSheet.absoluteFill, light && { opacity: 0.88 }]}
          contentFit="cover" contentPosition={contentPosition} cachePolicy="memory-disk"
          transition={0} onDisplay={() => settle(0)} onError={() => settle(0)} />
        {layers.map(({ radius, start, end }, index) => (
          <MaskedView key={radius} style={StyleSheet.absoluteFill}
            maskElement={<LinearGradient style={StyleSheet.absoluteFill} colors={['transparent', 'transparent', '#000', '#000']} locations={[0, start, end, 1]} />}>
            {/* On a failed blur request, the masked theme color remains as a
                safe fallback instead of revealing a sharp image behind it. */}
            <View style={[StyleSheet.absoluteFill, { backgroundColor }]}>
              <Image source={uri} style={StyleSheet.absoluteFill} contentFit="cover"
                contentPosition={contentPosition} cachePolicy="disk" blurRadius={radius}
                transition={0} onDisplay={() => settle(index + 1)} onError={() => settle(index + 1)} />
            </View>
          </MaskedView>
        ))}
        <LinearGradient style={StyleSheet.absoluteFill} colors={light
          ? prominentLightScrim
            ? ['transparent', 'transparent', 'rgba(255,255,255,0.72)', 'rgba(255,255,255,0.98)']
            : ['transparent', 'transparent', 'rgba(255,255,255,0.32)', 'rgba(255,255,255,0.94)']
          : ['rgba(6,10,12,0.5)', 'transparent', 'rgba(6,10,12,0.65)', 'rgba(6,10,12,0.85)']} locations={light && prominentLightScrim ? [0, 0.26, 0.55, 0.89] : [0, 0.26, 0.60, 0.89]} />
      </Animated.View>
    </View>
  );
}

/** One stationary overlay above the hero crossfade or detail artwork. */
export function ArtworkTopScrim({ light, topInset, artworkHeight, style }: { light: boolean; topInset: number; artworkHeight: number; style?: { zIndex?: number } }) {
  if (!light) return null;
  const { colors, locations } = lightArtworkTopScrim(topInset, artworkHeight);
  // Use the full-height shader with a transparent tail, not a shortened
  // gradient endpoint. This avoids the Android endpoint clamp artifact.
  return <LinearGradient pointerEvents="none" accessible={false} colors={colors} locations={locations}
    start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
    style={[StyleSheet.absoluteFill, style]} />;
}

export function ProgressiveArtwork(props: ProgressiveArtworkProps) {
  const focused = useIsFocused();
  // Carousel layers are not promoted or rebuilt when a slide becomes active.
  // Detail routes retain the existing offscreen memory optimization.
  const blurMounted = focused || props.quality === 'carousel';
  return <ArtworkComposite key={props.uri + ':' + blurMounted} {...props} focused={focused} />;
}
