import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { formatPlaybackTime, seekTarget, type PlaybackChapter } from '@/lib/playback-fixtures';
import { createPlaybackPreviewPipeline, type PlaybackPreview } from '@/lib/playback-preview';
import { useEvent, useEventListener } from 'expo';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView, type VideoThumbnail } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, View } from 'react-native';

type Props = { label: string; source: number | string; chapters?: PlaybackChapter[]; expectedDuration?: number };
const IMAGE_SIZE = { maxWidth: 320, maxHeight: 180 };
const NO_CHAPTERS: PlaybackChapter[] = [];

/** SDK 56 native player baseline. Keep engine-specific APIs inside this component.
 * https://docs.expo.dev/versions/v56.0.0/sdk/video/
 */
export function PlaybackLabPlayer({ label, source, chapters = NO_CHAPTERS, expectedDuration }: Props) {
  const player = useVideoPlayer(source, instance => {
    instance.timeUpdateEventInterval = 0.25;
    instance.staysActiveInBackground = false;
    instance.keepScreenOnWhilePlaying = true;
    instance.loop = expectedDuration !== undefined; // Keep local QA clips running until the test pauses.
    instance.play();
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const [currentTime, setCurrentTime] = useState(0);
  useEventListener(player, 'timeUpdate', event => { if (Number.isFinite(event.currentTime)) setCurrentTime(event.currentTime); });
  const [duration, setDuration] = useState(0);
  const [firstFrame, setFirstFrame] = useState(false);
  const [progressed, setProgressed] = useState(false);
  const [ended, setEnded] = useState(false);
  const [seekComplete, setSeekComplete] = useState(false);
  const [seekRequest, setSeekRequest] = useState(0);
  const seekPending = useRef<number | null>(null);
  const [preview, setPreview] = useState<PlaybackPreview<VideoThumbnail> | null>(null);
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [chapterImages, setChapterImages] = useState<Record<number, VideoThumbnail>>({});
  const [chapterFailures, setChapterFailures] = useState<Record<number, boolean>>({});
  const pipeline = useRef<ReturnType<typeof createPlaybackPreviewPipeline<VideoThumbnail>> | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const requestVersion = useRef(0);
  const live = useRef(false);

  useEventListener(player, 'sourceLoad', event => {
    const value = event.duration;
    if (Number.isFinite(value) && value > 0) setDuration(value);
  });
  useEventListener(player, 'playToEnd', () => { if (!player.loop) setEnded(true); });
  useEffect(() => {
    if (status === 'readyToPlay' && Number.isFinite(player.duration) && player.duration > 0) setDuration(player.duration);
  }, [status, player]);

  useEffect(() => {
    if (currentTime > 0.5) setProgressed(true);
    if (seekPending.current !== null && Math.abs(currentTime - seekPending.current) < 0.75) {
      seekPending.current = null;
      setSeekComplete(true);
    }
  }, [currentTime]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') player.pause(); });
    return () => subscription.remove();
  }, [player]);

  // Native thumbnails use AVAssetImageGenerator / MediaMetadataRetriever. Do
  // not seek the visible player just to extract a preview. Keep native image
  // references in memory and pass them directly to Expo Image.
  useEffect(() => {
    live.current = true;
    if (duration <= 0) return () => { live.current = false; };
    const owner = createPlaybackPreviewPipeline<VideoThumbnail>({
      duration,
      maxEntries: 24,
      maxBytes: 8 * 1024 * 1024,
      bytes: frame => frame.width * frame.height * 4,
      extract: async time => (await player.generateThumbnailsAsync([time], IMAGE_SIZE))[0] ?? null,
    });
    pipeline.current = owner;
    return () => {
      live.current = false;
      requestVersion.current++;
      owner.dispose();
      pipeline.current = null;
    };
  }, [duration, player]);

  useEffect(() => {
    if (!firstFrame || status === 'error' || !pipeline.current) return;
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
  }, [firstFrame, duration, chapters, status === 'error']);

  // AVPlayer can stop periodic callbacks while paused. Poll only while a
  // seek is outstanding, and validate the native clock rather than the
  // requested position. This measures transport, not frame-accurate landing.
  useEffect(() => {
    if (!seekRequest || seekPending.current === null) return;
    const timer = setInterval(() => {
      const target = seekPending.current;
      const clock = player.currentTime;
      if (target !== null && Math.abs(clock - target) < 0.75) {
        setCurrentTime(clock);
        seekPending.current = null;
        setSeekComplete(true);
      }
      if (seekPending.current === null) clearInterval(timer);
    }, 200);
    const timeout = setTimeout(() => clearInterval(timer), 5000);
    return () => { clearInterval(timer); clearTimeout(timeout); };
  }, [player, seekRequest]);

  const seek = (target: number) => {
    setEnded(false);
    seekPending.current = target;
    setSeekComplete(false);
    player.currentTime = target;
    setSeekRequest(value => value + 1);

  };
  const generatePreview = (target: number) => {
    const owner = pipeline.current;
    if (!owner) return;
    const version = ++requestVersion.current;
    setPreview(null);
    setPreviewState('loading');
    void owner.requestScrub(target).then(result => {
      if (!live.current || version !== requestVersion.current) return;
      setPreview(result);
      setPreviewState(result ? 'ready' : 'error');
    });
  };
  const midpoint = seekTarget(duration, 0.5);
  const available = firstFrame && duration > 0 && status !== 'error';
  return (
    <View className="gap-3" testID="playback-player">
      <Text role="heading" className="text-lg font-nav-semibold">{label}</Text>
      <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' }}>
        <VideoView player={player} style={{ flex: 1 }} nativeControls={false} contentFit="contain"
          surfaceType="surfaceView" onFirstFrameRender={() => setFirstFrame(true)} allowsVideoFrameAnalysis={false} />
      </View>
      <View className="flex-row flex-wrap items-center gap-2">
        {status === 'error' ? <Text testID="playback-error" accessibilityRole="alert">This source could not play</Text> : <>
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
        onPress={event => { const target = seekTarget(duration, event.nativeEvent.locationX / trackWidth); if (target !== null) { seek(target); generatePreview(target); } }}
        disabled={!available} className="h-11 justify-center" testID="playback-timeline">
        <View pointerEvents="none" className="h-1.5 rounded-full bg-muted overflow-hidden">
          <View className="h-full bg-foreground rounded-full" style={{ width: `${duration > 0 ? Math.min(100, Math.max(0, currentTime / duration * 100)) : 0}%` }} />
        </View>
      </Pressable>
      <View className="flex-row flex-wrap gap-2">
        <Button testID="playback-toggle" variant="outline" disabled={!firstFrame || status === 'error'} onPress={() => {
          if (isPlaying) player.pause();
          else if (ended) { setEnded(false); player.replay(); }
          else player.play();
        }}><Text>{isPlaying ? 'Pause' : 'Play'}</Text></Button>
        <Button testID="playback-seek" variant="outline" disabled={!available || midpoint === null} onPress={() => { if (midpoint !== null) seek(midpoint); }}><Text>Seek halfway</Text></Button>
        <Button testID="playback-preview" variant="outline" disabled={!available || midpoint === null} onPress={() => { if (midpoint !== null) generatePreview(midpoint); }}><Text>Preview frame</Text></Button>
      </View>
      {seekComplete && <Text testID="playback-seek-complete" variant="muted">Seek completed</Text>}
      {previewState === 'loading' && <Text variant="muted">Generating preview…</Text>}
      {previewState === 'error' && <Text testID="playback-preview-error" variant="muted">Preview unavailable for this source</Text>}
      {preview && <PreviewImage key={preview.time} frame={preview.frame} id="playback-preview-ready" label={`Preview at ${formatPlaybackTime(preview.time)}`} />}
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

function PreviewImage({ frame, id, label, compact = false }: { frame: VideoThumbnail; id: string; label: string; compact?: boolean }) {
  const [displayed, setDisplayed] = useState(false);
  return <View testID={displayed ? id : undefined} accessible accessibilityLabel={label}>
    <Image source={frame} onDisplay={() => setDisplayed(true)} contentFit="contain"
      style={{ width: compact ? 100 : 160, aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: '#000' }} />
  </View>;
}
