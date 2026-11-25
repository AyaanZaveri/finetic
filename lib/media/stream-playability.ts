import { canUseWebGpu } from "./webgpu-module";
import { createWebVideoSession } from "./web-video-preload";
import { acquirePlaybackProbe } from "./playback-probe-lock";
import type { WebGpuVideo } from "./webgpu-video";
import type { StremioStream } from "@/types/stremio";
import { installAudioLanguagePreference, preferredAudioTrack } from "@/lib/media/audio-language";
import { metadataAudioSupport } from "@/lib/media/stream-codecs";
import type { StreamMetadata } from "@/lib/media/stream-metadata";
import { WEB_STREAM_CHECK_TIMEOUT_MS } from "@/lib/media/playback-limits";

type ProbeVideo = HTMLVideoElement & {
  webkitVideoDecodedByteCount?: number;
  webkitAudioDecodedByteCount?: number;
  nativeEl?: HTMLVideoElement;
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

export type Playability = "supported" | "unsupported" | "unknown";

/** Positive startup + audio-track evidence; proprietary counters are optional. */
export function verifyMediaElementPlayback(
  video: ProbeVideo,
  signal: AbortSignal,
  timeoutMs = WEB_STREAM_CHECK_TIMEOUT_MS,
  metadata?: Promise<StreamMetadata | undefined>,
  trackOptions: { preferredAudioLanguage?: string; onAudioLanguage?: (_language: string) => void } = {},
  disposeSession?: () => void,
): Promise<Playability> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let captured: MediaStream | undefined;
    const observedTracks = new Set<MediaStreamTrack>();
    let audioMetadata: Playability = "unknown";
    let trackMetadata: StreamMetadata | undefined;
    let playing = false;
    const baseline = video.currentTime || 0;
    const clean = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      video.removeEventListener("error", onError);
      video.removeEventListener("timeupdate", inspect);
      video.removeEventListener("loadeddata", inspect);
      video.removeEventListener("loadedmetadata", onMetadata);
      video.removeEventListener("playing", onPlaying);
      captured?.removeEventListener("addtrack", onTracksChanged);
      for (const track of observedTracks) {
        track.removeEventListener("unmute", inspect);
        track.removeEventListener("mute", inspect);
        track.removeEventListener("ended", inspect);
      }
      for (const track of captured?.getTracks() || []) track.stop();
      if (disposeSession) disposeSession();
      else {
        try { video.pause(); } catch { /* noop */ }
        video.removeAttribute("src");
        try { video.load(); } catch { /* noop */ }
        video.remove();
      }
    };
    const finish = (result: Playability) => {
      if (settled) return;
      settled = true;
      clean();
      resolve(result);
    };
    const onAbort = () => finish("unknown");
    const onError = () => {
      const code = video.error?.code;
      // A network failure is not proof that this browser lacks codec support.
      finish(code === 3 || code === 4 ? "unsupported" : "unknown");
    };
    const watchTracks = () => {
      for (const track of captured?.getTracks() || []) {
        if (observedTracks.has(track)) continue;
        observedTracks.add(track);
        track.addEventListener("unmute", inspect);
        track.addEventListener("mute", inspect);
        track.addEventListener("ended", inspect);
      }
    };
    const onTracksChanged = () => { watchTracks(); inspect(); };
    const onPlaying = () => { playing = true; inspect(); };
    const onMetadata = () => {
      // A failed initial play promise may precede the media error event.
      // The retry loads the same element; restart the muted probe if needed.
      if (video.dataset?.browserCorsFallback !== undefined && video.paused) {
        void video.play().catch(() => {});
      }
      inspect();
    };
    function inspect() {
      if (settled || signal.aborted) return;
      const decoder = (video.nativeEl ?? video) as ProbeVideo;
      type TrackView = { enabled?: boolean; language?: string; lang?: string; label?: string };
      const tracks = (video as unknown as { audioTracks?: ArrayLike<TrackView> }).audioTracks
        || (decoder as unknown as { audioTracks?: ArrayLike<TrackView> }).audioTracks;
      const enabledTracks = tracks ? Array.from(tracks).filter(track => track.enabled) : [];
      const selectedTrack = preferredAudioTrack(enabledTracks, trackOptions.preferredAudioLanguage) || enabledTracks[0];
      const declaredLanguage = selectedTrack?.language || selectedTrack?.lang;
      const selectedLanguage = declaredLanguage && !/^(und|unknown|zxx)$/i.test(declaredLanguage) ? declaredLanguage
        : selectedTrack && preferredAudioTrack([selectedTrack], trackOptions.preferredAudioLanguage) ? trackOptions.preferredAudioLanguage || "en" : undefined;
      if (selectedLanguage) trackOptions.onAudioLanguage?.(selectedLanguage);
      if (trackMetadata) {
        audioMetadata = metadataAudioSupport(trackMetadata, mime => Boolean(decoder.canPlayType?.(mime)), selectedLanguage);
      }
      const gpu = (video as WebGpuVideo).webgpu;
      if (gpu) {
        const stats = gpu.stats();
        const audio = gpu.silent || Boolean(stats?.audio && ((stats.audioAheadMs ?? -1) >= 0
          || (playing && decoder.currentTime - baseline > .05)));
        if (stats && stats.framesPresented > 0 && audio) finish("supported");
        return;
      }
      if (!captured) {
        try {
          // Capture the element's own output, never a microphone or screen.
          // Per the capture-from-element spec, element.muted does not mute
          // captured audio. Track.muted indicates unavailable content instead.
          const capture = decoder.captureStream ?? decoder.mozCaptureStream;
          captured = capture?.call(decoder);
          captured?.addEventListener("addtrack", onTracksChanged);
          watchTracks();
        } catch { /* Unsupported/CORS-restricted capture: use other evidence. */ }
      }
      const active = (track: MediaStreamTrack) => track.readyState === "live" && !track.muted && track.enabled;
      let frames = Number((decoder as ProbeVideo).webkitVideoDecodedByteCount ?? 0) > 0;
      try { frames ||= Number(decoder.getVideoPlaybackQuality?.().totalVideoFrames ?? 0) > 0; } catch { /* unavailable */ }
      frames ||= playing && Boolean(captured?.getVideoTracks().some(active));
      frames ||= playing && decoder.readyState >= 2 && decoder.videoWidth > 0 && decoder.videoHeight > 0
        && decoder.currentTime - baseline > 0.05;
      const audio = Number(decoder.webkitAudioDecodedByteCount ?? 0) > 0
        || Boolean(captured?.getAudioTracks().some(active))
        || audioMetadata === "supported";
      if (frames && audio) finish("supported");
    }

    if (signal.aborted) { finish("unknown"); return; }
    signal.addEventListener("abort", onAbort, { once: true });
    video.addEventListener("error", onError);
    video.addEventListener("timeupdate", inspect);
    video.addEventListener("loadeddata", inspect);
    video.addEventListener("loadedmetadata", onMetadata);
    video.addEventListener("playing", onPlaying);
    // Cached metadata may describe a different default/selected track. Give
    // actual playback evidence the whole probe window to override a negative.
    timer = setTimeout(() => finish(audioMetadata === "unsupported" ? "unsupported" : "unknown"), timeoutMs);
    void metadata?.then(value => {
      if (settled || signal.aborted) return;
      // A nonempty, browser-supported audio track plus real video startup is
      // useful even where capture/counter APIs are unavailable (e.g. Safari).
      trackMetadata = value;
      inspect();
    }).catch(() => { /* Missing metadata is inconclusive, not no-audio evidence. */ });
    Promise.resolve().then(() => settled ? undefined : video.play()).then(() => {
      if (!settled) onPlaying();
    }, error => {
      // A session-level fallback can recover from these rejections. Its final
      // error event or the bounded probe deadline decides the outcome.
      if (!disposeSession || !["NotSupportedError", "AbortError"].includes(error?.name)) finish("unknown");
    });
  });
}

export async function probeStreamPlayability(
  stream: StremioStream,
  options: { signal: AbortSignal; timeoutMs?: number; preferredAudioLanguage?: string; metadata?: Promise<StreamMetadata | undefined>; onAudioLanguage?: (_language: string) => void },
): Promise<Playability> {
  const src = stream.url || stream.externalUrl;
  if (!src || options.signal.aborted || typeof document === "undefined"
    || Object.keys(stream.behaviorHints?.proxyHeaders?.request || {}).length) return "unknown";

  const gpu = canUseWebGpu(src);
  const signal = gpu ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? WEB_STREAM_CHECK_TIMEOUT_MS)]) : options.signal;
  const release = gpu ? await acquirePlaybackProbe(signal) : () => {};
  if (!release) return "unknown";
  // Always use the visible player's session, including its same-file CORS retry.
  // A layout box is required for the GPU presenter, even in a hidden probe.
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-4px;top:-4px;width:2px;height:2px;pointer-events:none;";
  host.setAttribute("aria-hidden", "true");
  let session: ReturnType<typeof createWebVideoSession> | undefined;
  let removeLanguagePreference: (() => void) | undefined;
  const dispose = () => {
    removeLanguagePreference?.(); removeLanguagePreference = undefined;
    session?.dispose(); session = undefined;
  };
  try {
    if (signal.aborted) return "unknown";
    session = createWebVideoSession(src);
    const video = session.video;
    video.muted = true;
    video.tabIndex = -1;
    video.style.cssText = "width:2px;height:2px;";
    host.append(video); document.body.append(host);
    if (!gpu) removeLanguagePreference = installAudioLanguagePreference(video, options.preferredAudioLanguage);
    return await verifyMediaElementPlayback(video, signal, options.timeoutMs ?? WEB_STREAM_CHECK_TIMEOUT_MS, options.metadata, options, dispose);
  } finally { dispose(); host.remove(); release(); }
}
