import { useEvent, useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { PlaybackLabControls, type PlaybackLabSource } from './playback-lab-controls';

const IMAGE_SIZE = { maxWidth: 320, maxHeight: 180 };

export function PlaybackLabPlayer({ source, ...details }: PlaybackLabSource) {
  const { expectedDuration } = details;
  const player = useVideoPlayer(source, instance => {
    instance.timeUpdateEventInterval = 0.25;
    instance.staysActiveInBackground = false;
    instance.keepScreenOnWhilePlaying = true;
    instance.loop = expectedDuration !== undefined; // Keep local QA clips running until the test pauses.
    instance.play();
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { availableSubtitleTracks } = useEvent(player, 'availableSubtitleTracksChange', {
    availableSubtitleTracks: player.availableSubtitleTracks,
  });
  const [currentTime, setCurrentTime] = useState(0);
  useEventListener(player, 'timeUpdate', event => { if (Number.isFinite(event.currentTime)) setCurrentTime(event.currentTime); });
  const [duration, setDuration] = useState(0);
  const [firstFrame, setFirstFrame] = useState(false);
  const [ended, setEnded] = useState(false);
  const [seekComplete, setSeekComplete] = useState(false);
  const [seekRequest, setSeekRequest] = useState(0);
  const seekPending = useRef<number | null>(null);
  useEventListener(player, 'sourceLoad', event => {
    const value = event.duration;
    if (Number.isFinite(value) && value > 0) setDuration(value);
  });
  useEventListener(player, 'playToEnd', () => { if (!player.loop) setEnded(true); });
  useEffect(() => {
    if (status === 'readyToPlay' && Number.isFinite(player.duration) && player.duration > 0) setDuration(player.duration);
  }, [status, player]);

  useEffect(() => {
    if (seekPending.current !== null && Math.abs(currentTime - seekPending.current) < 0.75) {
      seekPending.current = null;
      setSeekComplete(true);
    }
  }, [currentTime]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') player.pause(); });
    return () => subscription.remove();
  }, [player]);

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
  const extract = useCallback(async (time: number) =>
    (await player.generateThumbnailsAsync([time], IMAGE_SIZE))[0] ?? null, [player]);
  const toggle = () => {
    if (isPlaying) player.pause();
    else if (ended) { setEnded(false); player.replay(); }
    else player.play();
  };

  return (
    <PlaybackLabControls {...details} video={
      <VideoView player={player} style={{ flex: 1 }} nativeControls={false} contentFit="contain"
        surfaceType="surfaceView" onFirstFrameRender={() => setFirstFrame(true)} allowsVideoFrameAnalysis={false} />
    } currentTime={currentTime} duration={duration} firstFrame={firstFrame} isPlaying={isPlaying}
      ended={ended} failed={status === 'error'} subtitleCount={availableSubtitleTracks.length}
      seekComplete={seekComplete} seek={seek} toggle={toggle} extract={extract} />
  );
}
