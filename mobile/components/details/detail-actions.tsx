import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { GlassSurface } from '@/components/effects/glass-surface';
import { GlassButton } from '@/components/ui/glass-button';
import { episodeCode } from './episode-rail';
import type { MediaEpisode, MediaItem } from '@/lib/home-catalog';
import { THEME } from '@/lib/theme';
import { ArrowLeft, Heart, Play, Shuffle } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, View, type View as NativeView } from 'react-native';
import { BlurView } from 'expo-blur';
import type { RefObject } from 'react';

export function DetailBackControl({ onBack, blurTarget }: { onBack: () => void; blurTarget: RefObject<NativeView | null> }) {
  const { colorScheme } = useColorScheme();
  const button = <Button testID="title-detail-back" size="icon" variant="ghost" accessibilityLabel="Go back" className="rounded-full" haptic="selection" onPress={onBack}>
    <Icon as={ArrowLeft} size={21} color={Platform.OS === 'android' ? '#fff' : THEME[colorScheme ?? 'light'].foreground} />
  </Button>;
  if (Platform.OS === 'ios') return <GlassSurface isInteractive style={styles.glass}>{button}</GlassSurface>;
  return <View style={styles.androidControl}>
    <BlurView blurTarget={blurTarget} blurMethod="dimezisBlurViewSdk31Plus" tint="dark" intensity={65} style={StyleSheet.absoluteFill} />
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#00000036' }]} />
    {button}
  </View>;
}

function SecondaryDetailAction(props: ButtonProps) {
  return <GlassButton {...props} surfaceStyle={styles.glass} size="icon" className="rounded-full" />;
}

export function DetailActions({ item, episode, episodes, onShuffle }: { item: MediaItem; episode?: MediaEpisode; episodes: MediaEpisode[]; onShuffle: (episode: MediaEpisode) => void }) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const [liked, setLiked] = useState(false);
  const key = `navigator.liked.${item.type}.${item.id}`;
  useEffect(() => {
    let current = true;
    void AsyncStorage.getItem(key).then(value => { if (current) setLiked(value === '1'); }).catch(() => {});
    return () => { current = false; };
  }, [key]);
  const like = () => {
    const next = !liked;
    setLiked(next);
    void AsyncStorage.setItem(key, next ? '1' : '0').catch(() => {});
  };
  const play = () => Alert.alert('Playback is not available yet', 'The native player and source selection will be added in a later batch.');
  const shuffle = () => {
    if (!episodes.length) return;
    const available = episodes.filter(row => !row.released || !Number.isFinite(Date.parse(row.released)) || Date.parse(row.released) <= Date.now());
    if (!available.length) return;
    const alternatives = available.filter(row => row.id !== episode?.id);
    const choices = alternatives.length ? alternatives : available;
    onShuffle(choices[Math.floor(Math.random() * choices.length)]);
  };
  return (
    <View className="flex-row items-center gap-2" testID="detail-actions">
      <Button testID="detail-play" containerClassName="flex-1" className="rounded-full min-h-12" haptic="impact" onPress={play} accessibilityHint="Playback is not connected in this build">
        <Icon as={Play} fill={theme.background} color={theme.background} size={20} />
        <Text className="shrink text-[17px] font-nav-semibold">Play{episode ? <Text className="text-[17px] font-nav-medium" style={{ color: colorScheme === 'dark' ? '#555555' : '#d4d4d4' }}> {episodeCode(episode)}</Text> : null}</Text>
      </Button>
      {item.type === 'series' && <SecondaryDetailAction testID="detail-shuffle" accessibilityLabel="Choose a random episode" disabled={!episodes.length} haptic="selection" onPress={shuffle}><Icon as={Shuffle} size={20} /></SecondaryDetailAction>}
      <SecondaryDetailAction testID="detail-like" accessibilityLabel={liked ? 'Remove local like' : 'Like this title'} accessibilityState={{ selected: liked }} haptic="selection" onPress={like}><Icon as={Heart} size={20} color={liked ? theme.primary : theme.foreground} fill={liked ? theme.primary : 'transparent'} /></SecondaryDetailAction>
    </View>
  );
}
const styles = StyleSheet.create({
  glass: { width: 48, height: 48, padding: 0, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  androidControl: { width: 48, height: 48, borderRadius: 24, overflow: 'hidden', backgroundColor: '#00000044' },
});
