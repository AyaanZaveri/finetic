import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useEvent } from 'expo';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView, type VideoSourceObject } from 'expo-video';
import { X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Modal, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

function VideoSession({ source, onRetry }: { source: VideoSourceObject; onRetry: () => void }) {
  const player = useVideoPlayer(source, instance => {
    instance.staysActiveInBackground = false;
    instance.keepScreenOnWhilePlaying = true;
    instance.play();
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background') player.pause();
    });
    return () => subscription.remove();
  }, [player]);

  if (status === 'error') {
    return <View className="flex-1 items-center justify-center gap-4 px-6">
      <Text accessibilityRole="alert" className="text-center text-white">Could not play this stream. Retry or close the player and choose another stream.</Text>
      <Button variant="secondary" onPress={onRetry}><Text>Retry</Text></Button>
    </View>;
  }

  return <View className="flex-1">
    <VideoView testID="catalog-video" player={player} style={{ flex: 1 }} nativeControls contentFit="contain"
      fullscreenOptions={{ enable: false }} allowsVideoFrameAnalysis={false} />
    {status !== 'readyToPlay' && <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.loading]}>
      <ActivityIndicator color="#fff" accessibilityLabel="Loading stream" />
    </View>}
  </View>;
}

export function CatalogPlayer({ title, source, onClose }: { title: string; source: VideoSourceObject; onClose: () => void }) {
  const [attempt, setAttempt] = useState(0);
  return <Modal visible onRequestClose={onClose} presentationStyle="fullScreen"
    supportedOrientations={['portrait', 'landscape']}>
    <SafeAreaProvider>
      <SafeAreaView testID="catalog-player" className="flex-1 bg-black">
        <StatusBar style="light" />
        <View className="flex-row items-center gap-2 px-4 py-1">
          <Text accessibilityRole="header" numberOfLines={2} className="flex-1 font-nav-semibold text-white">{title}</Text>
          <Button testID="catalog-player-close" variant="ghost" size="icon" className="active:bg-white/15"
            accessibilityLabel="Close player" onPress={onClose}>
            <Icon as={X} color="#fff" size={24} />
          </Button>
        </View>
        <VideoSession key={attempt} source={source} onRetry={() => setAttempt(value => value + 1)} />
      </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({
  loading: { alignItems: 'center', justifyContent: 'center' },
});
