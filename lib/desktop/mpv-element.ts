import { desktopBridge } from "./bridge";
import { MpvController } from "./mpv-controller";

export const MPV_TAG = "navigator-mpv";

/** Registered on the client only; import is safe while Next renders on the server. */
export function registerMpvElement() {
  if (typeof window === "undefined" || customElements.get(MPV_TAG)) return;
  class MpvElement extends HTMLElement {
    controller?: MpvController;
    preload = "auto";
    autoplay = true;
    loop = false;
    defaultMuted = false;
    defaultPlaybackRate = 1;
    disablePictureInPicture = true;
    disableRemotePlayback = true;
    // Media Chrome watches this list even when subtitles are drawn by React.
    textTracks = Object.assign([], {
      addEventListener() {}, removeEventListener() {},
    });
    connectedCallback() {
      const bridge = desktopBridge();
      if (!bridge || this.controller) return;
      this.controller = new MpvController(bridge);
      for (const type of ["beforeplaybackenginechange", "emptied", "loadstart", "timeupdate", "durationchange", "play", "pause", "volumechange", "ratechange", "seeking", "seeked", "waiting", "resize", "progress", "loadedmetadata", "loadeddata", "canplay", "canplaythrough", "playing", "ended", "error", "trackschange", "nativecapabilitieschange", "chapterschange", "subtitlechange"]) {
        this.controller.addEventListener(type, () => this.dispatchEvent(new Event(type)));
      }
    }
    disconnectedCallback() { this.controller?.dispose(); this.controller = undefined; }
    get src() { return this.controller?.src ?? ""; }
    get currentSrc() { return this.src; }
    get currentTime() { return this.controller?.currentTime ?? 0; }
    set currentTime(value: number) { if (this.controller) this.controller.currentTime = value; }
    get duration() { return this.controller?.duration ?? Number.NaN; }
    get paused() { return this.controller?.paused ?? true; }
    get ended() { return this.controller?.ended ?? false; }
    get seeking() { return this.controller?.seeking ?? false; }
    get error() { return this.controller?.error ?? null; }
    get readyState() { return this.controller?.readyState ?? 0; }
    get networkState() { return this.controller?.networkState ?? 0; }
    get buffered() { return this.controller?.buffered; }
    get seekable() { return this.controller?.seekable; }
    get videoWidth() { return this.controller?.videoWidth ?? 0; }
    get videoHeight() { return this.controller?.videoHeight ?? 0; }
    get volume() { return this.controller?.volume ?? 1; }
    set volume(value: number) { if (this.controller) this.controller.volume = value; }
    get muted() { return this.controller?.muted ?? false; }
    set muted(value: boolean) { if (this.controller) this.controller.muted = value; }
    get playbackRate() { return this.controller?.playbackRate ?? 1; }
    set playbackRate(value: number) { if (this.controller) this.controller.playbackRate = value; }
    play() { return this.controller?.play() ?? Promise.reject(new Error("Desktop player is unavailable")); }
    pause() { this.controller?.pause(); }
  }
  customElements.define(MPV_TAG, MpvElement);
}

export type MpvElementHandle = HTMLElement & { controller?: MpvController };
