import { atom } from "jotai";

import { recordDesktopStage } from "@/lib/desktop/bridge";
import type { MediaItem } from "@/types/stremio";
import type { PlaybackStreamRequest } from "@/lib/media/fetch-playback-streams";
import { applyPlaybackContext, type PlaybackPageContext } from "@/lib/media/playback-context";

// AI Ask state
export const isAIAskOpenAtom = atom(false);

// Navigator enabled state (will be synced with settings)
export const isNavigatorEnabledAtom = atom(false);

// Fullscreen state
export const isFullscreenAtom = atom(false);

// Desktop/browser UI state.
export const isDesktopMacAtom = atom(false);
export const isDesktopFullscreenAtom = atom((get) => {
  const isDesktopMac = get(isDesktopMacAtom);
  const isFullscreen = get(isFullscreenAtom);
  return isDesktopMac && isFullscreen;
});

// Media Player state
export interface MediaToPlay {
  /** Ephemeral loopback byte cache; never replaces the canonical stream URL. */
  nativePreload?: { url: string; source: string; expires: number };
  /** Exact URL/audio preference already checked by next-episode preparation. */
  preparedWebStream?: { url: string; audioLanguage: string; headersKey: string; expires: number };
  details?: MediaItem;
  /** Full metadata already read on a details page; absent fields need no refetch. */
  detailsLoaded?: boolean;
  streamRequest?: PlaybackStreamRequest;
  /** Navigate behind the player only after its opaque surface has mounted. */
  detailsPath?: string;
  /** Pointer-triggered card playback can soften the web player's initial reveal. */
  animateEntrance?: boolean;
  navigatorActionId?: string;
  id: string;
  name: string;
  type: "movie" | "series" | "channel" | "tv";
  resumePositionTicks?: number;
  streamUrl?: string;
  requestHeaders?: Record<string, string>;
  mediaSourceId?: string;
  seriesId?: string;
  showName?: string;
  episodeTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  backdropUrl?: string;
  subtitleFilename?: string;
  subtitleVideoSize?: number;
}

export interface CurrentMediaWithSource {
  id: string;
  name: string;
  type: "movie" | "series" | "channel" | "tv";
  streamUrl?: string;
  requestHeaders?: Record<string, string>;
  mediaSourceId?: string;
  seriesId?: string;
  showName?: string;
  episodeTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  backdropUrl?: string;
  subtitleFilename?: string;
  subtitleVideoSize?: number;
}

export const isPlayerVisibleAtom = atom(false);
export const currentMediaAtom = atom<MediaToPlay | null>(null);
export const playbackPageContextAtom = atom<PlaybackPageContext | null>(null);
export const currentMediaWithSourceAtom = atom<CurrentMediaWithSource | null>(
  null
);
export const skipTimestampAtom = atom<number | null>(null);
export const currentTimestampAtom = atom(0);

// Derived atom for playing media
export const playMediaAtom = atom(null, (get, set, media: MediaToPlay) => {
  media = applyPlaybackContext(media, get(playbackPageContextAtom));
  recordDesktopStage("play-requested");
  set(isAIAskOpenAtom, false);
  set(currentMediaAtom, media.type === "series" ? {
    ...media,
    backdropUrl: media.details?.background || media.backdropUrl,
  } : media);
  set(isPlayerVisibleAtom, true);
});

// Derived atom for skipping to timestamp
export const skipToTimestampAtom = atom(null, (get, set, timestamp: number) => {
  set(skipTimestampAtom, timestamp);
  // Clear the timestamp after a short delay to allow the player to consume it
  setTimeout(() => set(skipTimestampAtom, null), 100);
});

// Aurora background colors with transition support
export const auroraColorsAtom = atom<string[]>([
  "#6FE3F5",
  "#2FB8D6",
  "#4EA6BF",
]);

export const previousAuroraColorsAtom = atom<string[]>([
  "#6FE3F5",
  "#2FB8D6",
  "#4EA6BF",
]);

// Derived atom for updating colors with transition
export const updateAuroraColorsAtom = atom(
  null,
  (get, set, newColors: string[]) => {
    const currentColors = get(auroraColorsAtom);
    set(previousAuroraColorsAtom, currentColors);
    set(auroraColorsAtom, newColors);
  }
);
