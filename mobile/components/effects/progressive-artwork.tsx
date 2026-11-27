import MaskedView from '@react-native-masked-view/masked-view';
import { Image, type ImageProps } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

// A blur-radius ramp using the known image. Each successive layer blends in a
// stronger blur toward the lower edge; masks are static and never animate.
const BLUR_LAYERS = [
  { radius: 4, start: 0.42, end: 0.68 },
  { radius: 12, start: 0.58, end: 0.82 },
  { radius: 24, start: 0.72, end: 0.96 },
] as const;

interface ProgressiveArtworkProps {
  uri: string;
  backgroundColor: string;
  light?: boolean;
  contentPosition?: ImageProps['contentPosition'];
}

export function ProgressiveArtwork({ uri, backgroundColor, light = false, contentPosition = "center" }: ProgressiveArtworkProps) {
  const reducedMotion = useReducedMotion();
  return (
    <View pointerEvents="none" accessible={false} style={[StyleSheet.absoluteFill, { backgroundColor }]}>
      <Image source={uri} style={[StyleSheet.absoluteFill, light && { opacity: 0.88 }]} contentFit="cover" contentPosition={contentPosition} cachePolicy="memory-disk" transition={reducedMotion ? 0 : 300} />
      {BLUR_LAYERS.map(({ radius, start, end }) => (
        <MaskedView key={`${uri}-${radius}`} style={StyleSheet.absoluteFill}
          maskElement={<LinearGradient style={StyleSheet.absoluteFill} colors={['transparent', 'transparent', '#000', '#000']} locations={[0, start, end, 1]} />}>
          <Image source={uri} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition={contentPosition} cachePolicy="memory-disk" blurRadius={radius} />
        </MaskedView>
      ))}
      <LinearGradient style={StyleSheet.absoluteFill} colors={light
        ? ['rgba(255,255,255,0.24)', 'transparent', 'rgba(255,255,255,0.32)', 'rgba(255,255,255,0.94)']
        : ['rgba(6,10,12,0.5)', 'transparent', 'rgba(6,10,12,0.65)', 'rgba(6,10,12,0.85)']} locations={[0, 0.26, 0.60, 0.89]} />
    </View>
  );
}
