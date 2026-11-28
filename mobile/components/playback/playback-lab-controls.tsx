import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { formatPlaybackTime, seekTarget, type PlaybackChapter } from '@/lib/playback-fixtures';
import { createPlaybackPreviewPipeline, type PlaybackPreview } from '@/lib/playback-preview';
import type { SharedRefType } from 'expo';
import { Image } from 'expo-image';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

export type PlaybackLabSource = {
  label: string;
  source: string;
  chapters?: PlaybackChapter[];
  expectedDuration?: number;
};

export type PlaybackImage = SharedRefType<'image'> & { width: number; height: number };

type Props = Omit<PlaybackLabSource, 'source'> & {
  video: ReactNode;
  currentTime: number;
  duration: number;
  firstFrame: boolean;
  isPlaying: boolean;
  ended: boolean;
  failed: boolean;
  seekComplete: boolean;
  seek: (time: number) => void;
  toggle: () => void;
  extract: (time: number) => Promise<PlaybackImage | null>;
};

const NO_CHAPTERS: PlaybackChapter[] = [];
type PreviewResult = PlaybackPreview<PlaybackImage> & { request: number; cached: boolean; started: number };

export function PlaybackLabControls({
  label, chapters = NO_CHAPTERS, expectedDuration, video, currentTime, duration,
  firstFrame, isPlaying, ended, failed, seekComplete, seek, toggle, extract,
}: Props) {
  const [progressed, setProgressed] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [previewTimes, setPreviewTimes] = useState<{ cold?: number; cached?: number }>({});
  const [chapterImages, setChapterImages] = useState<Record<number, PlaybackImage>>({});
  const [chapterFailures, setChapterFailures] = useState<Record<number, boolean>>({});
  const pipeline = useRef<ReturnType<typeof createPlaybackPreviewPipeline<PlaybackImage>> | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const requestVersion = useRef(0);

  useEffect(() => {
    if (currentTime > 0.5) setProgressed(true);
  }, [currentTime]);

  useEffect(() => {
    if (duration <= 0 || failed) return;
    const owner = createPlaybackPreviewPipeline<PlaybackImage>({
      duration,
      maxEntries: 24,
      maxBytes: 8 * 1024 * 1024,
      bytes: frame => frame.width * frame.height * 4,
      extract,
    });
    pipeline.current = owner;
    return () => {
      requestVersion.current++;
      owner.dispose();
      pipeline.current = null;
    };
  }, [duration, extract, failed]);

  useEffect(() => {
    if (!firstFrame || failed || !pipeline.current) return;
    const owner = pipeline.current;
    let active = true;
    // Only load a bounded chapter strip after a frame is ready. Scrub requests
    // have priority over queued chapter extraction.
    for (const [index, chapter] of chapters.slice(0, 8).entries()) {
      void owner.requestChapter(chapter.time).then(result => {
        if (!active) return;
        if (result) setChapterImages(images => ({ ...images, [index]: result.frame }));
        else setChapterFailures(failures => ({ ...failures, [index]: true }));
      });
    }
    return () => { active = false; };
  }, [firstFrame, duration, chapters, extract, failed]);

  const generatePreview = (target: number) => {
    const owner = pipeline.current;
    if (!owner) return;
    const version = ++requestVersion.current;
    const cached = owner.getCached(target) !== null;
    const started = performance.now();
    setPreview(null);
    setPreviewState('loading');
    void owner.requestScrub(target).then(result => {
      if (owner !== pipeline.current || version !== requestVersion.current) return;
      setPreview(result ? { ...result, request: version, cached, started } : null);
      setPreviewState(result ? 'ready' : 'error');
    });
  };
  const midpoint = seekTarget(duration, 0.5);
  const available = firstFrame && duration > 0 && !failed;
  return (
    <View className="gap-3" testID="playback-player">
      <Text role="heading" className="text-lg font-nav-semibold">{label}</Text>
      <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' }}>
        {video}
      </View>
      <View className="flex-row flex-wrap items-center gap-2">
        {failed ? <Text testID="playback-error" accessibilityRole="alert">This source could not play</Text> : <>
          <Text testID={firstFrame ? 'playback-first-frame' : 'playback-loading'}>{firstFrame ? 'First frame rendered' : 'Loading video…'}</Text>
          {firstFrame && <Text testID={ended ? 'playback-ended' : isPlaying ? 'playback-playing' : 'playback-paused'} variant="muted">{ended ? 'Ended' : isPlaying ? 'Playing' : 'Paused'}</Text>}
          {progressed && <Text testID="playback-progress" variant="muted">Playback advanced</Text>}
        </>}
      </View>
      <Text testID={expectedDuration !== undefined && Math.abs(duration - expectedDuration) < 0.75 ? "playback-duration-ready" : undefined} className="font-nav-medium" style={{ fontVariant: ['tabular-nums'] }}>{formatPlaybackTime(currentTime)} / {formatPlaybackTime(duration)}</Text>
      <Pressable accessibilityRole="adjustable" accessibilityLabel="Playback timeline"
        accessibilityValue={{ min: 0, max: Math.max(1, Math.round(duration)), now: Math.max(0, Math.min(Math.max(1, Math.round(duration)), Math.round(currentTime))) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={({ nativeEvent }) => {
          const target = seekTarget(duration, (currentTime + (nativeEvent.actionName === 'increment' ? 5 : -5)) / duration);
          if (target !== null) { seek(target); generatePreview(target); }
        }}
        onLayout={event => setTrackWidth(event.nativeEvent.layout.width)}
        onPress={event => { const target = seekTarget(duration, trackWidth > 0 ? event.nativeEvent.locationX / trackWidth : Number.NaN); if (target !== null) { seek(target); generatePreview(target); } }}
        disabled={!available} className="h-11 justify-center" testID="playback-timeline">
        <View pointerEvents="none" className="h-1.5 rounded-full bg-muted overflow-hidden">
          <View className="h-full bg-foreground rounded-full" style={{ width: `${duration > 0 ? Math.min(100, Math.max(0, currentTime / duration * 100)) : 0}%` }} />
        </View>
      </Pressable>
      <View className="flex-row flex-wrap gap-2">
        <Button testID="playback-toggle" variant="outline" disabled={!firstFrame || failed} onPress={toggle}><Text>{isPlaying ? 'Pause' : 'Play'}</Text></Button>
        <Button testID="playback-seek" variant="outline" disabled={!available || midpoint === null} onPress={() => { if (midpoint !== null) seek(midpoint); }}><Text>Seek halfway</Text></Button>
        <Button testID="playback-preview" variant="outline" disabled={!available || midpoint === null} onPress={() => { if (midpoint !== null) generatePreview(midpoint); }}><Text>Preview frame</Text></Button>
      </View>
      {seekComplete && <Text testID="playback-seek-complete" variant="muted">Seek completed</Text>}
      {previewState === 'loading' && <Text variant="muted">Generating preview…</Text>}
      {previewState === 'error' && <Text testID="playback-preview-error" variant="muted">Preview unavailable for this source</Text>}
      {preview && <PreviewImage key={preview.request} frame={preview.frame} id="playback-preview-ready"
        label={`Preview at ${formatPlaybackTime(preview.time)}`}
        onDisplayed={() => {
          if (requestVersion.current !== preview.request) return;
          const elapsed = Math.round(performance.now() - preview.started);
          setPreviewTimes(times => ({ ...times, [preview.cached ? 'cached' : 'cold']: elapsed }));
        }} />}
      {(previewTimes.cold !== undefined || previewTimes.cached !== undefined) && <View className="flex-row flex-wrap gap-2">
        {previewTimes.cold !== undefined && <Text testID="playback-preview-cold" variant="muted">Uncached preview {previewTimes.cold} ms</Text>}
        {previewTimes.cached !== undefined && <Text testID="playback-preview-cached" variant="muted">Cached preview {previewTimes.cached} ms</Text>}
      </View>}
      {chapters.length > 0 && <View className="gap-2">
        <Text role="heading" className="text-lg font-nav-semibold">Chapters</Text>
        {chapters.slice(0, 8).map((chapter, index) => (
          <View className="flex-row items-center gap-3" key={`${index}-${chapter.time}`}>
            {chapterImages[index] ? <PreviewImage frame={chapterImages[index]} id={`playback-chapter-image-${index}`} label={chapter.title} compact /> :
              <View className="bg-muted rounded-lg items-center justify-center" style={{ width: 100, aspectRatio: 16 / 9 }}>
                <Text className="text-xs" variant="muted">{chapterFailures[index] ? 'Unavailable' : 'Loading…'}</Text>
              </View>}
            <Button variant="ghost" testID={`playback-chapter-${index}`} disabled={!available} onPress={() => seek(chapter.time)}>
              <Text>{chapter.title} · {formatPlaybackTime(chapter.time)}</Text>
            </Button>
          </View>
        ))}
      </View>}
    </View>
  );
}

function PreviewImage({ frame, id, label, compact = false, onDisplayed }: {
  frame: PlaybackImage; id: string; label: string; compact?: boolean; onDisplayed?: () => void;
}) {
  const [displayed, setDisplayed] = useState(false);
  return <View testID={displayed ? id : undefined} accessible accessibilityLabel={label}>
    <Image source={frame} onDisplay={() => {
      if (displayed) return;
      setDisplayed(true);
      onDisplayed?.();
    }} contentFit="contain"
      style={{ width: compact ? 100 : 160, aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: '#000' }} />
  </View>;
}
