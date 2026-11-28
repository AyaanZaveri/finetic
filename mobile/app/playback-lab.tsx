import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { playbackFixtures } from '@/assets/playback/fixtures';
import { validPlaybackUrl, type PlaybackChapter } from '@/lib/playback-fixtures';
import { Input } from '@/components/ui/input';
import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Asset } from 'expo-asset';
import { Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Selection = { label: string; source: number | string; chapters?: PlaybackChapter[]; expectedDuration?: number };
type Engine = 'expo' | 'aether';
const testClips: { id: string; selection: Selection }[] = playbackFixtures.map(fixture => ({
  id: fixture.id,
  selection: {
    label: fixture.label,
    source: fixture.asset,
    chapters: fixture.chapters,
    expectedDuration: fixture.expectedDuration,
  },
}));

if (Constants.expoConfig?.extra?.playbackAdaptiveFixtures === true) {
  // CI uses the host loopback on iOS and ADB reverse on Android.
  testClips.push(
    { id: 'adaptive-hls', selection: { label: 'HLS · H.264 / AAC', source: 'http://127.0.0.1:8765/hls/playlist.m3u8', expectedDuration: 14 } },
    { id: 'adaptive-dash', selection: { label: 'DASH · H.264 / AAC', source: 'http://127.0.0.1:8765/dash/manifest.mpd', expectedDuration: 14 } },
  );
}

// The router discovers routes before a user opens them. Defer the video import so
// an older development client can still browse, search, and open Settings.
function PlayerSession({ selection, engine }: { selection: Selection; engine: Engine }) {
  const [uri, setUri] = useState<string | null>(typeof selection.source === 'string' ? selection.source : null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (typeof selection.source === 'string') return;
    let active = true;
    // Resolve bundled video to a file URI. Android's metadata retriever
    // cannot extract thumbnails from Metro raw-resource names.
    void Asset.fromModule(selection.source).downloadAsync().then(asset => {
      if (!active) return;
      if (asset.localUri) setUri(asset.localUri);
      else setFailed(true);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [selection.source]);
  if (engine === 'aether' && !requireOptionalNativeModule('NavigatorAether')) {
    return <Text accessibilityRole="alert">Build the iOS development client with AetherEngine to use this player</Text>;
  }
  if (engine === 'expo' && !requireOptionalNativeModule('ExpoVideo')) {
    return <Text variant="muted">Rebuild the development client to test native playback.</Text>;
  }
  if (failed) return <Text testID="playback-source-error" accessibilityRole="alert">Could not open the bundled video</Text>;
  if (!uri) return <Text variant="muted">Opening test clip…</Text>;
  if (engine === 'aether') {
    const { AetherPlaybackLabPlayer } = require('@/components/playback/aether-playback-lab-player') as typeof import('@/components/playback/aether-playback-lab-player');
    return <AetherPlaybackLabPlayer {...selection} source={uri} />;
  }
  const { PlaybackLabPlayer } = require('@/components/playback/playback-lab-player') as typeof import('@/components/playback/playback-lab-player');
  return <PlaybackLabPlayer {...selection} source={uri} />;
}

export default function PlaybackLabScreen() {
  const router = useRouter();
  const focused = useIsFocused();
  const { top, bottom, left, right } = useSafeAreaInsets();
  const params = useLocalSearchParams<{ fixture?: string; auto?: string; engine?: string }>();
  const [selection, setSelection] = useState<Selection | undefined>(() =>
    params.auto === '1' ? testClips.find(clip => clip.id === params.fixture)?.selection : undefined);
  const [session, setSession] = useState(0);
  const [url, setUrl] = useState('');
  const [invalidUrl, setInvalidUrl] = useState(false);
  const [engine, setEngine] = useState<Engine>(() => Platform.OS === 'ios' && params.engine === 'aether' ? 'aether' : 'expo');
  const open = (next: Selection) => { setSelection(next); setSession(value => value + 1); };
  const hasAether = Platform.OS === 'ios' && requireOptionalNativeModule('NavigatorAether') !== null;
  const engineName = engine === 'aether' ? 'AetherEngine' : Platform.OS === 'android' ? 'Media3 ExoPlayer' : 'AVPlayer';
  return (
    <ScrollView testID="playback-lab" className="flex-1 bg-background" keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingTop: top + 12, paddingBottom: bottom + 24, paddingLeft: left + 16, paddingRight: right + 16, width: '100%', maxWidth: 760, alignSelf: 'center', gap: 16 }}>
      <Button variant="ghost" className="self-start" accessibilityLabel="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')}>
        <Text>Back</Text>
      </Button>
      <Text role="heading" className="text-3xl font-nav-semibold">Playback lab</Text>
      <Text testID={`playback-engine-${engine}`} variant="muted">{engineName} · Native playback and image extraction tests</Text>
      {hasAether && <View className="flex-row flex-wrap gap-2">
        <Button variant={engine === 'expo' ? 'default' : 'outline'} accessibilityState={{ selected: engine === 'expo' }} onPress={() => setEngine('expo')}>
          <Text>AVPlayer</Text>
        </Button>
        <Button testID="select-playback-engine-aether" variant={engine === 'aether' ? 'default' : 'outline'} accessibilityState={{ selected: engine === 'aether' }} onPress={() => setEngine('aether')}>
          <Text>AetherEngine</Text>
        </Button>
      </View>}
      {selection && focused && <PlayerSession key={`${session}-${engine}`} selection={selection} engine={engine} />}
      <Text role="heading" className="text-xl font-nav-semibold">Test clips</Text>
      {testClips.map(clip => (
        <Button testID={`playback-fixture-${clip.id}`} key={clip.id} variant="outline" className="justify-start"
          onPress={() => open(clip.selection)}>
          <Text>{clip.selection.label}</Text>
        </Button>
      ))}
      <Text role="heading" className="text-xl font-nav-semibold">Open a video URL</Text>
      <Input testID="playback-url" accessibilityLabel="HTTPS video URL" value={url} onChangeText={value => { setUrl(value); setInvalidUrl(false); }}
        keyboardType="url" autoCapitalize="none" autoCorrect={false} placeholder="https://" />
      {invalidUrl && <Text accessibilityRole="alert">Enter a valid HTTPS video URL.</Text>}
      <Button testID="playback-open-source" onPress={() => {
        const source = validPlaybackUrl(url);
        if (!source) { setInvalidUrl(true); return; }
        open({ label: 'Direct video', source });
      }}><Text>Open video</Text></Button>
      <Text variant="muted">This test screen does not connect to account add-ons or watch history.</Text>
    </ScrollView>
  );
}
