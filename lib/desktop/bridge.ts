export type NativeTrack = {
  id: number;
  type: "audio" | "sub" | "video";
  title?: string;
  lang?: string;
  selected?: boolean;
  forced?: boolean;
};

export type NativeState = {
  position: number;
  duration: number;
  paused: boolean;
  volume: number;
  /** Native decoder gain, independent of system volume on iOS. */
  mediaGain?: number;
  muted: boolean;
  rate: number;
  buffering: boolean;
  seeking: boolean;
  buffered: number;
  bufferedRanges?: { start: number; end: number }[];
  width: number;
  height: number;
  droppedFrames?: number;
  decoderDroppedFrames?: number;
};

export type UpdateStatus = { type: "update-status"; version: string; available: boolean; automatic: boolean; state: "idle" | "checking" | "available" | "current" | "error"; message?: string };

export type NativeMessage =
  | UpdateStatus
  | { type: "chapters"; session: string; chapters: import("@/lib/media/chapters").ChapterMarker[] }
  // Shared frame bytes are valid only during the synchronous listener call.
  | { type: "glass-pixels"; session: string; frame: ImageData; sequence: number }
  | { type: "glass-frame"; session: string; src: string }
  | { type: "scrub"; session: string; active: boolean; position: number; duration: number; x: number; speed?: number; commit?: boolean }
  | { type: "state"; session: string; state: NativeState }
  | { type: "tracks"; session: string; tracks: NativeTrack[] }
  | { type: "subtitle"; session: string; text: string }
  | { type: "thumbnail-frame"; session: string; position: number; src: string; range?: { start: number; end: number } | null }
  | { type: "thumbnail"; session: string; request: number; src: string | null; position: number | null; range?: { start: number; end: number } | null }
  | { type: "loading" | "loaded" | "ready" | "ended"; session: string }
  | { type: "error"; session: string; message: string }
  | { type: "window-state"; maximized: boolean }
  | { type: "fullscreen"; value: boolean };

export type ClientStage = "interface-hydrated" | "play-requested" | "player-mounted" | "stream-resolving" | "stream-resolved";

export type NativeRequest =
  | { type: "update-status" | "update-check" }
  | { type: "update-automatic"; enabled: boolean }
  | { type: "client-stage"; stage: ClientStage }
  | { type: "app-ready"; dark: boolean }
  | { type: "video-fit"; session: string; mode: "fit" | "crop" | "stretch" }
  | { type: "glass"; session: string; active: boolean }
  | { type: "load"; session: string; url: string; headers?: Record<string, string>; startPosition?: number }
  | { type: "play" | "pause" | "stop"; session: string }
  | { type: "seek"; session: string; position: number }
  | { type: "thumbnail"; session: string; request: number; position: number | null }
  | { type: "volume"; session: string; volume: number }
  | { type: "muted"; session: string; muted: boolean }
  | { type: "rate"; session: string; rate: number }
  | { type: "track"; session: string; kind: "audio" | "subtitle"; id: string }
  | { type: "fullscreen"; value: boolean }
  | { type: "window-drag" }
  | { type: "window-controls-visible"; visible: boolean }
  | { type: "window-control"; action: "minimize" | "toggle-maximize" | "close" }
  | { type: "settings" }
  | { type: "seek-feedback"; session: string };

export interface DesktopBridge {
  readonly protocol: 1;
  readonly platform: "macos" | "windows" | "linux" | "android" | "ios";
  readonly engine?: "mpv" | "exoplayer" | "vlc";
  readonly capabilities?: { updates?: boolean; chapters?: boolean; initialSeek?: boolean; windowControlsVisibility?: boolean; videoFit?: boolean; timings?: boolean; glass?: boolean; glassPixels?: boolean; nativePreviews?: boolean; nativeSurfaceGestures?: boolean; nativeMaterials?: boolean; nativeSystemVolume?: boolean; pip?: boolean; airplay?: boolean; systemVolume?: boolean };
  readonly fullscreen: boolean;
  send(request: NativeRequest): void;
  subscribe(listener: (message: NativeMessage) => void): () => void;
}

declare global {
  interface Window { readonly navigatorDesktop?: DesktopBridge }
}

export function desktopBridge(): DesktopBridge | undefined {
  if (typeof window === "undefined") return undefined;
  const bridge = window.navigatorDesktop;
  return bridge?.protocol === 1 ? bridge : undefined;
}

/** Fixed, URL-free stages; older native builds receive no new commands. */
export function recordDesktopStage(stage: ClientStage) {
  const bridge = desktopBridge();
  if (!bridge || !["windows", "macos"].includes(bridge.platform) || !bridge.capabilities?.timings) return;
  try { bridge.send({ type: "client-stage", stage }); } catch { /* Diagnostics never block playback. */ }
}

/** Old macOS runtimes and other platforms retain their existing window chrome. */
export function setMacOSWindowControlsVisible(visible: boolean) {
  const bridge = desktopBridge();
  if (bridge?.platform === "macos" && bridge.capabilities?.windowControlsVisibility) {
    bridge.send({ type: "window-controls-visible", visible });
  }
}
