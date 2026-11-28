import type { PlaybackFixture } from '@/lib/playback-fixtures';

// These files contain only FFmpeg-generated test patterns and a sine tone.
// Regenerate and verify with scripts/generate-playback-fixtures.py.
export const playbackFixtures: PlaybackFixture[] = [
  {
    id: 'mp4-avc',
    label: 'MP4 · H.264 / AAC',
    asset: require('./mp4-avc.mp4'),
    expectedDuration: 14,
  },
  {
    id: 'mkv-avc',
    label: 'MKV · H.264 / AAC',
    asset: require('./mkv-avc.mkv'),
    expectedDuration: 14,
  },
  {
    id: 'webm-vp9',
    label: 'WebM · VP9 / Opus',
    asset: require('./webm-vp9.webm'),
    expectedDuration: 14,
  },
  {
    id: 'mp4-hevc',
    label: 'MP4 · HEVC / AAC',
    asset: require('./mp4-hevc.mp4'),
    expectedDuration: 14,
  },
  {
    id: 'mp4-chapters',
    label: 'MP4 · H.264 / AAC · Chapters',
    asset: require('./mp4-chapters.mp4'),
    expectedDuration: 14,
    chapters: [
      { title: 'Start', time: 0 },
      { title: 'Middle', time: 4 },
      { title: 'End', time: 9 },
    ],
  },
];
