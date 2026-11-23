import { KEYBOARD_SEEK_SECONDS } from "./playback-preferences";

/** Tap seeks immediately. Holding previews a continuous target and seeks once
 * on release. Decoder work never follows the display's frame rate. */
export const KEYBOARD_HOLD_MS = 300;
export const KEYBOARD_SEEK_STEP: number = KEYBOARD_SEEK_SECONDS.default;
export const KEYBOARD_SCRUB_INITIAL_RATE = 60;
export const KEYBOARD_SCRUB_MAX_RATE = 120;
export const KEYBOARD_SCRUB_RAMP_MS = 2000;
const PREVIEW_INTERVAL_MS = 100;

/** Integral of the linear speed ramp, followed by travel at the capped rate. */
function distanceAfter(milliseconds: number) {
    const seconds = Math.max(0, milliseconds) / 1000;
    const ramp = KEYBOARD_SCRUB_RAMP_MS / 1000;
    const accelerating = Math.min(seconds, ramp);
    return KEYBOARD_SCRUB_INITIAL_RATE * accelerating
        + (KEYBOARD_SCRUB_MAX_RATE - KEYBOARD_SCRUB_INITIAL_RATE) * accelerating ** 2 / (2 * ramp)
        + KEYBOARD_SCRUB_MAX_RATE * Math.max(0, seconds - ramp);
}
interface Media {
    currentTime: number;
    duration: number;
    paused: boolean;
    currentSrc?: string;
    controller?: { previewSession: string };
    seekable?: { length: number; start(index: number): number; end(index: number): number };
}
interface Options {
    media: () => Media | null;
    seek: (time: number) => void;
    pause: () => void;
    play: () => void;
    preview: (time: number | null) => void;
    reducedMotion: () => boolean;
}
const browserClock = {
    now: () => performance.now(),
    set: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clear: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    frame: (fn: () => void) => requestAnimationFrame(fn),
    cancelFrame: (id: number) => cancelAnimationFrame(id),
};
export function createKeyboardScrubber(options: Options, clock = browserClock) {
    let held: { key: string; direction: number; media: Media; source?: string; session?: string; position: number; at: number; rampStarted: number; paused: boolean; active: boolean } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined, frame: number | undefined, lastPreview = 0;
    const listeners = new Set<(position: number | null) => void>();
    const paint = (position: number | null) => listeners.forEach(listener => listener(position));
    const valid = () => held && options.media() === held.media && held.media.currentSrc === held.source && held.media.controller?.previewSession === held.session;
    function bounds(media: Media) {
        const ranges = media.seekable;
        return ranges?.length ? [ranges.start(0), ranges.end(ranges.length - 1)] : [0, media.duration];
    }
    function sample(now: number) {
        if (!held) return;
        const [start, end] = bounds(held.media);
        // Integrate velocity over elapsed foreground time, rather than counting
        // frames. Blur/visibility cancellation owns the background boundary.
        // The integral also handles frames that cross the speed cap exactly.
        now = Math.max(held.at, now);
        const distance = distanceAfter(now - held.rampStarted) - distanceAfter(held.at - held.rampStarted);
        held.position = Math.min(end, Math.max(start, held.position + held.direction * distance));
        held.at = now;
    }
    function stop(commit: boolean, resume = true) {
        if (timer !== undefined) clock.clear(timer);
        if (frame !== undefined) clock.cancelFrame(frame);
        timer = frame = undefined;
        if (!held) return;
        const current = held, usable = valid();
        if (current.active && usable && commit) sample(clock.now());
        held = null;
        if (current.active) {
            if (usable && commit) options.seek(current.position);
            options.preview(null); paint(null);
            if (usable && resume && !current.paused) options.play();
        }
    }
    function tick() {
        frame = undefined;
        if (!held?.active) return;
        if (!valid()) { stop(false, false); return; }
        const now = clock.now();
        sample(now);
        const update = now - lastPreview >= PREVIEW_INTERVAL_MS;
        if (update) { lastPreview = now; options.preview(held.position); }
        if (update || !options.reducedMotion()) paint(held.position);
        frame = clock.frame(tick);
    }
    return {
        press(key: string, repeat = false, seekSeconds = KEYBOARD_SEEK_STEP) {
            const direction = key === 'arrowright' || key === 'arrowup' ? 1 : key === 'arrowleft' || key === 'arrowdown' ? -1 : 0;
            if (!direction) return;
            if (held && !valid()) stop(false, false);
            if (held && held.key !== key && !held.active) stop(false);
            if (held) {
                if (held.key !== key) {
                    const now = clock.now();
                    if (held.active) sample(now);
                    if (held.direction !== direction) held.rampStarted = now;
                    held.key = key; held.direction = direction;
                }
                return;
            }
            // Ignore repeats arriving after blur, cancellation or a source change.
            if (repeat) return;
            const media = options.media();
            if (!media || !Number.isFinite(media.currentTime)) return;
            const [start, end] = bounds(media);
            if (!Number.isFinite(end) || end <= start) return;
            const target = Math.min(end, Math.max(start, media.currentTime + direction * seekSeconds));
            options.seek(target);
            const now = clock.now();
            held = { key, direction, media, source: media.currentSrc, session: media.controller?.previewSession, position: target, at: now, rampStarted: now, paused: media.paused, active: false };
            timer = clock.set(() => {
                timer = undefined;
                if (!valid()) { stop(false, false); return; }
                const current = held!;
                current.active = true;
                current.paused = media.paused;
                current.position = media.currentTime;
                current.at = lastPreview = clock.now();
                current.rampStarted = current.at;
                if (!current.paused) options.pause();
                options.preview(current.position); paint(current.position);
                frame = clock.frame(tick);
            }, KEYBOARD_HOLD_MS);
        },
        release(key: string) { if (held?.key === key) stop(true); },
        cancel: () => stop(false),
        dispose: () => { stop(false, false); listeners.clear(); },
        subscribe(listener: (position: number | null) => void) {
            listeners.add(listener);
            if (held?.active) listener(held.position);
            return () => { listeners.delete(listener); };
        },
    };
}
