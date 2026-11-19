import { readPlaybackPreferences } from "@/lib/media/playback-preferences";
import { preferredAudioTrack } from "@/lib/media/audio-language";
import type { DesktopBridge, NativeMessage, NativeState, NativeTrack } from "./bridge";
import { nativePreviewUrl, PreviewImages } from "./preview-images";

function ranges(end: number, cached?: { start: number; end: number }[]): TimeRanges {
  const values = cached === undefined ? (Number.isFinite(end) && end > 0 ? [{ start: 0, end }] : [])
    : cached.filter(range => range && Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > Math.max(0, range.start))
      .map(range => ({ start: Math.max(0, range.start), end: range.end })).sort((a, b) => a.start - b.start);
  const merged: typeof values = [];
  for (const range of values) {
    const last = merged.at(-1);
    if (last && last.end >= range.start) last.end = Math.max(last.end, range.end);
    else merged.push(range);
  }
  const length = merged.length;
  const validate = (index: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= length) throw new DOMException("Time range index is out of bounds", "IndexSizeError");
  };
  return { length, start(index) { validate(index); return merged[index].start; }, end(index) { validate(index); return merged[index].end; } };
}

const initialState = (): NativeState => ({
  position: 0, duration: 0, paused: true, volume: 1, muted: false, rate: 1,
  buffering: false, seeking: false, buffered: 0, width: 0, height: 0,
});

/** The HTML media contract used by our controls, backed by native playback. */
export class MpvController extends EventTarget {
  private state = initialState();
  private unsubscribe: (() => void) | undefined;
  private session = "";
  private source = "";
  private disposed = false;
  private loaded = false;
  private ready = false;
  private failure: { code: number; message: string } | null = null;
  private finished = false;
  private pending = new Map<"position" | "paused" | "volume" | "muted" | "rate", { value: number | boolean; until: number }>();
  private optimistic(key: "position" | "paused" | "volume" | "muted" | "rate", value: number | boolean) {
    if (key !== "position" && this.bridge.platform !== "windows") return;
    this.pending.set(key, { value, until: Date.now() + (key === "position" ? 2000 : 1000) });
    this.state = { ...this.state, [key]: value };
  }
  chapters: import("@/lib/media/chapters").ChapterMarker[] = [];
  tracks: NativeTrack[] = [];
  subtitleText = "";
  private previewId = 0;
  private previewReceived = 0;
  private previewPresented = 0;
  private previewFrames = new Map<number, string>();
  private previewAliases = new Map<number, number>();
  private previewRanges = new Map<number, number>();
  private decodedPreviews = new Map<number, HTMLImageElement>();
  private previewImages = new PreviewImages(url => {
    for (const [at, src] of this.previewFrames) if (src === url) {
      this.previewFrames.delete(at); this.previewRanges.delete(at); this.decodedPreviews.delete(at);
    }
  });
  cachedPreview(position: number) {
    let key = this.previewFrames.has(position) ? position : this.previewAliases.get(position);
    if (key === undefined || !this.previewFrames.has(key)) {
      key = undefined;
      for (const [start, end] of this.previewRanges) {
        if (start <= position && position < end && this.previewFrames.has(start)) { key = start; break; }
      }
    }
    if (key === undefined) return;
    const src = this.previewFrames.get(key);
    if (src) { this.previewFrames.delete(key); this.previewFrames.set(key, src); this.previewImages.touch(src); }
    return src;
  }
  private rememberPreview(position: number, src: string, range?: { start: number; end: number } | null) {
    if (range && range.start === position && Number.isFinite(range.end) && range.end > position) this.previewRanges.set(position, range.end);
    if (this.previewFrames.get(position) === src) { this.previewFrames.delete(position); this.previewFrames.set(position, src); return; }
    this.previewFrames.delete(position);
    this.previewFrames.set(position, src);
    while (this.previewFrames.size > 256) {
      const oldest = this.previewFrames.keys().next().value!;
      this.previewFrames.delete(oldest); this.previewRanges.delete(oldest);
    }
    // Decode proactively too: a JPEG string alone isn't a paint-ready image.
    if (typeof Image !== "undefined") {
      const image = new Image(); image.src = src;
      void image.decode?.().catch(() => {});
      this.decodedPreviews.set(position, image);
      while (this.decodedPreviews.size > 24) this.decodedPreviews.delete(this.decodedPreviews.keys().next().value!);
    }
  }
  private previewActive = false;
  private previewPending?: { id: number; position: number; promise: Promise<string | null>; resolve: (src: string | null) => void; timer: ReturnType<typeof setTimeout> };

  constructor(private bridge: DesktopBridge) {
    super();
    this.unsubscribe = bridge.subscribe((message) => this.receive(message));
  }

  get src() { return this.source; }
  get previewSession() { return this.session; }
  get currentSrc() { return this.source; }
  get currentTime() { return this.state.position; }
  set currentTime(position: number) {
    if (this.disposed || !this.session || !Number.isFinite(position) || position < 0) return;
    // Relative keys must build on the last requested seek while the native
    // decoder is still reporting the old position, on every platform.
    this.optimistic("position", position);
    this.state.seeking = true;
    this.fire("seeking", "timeupdate");
    this.bridge.send({ type: "seek", session: this.session, position });
  }
  get duration() { return this.loaded ? this.state.duration : Number.NaN; }
  get paused() { return this.state.paused; }
  get ended() { return this.finished; }
  get seeking() { return this.state.seeking; }
  get error() { return this.failure; }
  get readyState() { return this.ready && !this.state.buffering ? 4 : this.loaded ? 2 : 0; }
  get networkState() { return this.failure ? 3 : this.source ? (this.ready ? 1 : 2) : 0; }
  get buffered() { return ranges(Math.max(this.state.position, this.state.buffered), this.state.bufferedRanges); }
  get seekable() { return ranges(this.state.duration); }
  get videoWidth() { return this.state.width; }
  get videoHeight() { return this.state.height; }
  get volume() { return this.state.volume; }
  set volume(volume: number) {
    if (!Number.isFinite(volume)) return;
    this.state.volume = Math.max(0, Math.min(1, volume));
    if (this.session) this.optimistic("volume", this.state.volume);
    if (this.session) this.bridge.send({ type: "volume", session: this.session, volume: this.state.volume });
    this.fire("volumechange");
  }
  get muted() { return this.state.muted; }
  set muted(muted: boolean) {
    this.state.muted = muted;
    if (this.session) this.optimistic("muted", muted);
    if (this.session) this.bridge.send({ type: "muted", session: this.session, muted });
    this.fire("volumechange");
  }
  get playbackRate() { return this.state.rate; }
  set playbackRate(rate: number) {
    if (!Number.isFinite(rate)) return;
    this.state.rate = Math.max(0.25, Math.min(4, rate));
    if (this.session) this.optimistic("rate", this.state.rate);
    if (this.session) this.bridge.send({ type: "rate", session: this.session, rate: this.state.rate });
    this.fire("ratechange");
  }

  private audioChosen = false;

  load(url: string, headers?: Record<string, string>, startPosition = 0) {
    this.cancelPreview();
    this.previewImages.clear();
    if (this.disposed) return;
    this.pending.clear();
    if (this.session) this.bridge.send({ type: "stop", session: this.session });
    this.previewFrames.clear(); this.previewAliases.clear(); this.previewRanges.clear(); this.decodedPreviews.clear();
    this.source = url;
    this.session = crypto.randomUUID();
    this.loaded = this.ready = this.finished = false;
    this.failure = null;
    this.tracks = [];
    this.chapters = [];
    this.audioChosen = false;
    this.subtitleText = "";
    const { volume, muted, rate } = this.state;
    this.state = { ...initialState(), volume, muted, rate };
    this.fire("emptied", "loadstart");
    try {
      if (!["http:", "https:"].includes(new URL(url).protocol)) throw new Error("Choose an HTTP or HTTPS stream for native playback.");
      if (this.bridge.platform === "macos" && this.bridge.capabilities?.macHdrPeak) {
        this.bridge.send({ type: "mac-hdr-peak", nits: readPlaybackPreferences().macHdrPeakNits });
      }
      this.bridge.send({ type: "load", session: this.session, url, headers,
        ...(this.bridge.capabilities?.initialSeek || ["android", "ios"].includes(this.bridge.platform)
          ? { startPosition: Number.isFinite(startPosition) ? Math.max(0, startPosition) : 0 } : {}) });
      // iOS owns device volume. A cached HTML-media gain must not overwrite
      // the current hardware level when a title starts or the source switches.
      if (!(this.bridge.platform === "ios" && this.bridge.capabilities?.systemVolume)) {
        this.bridge.send({ type: "volume", session: this.session, volume });
        this.bridge.send({ type: "muted", session: this.session, muted });
      }
      this.bridge.send({ type: "rate", session: this.session, rate });
    } catch (error) { this.fail(error instanceof Error ? error.message : "Could not load this stream."); }
  }

  play(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("Player has been closed"));
    if (this.failure) return Promise.reject(new Error(this.failure.message));
    if (this.bridge.platform === "windows") {
      const paused = this.state.paused;
      if (paused) this.optimistic("paused", false);
      if (paused) this.fire("play");
    }
    this.bridge.send({ type: "play", session: this.session });
    return Promise.resolve();
  }
  pause() {
    if (this.disposed) return;
    if (this.bridge.platform === "windows") {
      const paused = this.state.paused;
      this.optimistic("paused", true);
      if (!paused) this.fire("pause");
    }
    this.bridge.send({ type: "pause", session: this.session });
  }
  get supportsSubtitleTiming() { return this.bridge.capabilities?.subtitleTiming === true; }
  setSubtitleDelay(seconds: number) {
    if (!this.supportsSubtitleTiming || this.disposed || !this.session) return;
    this.bridge.send({ type: "subtitle-delay", session: this.session, seconds: Number.isFinite(seconds) ? Math.round(Math.max(-30, Math.min(30, seconds)) * 10) / 10 : 0 });
  }
  selectTrack(kind: "audio" | "subtitle", id: string) {
    if (kind === "audio") this.audioChosen = true;
    if (kind === "subtitle" && id === "no") this.clearSubtitle();
    this.bridge.send({ type: "track", session: this.session, kind, id });
  }
  preview(position: number): Promise<string | null> {
    if (this.previewPending?.position === position) return this.previewPending.promise;
    const cached = this.cachedPreview(position);
    if (cached && !this.disposed) {
      if (this.previewPending) this.cancelPreview();
      return Promise.resolve(cached);
    }
    // Supersede the waiter, without cancelling useful native work between asks.
    if (this.previewPending) {
      clearTimeout(this.previewPending.timer);
      this.previewPending.resolve(null);
      this.previewPending = undefined;
    }
    if (this.disposed || !this.session || !Number.isFinite(position) || position < 0) return Promise.resolve(null);
    const id = ++this.previewId;
    this.previewActive = true;
    let resolve!: (src: string | null) => void;
    const promise = new Promise<string | null>(done => { resolve = done; });
    const timer = setTimeout(() => {
      if (this.previewPending?.id === id) { this.previewPending = undefined; resolve(null); }
    }, 6000);
    this.previewPending = { id, position, promise, resolve, timer };
    this.bridge.send({ type: "thumbnail", session: this.session, request: id, position });
    return promise;
  }
  cancelPreview() {
    if (this.previewPending) {
      clearTimeout(this.previewPending.timer);
      this.previewPending.resolve(null);
    }
    this.previewPending = undefined;
    if (this.previewActive) this.bridge.send({ type: "thumbnail", session: this.session, request: ++this.previewId, position: null });
    this.previewActive = false;
  }
  dispose() {
    this.cancelPreview();
    this.previewImages.clear();
    if (this.disposed) return;
    this.disposed = true;
    this.pending.clear();
    this.previewFrames.clear(); this.previewAliases.clear(); this.previewRanges.clear(); this.decodedPreviews.clear();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.session) this.bridge.send({ type: "stop", session: this.session });
  }
  private fire(...names: string[]) { names.forEach((name) => this.dispatchEvent(new Event(name))); }
  private clearSubtitle() {
    if (!this.subtitleText) return;
    this.subtitleText = "";
    this.fire("subtitlechange");
  }
  private fail(message: string) {
    this.pending.clear();
    this.cancelPreview();
    this.clearSubtitle();
    this.failure = { code: 4, message };
    this.fire("error");
  }
  private receive(message: NativeMessage, previewOrder?: number) {
    if (this.disposed || !("session" in message) || message.session !== this.session) return;
    switch (message.type) {
      case "chapters":
        this.chapters = Array.isArray(message.chapters) ? message.chapters.filter(chapter => Number.isFinite(chapter.time) && chapter.time >= 0) : [];
        this.fire("chapterschange");
        break;
      case "thumbnail-frame":
      case "thumbnail": {
        const order = previewOrder ?? ++this.previewReceived;
        if (nativePreviewUrl(message.src)) {
          const session = this.session;
          void this.previewImages.get(message.src!).then(src => {
            if (this.session !== session || this.disposed) return;
            if (message.type === "thumbnail" || src) this.receive({ ...message, src } as NativeMessage, order);
          });
          break;
        }
        const src = message.src && (message.src.startsWith("data:image/jpeg;base64,") || this.previewImages.has(message.src)) ? message.src : null;
        const position = message.position;
        const valid = src && position !== null && Number.isFinite(position) && position >= 0;
        if (valid) this.rememberPreview(position, src, message.range);
        const waiting = this.previewPending;
        // A late result can also answer a newer ask in the same keyframe interval.
        if (waiting && ((message.type === "thumbnail" && waiting.id === message.request)
          || (valid && this.cachedPreview(waiting.position) === src))) {
          const pending = this.previewPending;
          if (!pending) break;
          clearTimeout(pending.timer);
          this.previewPending = undefined;
          this.previewActive = false;
          if (valid) {
            this.previewAliases.delete(pending.position);
            this.previewAliases.set(pending.position, position);
            while (this.previewAliases.size > 256) this.previewAliases.delete(this.previewAliases.keys().next().value!);
          }
          pending.resolve(src);
        }
        // Local JPEG fetches can finish out of order. Cache every valid image,
        // but never replace a newer completed preview with an older delivery.
        if (valid && order >= this.previewPresented) {
          this.previewPresented = order;
          this.dispatchEvent(new CustomEvent("previewframe", { detail: { position, src, range: message.range } }));
        }
        break;
      }
      case "state": {
        const previous = this.state;
        const confirmingPlay = this.pending.get("paused")?.value === false && message.state.paused === false;
        const incoming = { ...message.state };
        for (const [key, pending] of this.pending) {
          const acknowledged = key === "position"
            ? Math.abs(incoming.position - (pending.value as number)) < 0.5
            : incoming[key] === pending.value;
          if (acknowledged || Date.now() >= pending.until) this.pending.delete(key);
          else Object.assign(incoming, { [key]: pending.value });
        }
        if (this.pending.has("position")) incoming.seeking = true;
        this.state = incoming;
        if (previous.position !== this.state.position) this.fire("timeupdate");
        if (previous.duration !== this.state.duration) this.fire("durationchange");
        if (previous.paused !== this.state.paused) this.fire(this.state.paused ? "pause" : "play");
        if (previous.volume !== this.state.volume || previous.muted !== this.state.muted) this.fire("volumechange");
        if (previous.rate !== this.state.rate) this.fire("ratechange");
        if (previous.seeking !== this.state.seeking) this.fire(this.state.seeking ? "seeking" : "seeked");
        if (previous.buffering !== this.state.buffering) {
          if (this.state.buffering) this.fire("waiting");
          // Cache/metadata updates can arrive before the replacement stream's
          // first frame. Only its session-scoped ready event can uncover video.
          else if (this.ready) this.fire("canplay");
        }
        if (previous.width !== this.state.width || previous.height !== this.state.height) this.fire("resize");
        if (previous.buffered !== this.state.buffered || previous.bufferedRanges !== this.state.bufferedRanges) this.fire("progress");
        if (this.ready && !this.state.paused && !this.state.buffering && !this.state.seeking &&
            (confirmingPlay || previous.paused || previous.buffering || previous.seeking)) this.fire("playing");
        break;
      }
      case "loaded": this.loaded = true; this.fire("durationchange", "loadedmetadata"); break;
      case "ready":
        this.ready = true;
        this.fire("loadeddata", "canplay", "canplaythrough");
        if (!this.state.paused) this.fire("playing");
        break;
      case "loading": this.clearSubtitle(); this.fire("waiting"); break;
      case "ended": this.clearSubtitle(); this.finished = true; this.fire("ended"); break;
      case "error": this.fail(message.message); break;
      case "tracks": {
        this.tracks = message.tracks;
        if (!this.audioChosen) {
          const english = preferredAudioTrack(this.tracks.filter(track => track.type === "audio"), readPlaybackPreferences().audioLanguage);
          if (english) {
            this.audioChosen = true;
            if (!english.selected) this.bridge.send({ type: "track", session: this.session, kind: "audio", id: String(english.id) });
          }
        }
        this.fire("trackschange");
        break;
      }
      case "subtitle":
        if (this.subtitleText !== message.text) {
          this.subtitleText = message.text;
          this.fire("subtitlechange");
        }
        break;
    }
  }
}
