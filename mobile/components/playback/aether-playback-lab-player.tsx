import type { PlaybackChapter } from '@/lib/playback-fixtures';
import { requireNativeView } from 'expo';
import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import { AppState, type ViewProps } from 'react-native';
import { PlaybackLabControls, type PlaybackImage, type PlaybackLabSource } from './playback-lab-controls';

type Status = {
  currentTime: number;
  duration: number;
  firstFrame: boolean;
  isPlaying: boolean;
  ended: boolean;
  failed: boolean;
  subtitleCount: number;
};

type Commands = {
  setPlaying: (playing: boolean) => Promise<void>;
  seek: (time: number) => Promise<void>;
  thumbnail: (time: number) => Promise<PlaybackImage | null>;
};

type NativeProps = ViewProps & {
  source: string;
  loop: boolean;
  onStatus: (event: { nativeEvent: Status }) => void;
  onChapters: (event: { nativeEvent: { chapters: PlaybackChapter[] } }) => void;
  onSeekLanded: (event: { nativeEvent: { requestedTime: number } }) => void;
  ref: Ref<Commands>;
};

const NativePlayer = requireNativeView<NativeProps>('NavigatorAether');
const initialStatus: Status = {
  currentTime: 0, duration: 0, firstFrame: false, isPlaying: false, ended: false, failed: false, subtitleCount: 0,
};

export function AetherPlaybackLabPlayer({ source, label, expectedDuration }: PlaybackLabSource) {
  const [status, setStatus] = useState(initialStatus);
  const [chapters, setChapters] = useState<PlaybackChapter[]>([]);
  const [seekComplete, setSeekComplete] = useState(false);
  const player = useRef<Commands>(null);
  const pendingSeek = useRef<number | null>(null);

  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active') void player.current?.setPlaying(false).catch(() => {});
    });
    return () => listener.remove();
  }, []);

  const seek = (time: number) => {
    pendingSeek.current = time;
    setSeekComplete(false);
    void player.current?.seek(time).catch(() => {});
  };
  const extract = useCallback((time: number) => player.current?.thumbnail(time) ?? Promise.resolve(null), []);

  return (
    <PlaybackLabControls {...status} label={label} chapters={chapters} expectedDuration={expectedDuration}
      seekComplete={seekComplete} seek={seek} extract={extract}
      toggle={() => { void player.current?.setPlaying(!status.isPlaying).catch(() => {}); }}
      video={
        <NativePlayer ref={player} style={{ flex: 1 }} source={source} loop={expectedDuration !== undefined}
          onStatus={event => setStatus(event.nativeEvent)}
          onChapters={event => setChapters(event.nativeEvent.chapters)}
          onSeekLanded={event => {
            const { requestedTime } = event.nativeEvent;
            if (pendingSeek.current === null || !Number.isFinite(requestedTime) || Math.abs(pendingSeek.current - requestedTime) > 0.1) return;
            pendingSeek.current = null;
            setSeekComplete(true);
          }} />
      }
    />
  );
}
