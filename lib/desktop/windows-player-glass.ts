import type { DesktopBridge } from './bridge';

/** Shared RGBA frames are copied synchronously before the bridge acknowledges
 * their buffer. Blur once at canvas resolution, then crop that frame per control,
 * like browser-player-glass. No image decode, CSS image churn or extra rAF delay. */
export function attachWindowsPlayerGlass(bridge: DesktopBridge, session: string) {
    const selector = '[data-player-glass], [data-player-native-glass]';
    type Surface = { node: HTMLElement; canvas: HTMLCanvasElement; context: CanvasRenderingContext2D };
    const surfaces = new Map<HTMLElement, Surface>();
    let visible: Surface[] = [], requested = false, hasFrame = false;
    let alignmentFrame: number | undefined;
    const raw = document.createElement('canvas'), blurred = document.createElement('canvas');
    const input = raw.getContext('2d', { alpha: false, colorSpace: 'srgb' });
    const output = blurred.getContext('2d', { alpha: false, colorSpace: 'srgb' });
    if (!input || !output) return () => {};
    const align = (node: HTMLElement) => {
        const rect = node.getBoundingClientRect();
        node.style.setProperty('--browser-glass-x', `${-rect.left - node.clientLeft}px`);
        node.style.setProperty('--browser-glass-y', `${-rect.top - node.clientTop}px`);
    };
    const drawerSelector = '[data-player-selection-drawer]';
    const alignMovingDrawers = () => {
        alignmentFrame = undefined;
        let moving = false;
        for (const { node } of visible) if (node.matches(drawerSelector)) {
            align(node);
            moving ||= node.hasAttribute('data-swiping') || node.getAnimations().some(animation =>
                'transitionProperty' in animation && animation.transitionProperty === 'transform' && animation.playState === 'running');
        }
        if (moving) requestAlignment();
    };
    const requestAlignment = () => {
        if (alignmentFrame === undefined) alignmentFrame = requestAnimationFrame(alignMovingDrawers);
    };
    const onTransition = (event: TransitionEvent) => {
        if (event.propertyName === 'transform' && event.target instanceof HTMLElement && event.target.matches(drawerSelector)) {
            requestAlignment();
        }
    };
    const paint = ({ node, canvas, context }: Surface) => {
        if (canvas.width !== blurred.width) canvas.width = blurred.width;
        if (canvas.height !== blurred.height) canvas.height = blurred.height;
        context.drawImage(blurred, 0, 0);
        if (!node.hasAttribute('data-browser-glass')) {
            // The marker positions the canvas outside the control's layout.
            node.setAttribute('data-browser-glass', '');
            node.appendChild(canvas);
        }
    };
    const remove = ({ node, canvas }: Surface) => {
        resized?.unobserve(node); canvas.remove(); node.removeAttribute('data-browser-glass');
        for (const key of ['x','y','width','height','color','sheen']) node.style.removeProperty(`--browser-glass-${key}`);
    };
    const refresh = () => {
        for (const [node, surface] of surfaces) if (!node.isConnected) { remove(surface); surfaces.delete(node); }
        visible = [];
        if (!document.hidden) for (const node of document.querySelectorAll<HTMLElement>(selector)) {
            if (node.getAttribute('aria-hidden') === 'true' || !node.getClientRects().length) continue;
            const style = getComputedStyle(node);
            if (style.visibility === 'hidden') continue;
            let surface = surfaces.get(node);
            if (!surface) {
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
                if (!context) continue;
                canvas.setAttribute('data-browser-glass-frame', ''); canvas.setAttribute('aria-hidden', 'true');
                node.style.setProperty('--browser-glass-color', style.backgroundColor);
                node.style.setProperty('--browser-glass-sheen', style.backgroundImage);
                surface = { node, canvas, context }; surfaces.set(node, surface); resized?.observe(node);
            }
            if (node.getAttribute('data-slot') !== 'media-player-seek-tooltip') {
                align(node);
            }
            node.style.setProperty('--browser-glass-width', `${window.innerWidth}px`);
            node.style.setProperty('--browser-glass-height', `${window.innerHeight}px`);
            visible.push(surface);
            if (node.matches(drawerSelector)) requestAlignment();
            if (hasFrame) paint(surface);
        }
        const wanted = visible.length > 0;
        if (wanted !== requested) { requested = wanted; bridge.send({ type: 'glass', session, active: wanted }); }
    };
    const resized = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(refresh);
    const unsubscribe = bridge.subscribe(message => {
        if (message.type !== 'glass-pixels' || message.session !== session || !requested) return;
        const frame = message.frame;
        if (raw.width !== frame.width || raw.height !== frame.height) {
            raw.width = blurred.width = frame.width; raw.height = blurred.height = frame.height;
        }
        // putImageData consumes the read-only shared bytes synchronously. No
        // reference to them survives this listener; the host can then reuse them.
        input.putImageData(frame, 0, 0);
        output.filter = 'none'; output.fillStyle = '#000'; output.fillRect(0, 0, blurred.width, blurred.height);
        output.filter = `blur(${12 * frame.width / window.innerWidth}px)`;
        output.drawImage(raw, 0, 0); output.filter = 'none';
        hasFrame = true;
        for (const surface of visible) paint(surface);
    });
    const observer = new MutationObserver(records => {
        if (records.some(record => (record.type === 'attributes' && (record.attributeName !== 'style' || record.target instanceof Element && record.target.hasAttribute('data-radix-popper-content-wrapper'))) || [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && !(node instanceof Element && node.hasAttribute('data-browser-glass-frame'))))) refresh();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-controls-visible','aria-hidden','data-state','data-starting-style','data-ending-style','data-swiping','style'] });
    const insets = new MutationObserver(refresh);
    insets.observe(document.documentElement, { attributes: true, attributeFilter: ['style','class'] });
    document.addEventListener('transitionrun', onTransition);
    document.addEventListener('visibilitychange', refresh); window.addEventListener('resize', refresh); refresh();
    return () => {
        observer.disconnect(); insets.disconnect(); resized?.disconnect(); unsubscribe();
        document.removeEventListener('transitionrun', onTransition);
        if (alignmentFrame !== undefined) cancelAnimationFrame(alignmentFrame);
        document.removeEventListener('visibilitychange', refresh); window.removeEventListener('resize', refresh);
        if (requested) bridge.send({ type: 'glass', session, active: false });
        for (const surface of surfaces.values()) remove(surface);
        surfaces.clear(); visible = []; raw.width = blurred.width = 0;
    };
}
