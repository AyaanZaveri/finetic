export interface TouchScrubbingOptions {
  timeline: HTMLElement;
  start: number;
  end: number;
  currentTime: () => number;
  enabled: () => boolean;
  surfaceEnabled?: () => boolean;
  preview: (_time: number, _speed: number, _mode: "bar" | "surface") => void;
  grab?: () => void;
  commit: (_time: number) => void;
  cancel: () => void;
}

// Distance from the initial touch, rather than from the bar, makes every
// vertical starting position offer the same fast/fine scrubbing range.
export function scrubSpeed(startY: number, y: number) {
    const distance = Math.abs(y - startY);
    return distance >= 140 ? 0.1 : distance >= 70 ? 0.25 : distance >= 35 ? 0.5 : 1;
}

export function attachTouchScrubbing(root: HTMLElement, options: TouchScrubbingOptions) {
    let gesture: { id: number; x: number; y: number; lastX: number; time: number; active: boolean; onBar: boolean } | null = null;
    let suppressClick = false;
    const clamp = (time: number) => Math.max(options.start, Math.min(options.end, time));
    const down = (event: PointerEvent) => {
        if (!gesture) suppressClick = false;
        if (event.pointerType !== 'touch' || !options.enabled()) return;
        if (gesture) {
            // A second finger cancels instead of committing an accidental seek.
            const cancelled = gesture;
            gesture = null;
            if (cancelled.active) options.cancel();
            if (root.hasPointerCapture(cancelled.id)) root.releasePointerCapture(cancelled.id);
            return;
        }
        if (!event.isPrimary) return;
        const target = event.target as Element;
        const onBar = options.timeline.contains(target);
        if (!onBar && options.surfaceEnabled?.() === false) return;
        if (!onBar && target.closest('[data-player-stats], button, a, input, select, textarea, [role="button"], [role="slider"], [role="menu"], [role="dialog"], [role="combobox"], [role="listbox"], [role="option"]')) return;
        const rect = options.timeline.getBoundingClientRect();
        if (rect.width <= 0 || !Number.isFinite(options.end) || options.end <= options.start) return;
        gesture = {
            id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX,
            time: clamp(onBar ? options.start + (event.clientX - rect.left) / rect.width * (options.end - options.start) : options.currentTime()),
            active: onBar, onBar,
        };
        if (onBar) {
            event.preventDefault();
            event.stopPropagation();
            root.setPointerCapture(event.pointerId);
            suppressClick = true;
            options.grab?.();
            options.preview(gesture.time, 1, "bar");
        }
    };
    const move = (event: PointerEvent) => {
        if (!gesture || event.pointerId !== gesture.id) return;
        if (!gesture.active) {
            // Leave ordinary taps alone; horizontal movement claims the gesture.
            if (Math.abs(event.clientX - gesture.x) < 16
                || Math.abs(event.clientX - gesture.x) < Math.abs(event.clientY - gesture.y) * 1.25) return;
            gesture.active = true;
            root.setPointerCapture(event.pointerId);
            suppressClick = true;
        }
        event.preventDefault();
        event.stopPropagation();
        const speed = gesture.onBar ? 1 : scrubSpeed(gesture.y, event.clientY);
        const rect = options.timeline.getBoundingClientRect();
        if (rect.width > 0) gesture.time = clamp(gesture.onBar
            ? options.start + (event.clientX - rect.left) / rect.width * (options.end - options.start)
            : gesture.time + (event.clientX - gesture.lastX) / rect.width * (options.end - options.start) * speed);
        gesture.lastX = event.clientX;
        options.preview(gesture.time, speed, gesture.onBar ? "bar" : "surface");
    };
    const finish = (event: PointerEvent) => {
        if (!gesture || gesture.id !== event.pointerId) return;
        if (event.type === 'pointerup' && gesture.active) move(event);
        const finished = gesture;
        gesture = null;
        if (finished.active) {
            event.preventDefault();
            event.stopPropagation();
            if (event.type === 'pointerup') options.commit(finished.time);
            else options.cancel();
            if (root.hasPointerCapture(finished.id)) root.releasePointerCapture(finished.id);
        }
    };
    const click = (event: MouseEvent) => {
        if (!suppressClick) return;
        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
    };
    root.addEventListener('pointerdown', down, true);
    root.addEventListener('pointermove', move, true);
    root.addEventListener('pointerup', finish, true);
    root.addEventListener('pointercancel', finish, true);
    root.addEventListener('lostpointercapture', finish, true);
    root.addEventListener('click', click, true);
    return () => {
        root.removeEventListener('pointerdown', down, true);
        root.removeEventListener('pointermove', move, true);
        root.removeEventListener('pointerup', finish, true);
        root.removeEventListener('pointercancel', finish, true);
        root.removeEventListener('lostpointercapture', finish, true);
        root.removeEventListener('click', click, true);
        if (gesture?.active) {
            if (root.hasPointerCapture(gesture.id)) root.releasePointerCapture(gesture.id);
            options.cancel();
        }
    };
}
