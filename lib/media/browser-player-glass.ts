import type { WebGpuVideo } from "./webgpu-video";

const selector = '[data-player-glass], [data-player-hdr-glass]';
const properties = ['x', 'y', 'width', 'height', 'color', 'sheen'];
const videoEvents = ['loadeddata', 'seeked', 'playing', 'pause'];
type Surface = { node: HTMLElement; canvas: HTMLCanvasElement; context: CanvasRenderingContext2D };

/** Draw the playing frame into small live sRGB canvases. No JPEG encode/decode
 * round trip, CPU pixel readback, or second video decoder is needed for glass. */
export function attachBrowserPlayerGlass(video: HTMLVideoElement) {
    let blocked = false, closed = false, hasFrame = false;
    let callback: number | undefined;
    let visible: Surface[] = [];
    const surfaces = new Map<HTMLElement, Surface>();
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
    let geometry: { scale: number; left: number; top: number; width: number; height: number; x: number; y: number; drawnWidth: number; drawnHeight: number } | undefined;
    const resized = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => refresh());
    const stop = () => {
        if (callback !== undefined) video.cancelVideoFrameCallback(callback);
        callback = undefined;
    };
    const remove = (surface: Surface) => {
        surface.canvas.remove();
        surface.node.removeAttribute('data-browser-glass');
        for (const property of properties) surface.node.style.removeProperty(`--browser-glass-${property}`);
        resized?.unobserve(surface.node);
    };
    const clear = () => { for (const surface of surfaces.values()) remove(surface); surfaces.clear(); };
    const paint = (surface: Surface) => {
        if (surface.canvas.width !== canvas.width) surface.canvas.width = canvas.width;
        if (surface.canvas.height !== canvas.height) surface.canvas.height = canvas.height;
        surface.context.drawImage(canvas, 0, 0);
        if (!surface.node.hasAttribute('data-browser-glass')) surface.node.setAttribute('data-browser-glass', '');
    };
    const sample = () => {
        if (blocked || !context || !geometry || video.readyState < 2) return;
        try {
            const { scale, left, top, width, height, x, y, drawnWidth, drawnHeight } = geometry;
            context.filter = 'none';
            context.fillStyle = '#000';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.save();
            context.beginPath();
            context.rect(left * scale, top * scale, width * scale, height * scale);
            context.clip();
            // Blur once at thumbnail resolution, before copying to the controls.
            context.filter = `blur(${12 * scale}px)`;
            const picture = (video as WebGpuVideo).webgpu?.picture() ?? video;
            if ((video as WebGpuVideo).webgpu && picture === video) return;
            // The GPU canvas already includes the selected fit and letterbox bars.
            if (picture === video) context.drawImage(picture, x * scale, y * scale, drawnWidth * scale, drawnHeight * scale);
            else context.drawImage(picture, left * scale, top * scale, width * scale, height * scale);
            context.restore();
            hasFrame = true;
            for (const surface of visible) paint(surface);
        } catch {
            blocked = true;
            clear();
            stop();
        }
    };
    const tick = () => {
        callback = undefined;
        if (closed || blocked || document.hidden || !visible.length) return;
        sample();
        if (!blocked) callback = video.requestVideoFrameCallback(tick);
    };
    const refresh = () => {
        if (closed || blocked || !context) return;
        visible = [];
        for (const [node, surface] of surfaces) {
            if (node.isConnected === false) { remove(surface); surfaces.delete(node); }
        }
        if (!document.hidden && video.videoWidth && video.videoHeight) {
            const width = window.innerWidth, height = window.innerHeight;
            const scale = Math.min(640 / width, 360 / height, 1);
            const nextWidth = Math.max(1, Math.round(width * scale)), nextHeight = Math.max(1, Math.round(height * scale));
            if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
                canvas.width = nextWidth; canvas.height = nextHeight; hasFrame = false;
            }
            const rect = video.getBoundingClientRect();
            const fit = getComputedStyle(video).objectFit;
            const ratio = (fit === 'cover' ? Math.max : Math.min)(rect.width / video.videoWidth, rect.height / video.videoHeight);
            const drawnWidth = fit === 'fill' ? rect.width : video.videoWidth * ratio;
            const drawnHeight = fit === 'fill' ? rect.height : video.videoHeight * ratio;
            geometry = { scale, left: rect.left, top: rect.top, width: rect.width, height: rect.height,
                x: rect.left + (rect.width - drawnWidth) / 2, y: rect.top + (rect.height - drawnHeight) / 2, drawnWidth, drawnHeight };
            for (const node of document.querySelectorAll<HTMLElement>(selector)) {
                if (node.getAttribute('aria-hidden') === 'true' || !node.getClientRects().length) continue;
                const style = getComputedStyle(node);
                if (style.visibility === 'hidden') continue;
                let surface = surfaces.get(node);
                if (!surface) {
                    const layer = document.createElement('canvas');
                    const output = layer.getContext('2d', { alpha: false, colorSpace: 'srgb' });
                    if (!output) continue;
                    layer.setAttribute('data-browser-glass-frame', '');
                    layer.setAttribute('aria-hidden', 'true');
                    node.style.setProperty('--browser-glass-color', style.backgroundColor);
                    node.style.setProperty('--browser-glass-sheen', style.backgroundImage);
                    node.appendChild(layer);
                    surface = { node, canvas: layer, context: output };
                    surfaces.set(node, surface);
                    resized?.observe(node);
                }
                // Tooltip alignment is entirely CSS-driven, including while paused.
                if (node.getAttribute('data-slot') !== 'media-player-seek-tooltip') {
                    const bounds = node.getBoundingClientRect();
                    node.style.setProperty('--browser-glass-x', `${-bounds.left}px`);
                    node.style.setProperty('--browser-glass-y', `${-bounds.top}px`);
                }
                node.style.setProperty('--browser-glass-width', `${width}px`);
                node.style.setProperty('--browser-glass-height', `${height}px`);
                visible.push(surface);
            }
        }
        if (!visible.length) { stop(); hasFrame = false; return; }
        if (!hasFrame) sample();
        else for (const surface of visible) paint(surface);
        if (!blocked && callback === undefined && typeof video.requestVideoFrameCallback === 'function') {
            callback = video.requestVideoFrameCallback(tick);
        }
    };
    const observer = new MutationObserver(records => {
        if (records.some(record => record.attributeName === 'data-player-video-fit')) hasFrame = false;
        if (!records.length || records.some(record => record.type === 'attributes'
            || [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1
                && !(node instanceof Element && node.hasAttribute('data-browser-glass-frame'))))) refresh();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true,
        attributeFilter: ['data-controls-visible', 'aria-hidden', 'data-player-hdr-glass', 'data-player-video-fit'] });
    const repaint = () => { stop(); hasFrame = false; refresh(); };
    for (const event of videoEvents) video.addEventListener(event, repaint);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('resize', repaint);
    refresh();
    return () => {
        closed = true; stop(); observer.disconnect(); resized?.disconnect();
        for (const event of videoEvents) video.removeEventListener(event, repaint);
        document.removeEventListener('visibilitychange', refresh);
        window.removeEventListener('resize', repaint);
        clear();
    };
}
