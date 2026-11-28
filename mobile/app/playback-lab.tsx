import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { playbackFixtures } from '@/assets/playback/fixtures';
import { validPlaybackUrl, type PlaybackChapter } from '@/lib/playback-fixtures';
import { Input } from '@/components/ui/input';
import { requireOptionalNativeModule } from 'expo';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Asset } from 'expo-asset';
import { Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Selection = { label: string; source: number | string; chapters?: PlaybackChapter[]; expectedDuration?: number };

// The router discovers routes before a user opens them. Defer the video import so
// an older development client can still browse, search, and open Settings.
function PlayerSession({ selection }: { selection: Selection }) {
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
  if (!requireOptionalNativeModule('ExpoVideo')) {
    return <Text variant="muted">Rebuild the development client to test native playback.</Text>;
  }
  if (failed) return <Text testID="playback-source-error" accessibilityRole="alert">Could not open the bundled video</Text>;
  if (!uri) return <Text variant="muted">Opening test clip…</Text>;
  const { PlaybackLabPlayer } = require('@/components/playback/playback-lab-player') as typeof import('@/components/playback/playback-lab-player');
  return <PlaybackLabPlayer {...selection} source={uri} />;
}

export default function PlaybackLabScreen() {
  const router = useRouter();
  const focused = useIsFocused();
  const { top, bottom, left, right } = useSafeAreaInsets();
  const params = useLocalSearchParams<{ fixture?: string; auto?: string }>();
  const initial = params.auto === '1' ? playbackFixtures.find(fixture => fixture.id === params.fixture) : undefined;
  const [selection, setSelection] = useState<Selection | undefined>(() => initial && { label: initial.label, source: initial.asset, chapters: initial.chapters, expectedDuration: initial.expectedDuration });
  const [session, setSession] = useState(0);
  const [url, setUrl] = useState('');
  const [invalidUrl, setInvalidUrl] = useState(false);
  const open = (next: Selection) => { setSelection(next); setSession(value => value + 1); };
  const engine = Platform.OS === 'android' ? 'Media3 ExoPlayer' : 'AVPlayer';
  return (
    <ScrollView testID="playback-lab" className="flex-1 bg-background" keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingTop: top + 12, paddingBottom: bottom + 24, paddingLeft: left + 16, paddingRight: right + 16, width: '100%', maxWidth: 760, alignSelf: 'center', gap: 16 }}>
      <Button variant="ghost" className="self-start" accessibilityLabel="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')}>
        <Text>Back</Text>
      </Button>
      <Text role="heading" className="text-3xl font-nav-semibold">Playback lab</Text>
      <Text variant="muted">{engine} · Native playback and image extraction tests</Text>
      {selection && focused && <PlayerSession key={session} selection={selection} />}
      <Text role="heading" className="text-xl font-nav-semibold">Test clips</Text>
      {playbackFixtures.map(fixture => (
        <Button testID={`playback-fixture-${fixture.id}`} key={fixture.id} variant="outline" className="justify-start"
          onPress={() => open({ label: fixture.label, source: fixture.asset, chapters: fixture.chapters, expectedDuration: fixture.expectedDuration })}>
          <Text>{fixture.label}</Text>
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
