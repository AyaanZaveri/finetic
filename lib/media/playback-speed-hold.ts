const HOLD_MS = 350;
const POINTER_SLOP_PX = 8;
const BOOST_RATE = 2;

type Input = "space" | { id: number; x: number; y: number };

export function createPlaybackSpeedHold({
    currentMedia, canBoost, onActive, onTap,
}: {
    currentMedia: () => HTMLMediaElement | null;
    canBoost: () => boolean;
    onActive: (_active: boolean) => void;
    onTap: (_media: HTMLMediaElement) => void;
}) {
    let hold: {
        input: Input; media: HTMLMediaElement; timer: ReturnType<typeof setTimeout>; elapsed: boolean;
        boost?: { rate: number; startedPaused: boolean };
    } | null = null;
    let suppressClick = false;
    const mediaEvents = ["pause", "ended", "emptied", "loadstart", "seeking", "error", "beforeplaybackenginechange"] as const;

    function finish(cancelled: boolean) {
        const previous = hold;
        if (!previous) return;
        hold = null;
        clearTimeout(previous.timer);
        for (const event of mediaEvents) previous.media.removeEventListener(event, cancel);

        if (previous.boost) {
            // The play command may still be in flight on a native engine.
            // Always queue the matching pause before restoring the rate.
            if (previous.boost.startedPaused) previous.media.pause();
            // Preserve a speed change made by another control during the hold.
            if (previous.media.playbackRate === BOOST_RATE && previous.boost.rate !== BOOST_RATE) {
                previous.media.playbackRate = previous.boost.rate;
            }
            onActive(false);
        }
        if (previous.input !== "space" && (previous.elapsed || cancelled)) suppressClick = true;
        if (!cancelled && !previous.elapsed && previous.input === "space" && currentMedia() === previous.media) onTap(previous.media);
    }

    function cancel() { finish(true); }

    function press(input: Input) {
        const media = currentMedia();
        if (hold || !media) return;
        const timer = setTimeout(() => {
            const pressed = hold;
            if (!pressed) return;
            pressed.elapsed = true;
            if (currentMedia() !== media || !canBoost() || media.ended || media.seeking || media.error || media.readyState === 0) return;
            const boost = { rate: media.playbackRate, startedPaused: media.paused };
            pressed.boost = boost;
            if (boost.rate !== BOOST_RATE) media.playbackRate = BOOST_RATE;
            if (hold !== pressed) return;
            onActive(true);
            if (boost.startedPaused) void media.play().catch(() => {
                if (hold === pressed) cancel();
            });
        }, HOLD_MS);
        hold = { input, media, timer, elapsed: false };
        for (const event of mediaEvents) media.addEventListener(event, cancel);
    }

    return {
        press,
        cancel,
        cancelSpace() { if (hold?.input === "space") cancel(); },
        releaseSpace() { if (hold?.input === "space") finish(false); },
        resetPointerClick() { suppressClick = false; },
        consumePointerClick() {
            const consumed = suppressClick;
            suppressClick = false;
            return consumed;
        },
        movePointer(id: number, x: number, y: number) {
            if (!hold || hold.input === "space" || hold.input.id !== id || hold.elapsed) return;
            if (Math.hypot(x - hold.input.x, y - hold.input.y) > POINTER_SLOP_PX) cancel();
        },
        releasePointer(id: number, cancelled: boolean) {
            if (hold && hold.input !== "space" && hold.input.id === id) finish(cancelled);
        },
    };
}
