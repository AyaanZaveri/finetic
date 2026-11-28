// Synthetic media fixtures are independent of catalog/account playback.
export type PlaybackChapter = { title: string; time: number };
export type PlaybackFixture = {
  id: string;
  label: string;
  asset: number;
  chapters?: PlaybackChapter[];
  expectedDuration?: number;
};

export function formatPlaybackTime(seconds: number): string {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value / 60) % 60;
  const rest = String(value % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

export function seekTarget(duration: number, fraction: number): number | null {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(fraction)) return null;
  return Math.min(Math.max(0, duration - 0.1), duration * Math.max(0, Math.min(1, fraction)));
}

/** Explicit user-provided HTTPS sources only. No credentials, implicit add-ons or proxying. */
export function validPlaybackUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
