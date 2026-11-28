/** Native preview extraction stays separate from playback transport. Expo Video
 * SDK 56 supplies generateThumbnailsAsync(time, { maxWidth, maxHeight }), whose
 * returned VideoThumbnail can be rendered directly by expo-image:
 * https://docs.expo.dev/versions/v56.0.0/sdk/video/#generatethumbnailsasynctimes-options
 * The caller creates one pipeline per loaded source, only after playback is
 * ready, and disposes it before replacing the source. No pre-decode on load.
 */
export const PLAYBACK_PREVIEW_MAX_SIZE = 224;

export type PlaybackPreview<T> = { time: number; frame: T };

type Options<T> = {
  duration: number;
  extract: (time: number) => Promise<T | null>;
  /** Estimated decoded memory, not encoded JPEG size. */
  bytes?: (frame: T) => number;
  maxEntries?: number;
  maxBytes?: number;
  maxQueuedChapters?: number;
};

type Request<T> = {
  time: number;
  promise: Promise<PlaybackPreview<T> | null>;
  resolve: (value: PlaybackPreview<T> | null) => void;
};

function makeRequest<T>(time: number): Request<T> {
  let resolve!: Request<T>['resolve'];
  const promise = new Promise<PlaybackPreview<T> | null>(finish => { resolve = finish; });
  return { time, promise, resolve };
}

function boundedInteger(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

/** Match desktop's one-second scrub buckets, without requesting the end frame.
 * Chapter requests preserve their more precise timestamps to avoid scene cuts. */
export function playbackPreviewTime(time: number, duration: number, exact = false): number | null {
  if (!Number.isFinite(time) || time < 0 || !Number.isFinite(duration) || duration <= 0) return null;
  const scale = exact ? 1000 : 1;
  const last = Math.max(0, Math.floor((duration - 0.1) * scale));
  return Math.min(Math.round(time * scale), last) / scale;
}

export function createPlaybackPreviewPipeline<T>(options: Options<T>) {
  const maxEntries = boundedInteger(options.maxEntries, 96);
  const maxBytes = boundedInteger(options.maxBytes, 16 * 1024 * 1024);
  const maxQueuedChapters = boundedInteger(options.maxQueuedChapters, 24);
  const cache = new Map<number, { preview: PlaybackPreview<T>; bytes: number }>();
  const chapters = new Map<number, Request<T>>();
  let cachedBytes = 0;
  let scrub: Request<T> | null = null;
  let activeTime: number | null = null;
  let closed = false;

  function touch(time: number) {
    const entry = cache.get(time);
    if (!entry) return null;
    cache.delete(time);
    cache.set(time, entry);
    return entry.preview;
  }

  function store(preview: PlaybackPreview<T>) {
    const estimate = options.bytes?.(preview.frame) ?? PLAYBACK_PREVIEW_MAX_SIZE ** 2 * 4;
    const bytes = Number.isFinite(estimate) ? Math.max(1, Math.ceil(estimate)) : maxBytes + 1;
    if (bytes > maxBytes || maxEntries === 0) return;
    const previous = cache.get(preview.time);
    if (previous) cachedBytes -= previous.bytes;
    cache.delete(preview.time);
    cache.set(preview.time, { preview, bytes });
    cachedBytes += bytes;
    while (cache.size > maxEntries || cachedBytes > maxBytes) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cachedBytes -= cache.get(oldest)!.bytes;
      cache.delete(oldest);
    }
  }

  function cancelScrub() {
    const previous = scrub;
    scrub = null;
    previous?.resolve(null);
  }

  /** Only one extraction may run at once. New scrub positions replace the
   * pending position rather than queueing more native decoders. Chapters wait
   * behind the latest scrub request and share work for matching timestamps. */
  async function pump() {
    if (closed || activeTime !== null) return;
    const next = scrub ?? chapters.values().next().value;
    if (!next) return;
    const time = next.time;
    activeTime = time;
    let result = touch(time);
    try {
      if (!result) {
        const frame = await options.extract(time);
        if (!closed && frame !== null) {
          result = { time, frame };
          store(result);
        }
      }
    } catch {
      // An unavailable preview is not a playback failure, and can be retried.
      result = null;
    } finally {
      activeTime = null;
      if (!closed) {
        if (scrub?.time === time) {
          const current = scrub;
          scrub = null;
          current.resolve(result);
        }
        const chapter = chapters.get(time);
        if (chapter) {
          chapters.delete(time);
          chapter.resolve(result);
        }
        void pump();
      }
    }
  }

  function requestScrub(time: number): Promise<PlaybackPreview<T> | null> {
    if (closed) return Promise.resolve(null);
    const target = playbackPreviewTime(time, options.duration);
    if (target !== null && scrub?.time === target) return scrub.promise;
    cancelScrub();
    if (target === null) return Promise.resolve(null);
    const cached = touch(target);
    if (cached) return Promise.resolve(cached);
    const request = makeRequest<T>(target);
    scrub = request;
    void pump();
    return request.promise;
  }

  function requestChapter(time: number): Promise<PlaybackPreview<T> | null> {
    if (closed) return Promise.resolve(null);
    const target = playbackPreviewTime(time, options.duration, true);
    if (target === null) return Promise.resolve(null);
    const cached = touch(target);
    if (cached) return Promise.resolve(cached);
    const current = chapters.get(target);
    if (current) return current.promise;
    // Include the in-flight chapter in this bound; no large eager chapter
    // queue can make the app retain stale request state indefinitely.
    if (chapters.size >= maxQueuedChapters) return Promise.resolve(null);
    const request = makeRequest<T>(target);
    chapters.set(target, request);
    void pump();
    return request.promise;
  }

  function dispose() {
    closed = true;
    cancelScrub();
    for (const chapter of chapters.values()) chapter.resolve(null);
    chapters.clear();
    cache.clear();
    cachedBytes = 0;
    // Native thumbnail generation is not cancellable through Expo's API.
    // The in-flight result is ignored and no new work starts after disposal.
    // Let SharedRef ownership/GC release the images, including those rendered
    // by consumers after eviction from this cache.
  }

  return {
    requestScrub,
    requestChapter,
    cancelScrub,
    dispose,
    getCached(time: number) {
      const target = playbackPreviewTime(time, options.duration);
      return closed || target === null ? null : touch(target);
    },
  };
}
