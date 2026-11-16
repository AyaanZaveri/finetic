import { artworkSampleUrl } from "@/lib/artwork";
import { getLogoSampleCrop } from "@/lib/logo-contrast";

export type LogoRect = { left: number; top: number; width: number; height: number };
type Rect = LogoRect;
export type LogoOverlay = { rect: Rect; background: string; opacity: number; header?: boolean; clip?: Rect };
export type LogoArtwork = { image: HTMLImageElement | HTMLCanvasElement; rect: Rect; opacity: number; objectPosition: string; objectFit?: string; clip?: Rect };
export type LogoBlurLayer = { rect: Rect; filter: string; mask: string; opacity: number };

function intersection(a: Rect, b: Rect): Rect | null {
    const left = Math.max(a.left, b.left), top = Math.max(a.top, b.top);
    const width = Math.min(a.left + a.width, b.left + b.width) - left;
    const height = Math.min(a.top + a.height, b.top + b.height) - top;
    return width > 0 && height > 0 ? { left, top, width, height } : null;
}

/** Split computed CSS gradient arguments without splitting color functions. */
export function gradientArguments(value: string): string[] {
    const result: string[] = [];
    let depth = 0, start = 0;
    for (let i = 0; i < value.length; i++) {
        if (value[i] === "(") depth++;
        else if (value[i] === ")") depth--;
        else if (value[i] === "," && depth === 0) { result.push(value.slice(start, i).trim()); start = i + 1; }
    }
    result.push(value.slice(start).trim());
    return result;
}

export function verticalGradientStops(background: string) {
    const match = /^linear-gradient\((.*)\)$/.exec(background);
    if (!match) return null;
    const args = gradientArguments(match[1]);
    const reverse = /^(to top|0deg)(?: in .+)?$/.test(args[0]);
    if (reverse) args.shift();
    else if (/^(to bottom|180deg)(?: in .+)?$/.test(args[0])) args.shift();
    else if (/^(to |[\d.-]+deg)/.test(args[0])) return null;
    const stops = args.map((arg, index) => {
        const position = /^(.*)\s+([\d.-]+)%$/.exec(arg);
        return { color: position ? position[1] : arg, position: position ? Number(position[2]) / 100 : index / (args.length - 1) };
    });
    return stops.length >= 2 ? reverse ? stops.reverse().map(stop => ({ ...stop, position: 1 - stop.position })) : stops : null;
}

/** Approximate the composed progressive blur at the logo, including its masks
 * and the header's scroll-driven opacity. Blur variances add when stacked. */
export function logoBlurRadius(layers: LogoBlurLayer[], bounds: Rect): number {
    const alpha = (color: string) => {
        if (color === "transparent") return 0;
        const numbers = color.match(/[\d.]+/g)?.map(Number) || [];
        return color.includes("/") || color.startsWith("rgba(") ? numbers.at(-1) ?? 1 : 1;
    };
    let variance = 0;
    for (const layer of layers) {
        if (!intersection(bounds, layer.rect) || layer.opacity <= 0) continue;
        const radius = Number(/blur\(([\d.]+)px\)/.exec(layer.filter)?.[1] || 0);
        const stops = verticalGradientStops(layer.mask);
        let weight = 1;
        if (stops) {
            const y = (bounds.top + bounds.height / 2 - layer.rect.top) / layer.rect.height;
            const after = stops.findIndex(stop => stop.position >= y);
            if (after <= 0) weight = alpha(stops[after < 0 ? stops.length - 1 : 0].color);
            else {
                const a = stops[after - 1], b = stops[after];
                const t = (y - a.position) / (b.position - a.position || 1);
                weight = alpha(a.color) + (alpha(b.color) - alpha(a.color)) * t;
            }
        }
        variance += radius * radius * weight * layer.opacity;
    }
    return Math.sqrt(variance);
}

function paintOverlays(context: CanvasRenderingContext2D, bounds: Rect, overlays: LogoOverlay[]) {
    for (const overlay of overlays) {
        const region = intersection(bounds, overlay.rect);
        const patch = region && (overlay.clip ? intersection(region, overlay.clip) : region);
        if (!patch || overlay.opacity <= 0) continue;
        const stops = verticalGradientStops(overlay.background);
        if (!stops) {
            if (overlay.background.startsWith("linear-gradient(")) continue;
            context.globalAlpha = overlay.opacity;
            context.fillStyle = overlay.background;
        } else {
            const gradient = context.createLinearGradient(0, overlay.rect.top, 0, overlay.rect.top + overlay.rect.height);
            try {
                for (const stop of stops) gradient.addColorStop(Math.max(0, Math.min(1, stop.position)), stop.color);
            } catch { continue; }
            context.globalAlpha = overlay.opacity;
            context.fillStyle = gradient;
        }
        context.fillRect(patch.left, patch.top, patch.width, patch.height);
    }
}

/** Rebuild the local rendered surface: page color, cropped artwork, page fade,
 * then header tint. Reading computed styles keeps this aligned with both themes. */
export function paintLogoBackdrop(
    context: CanvasRenderingContext2D, bounds: Rect, background: string,
    artwork: LogoArtwork | (LogoArtwork | LogoOverlay)[] | null,
    overlays: LogoOverlay[],
    blur?: { radius: number; canvas: HTMLCanvasElement },
) {
    const { width, height } = context.canvas;
    if (blur && blur.radius > .1) {
        // Sample surrounding pixels too: blurring only the icon's own crop
        // would miss the dark areas that soften bright details beneath it.
        const padding = Math.ceil(blur.radius * 3);
        const expanded = { left: bounds.left - padding, top: bounds.top - padding,
            width: bounds.width + padding * 2, height: bounds.height + padding * 2 };
        const filtered = typeof (context as { filter?: string }).filter === "string";
        const scale = filtered ? Math.min(width / bounds.width, 256 / expanded.width, 256 / expanded.height)
            : Math.min(width / bounds.width, 1 / blur.radius);
        blur.canvas.width = Math.max(1, Math.ceil(expanded.width * scale));
        blur.canvas.height = Math.max(1, Math.ceil(expanded.height * scale));
        const surface = blur.canvas.getContext("2d");
        if (surface) {
            paintLogoBackdrop(surface, expanded, background, artwork, overlays.filter(overlay => !overlay.header));
            context.clearRect(0, 0, width, height);
            context.save();
            if (filtered) context.filter = `blur(${blur.radius * width / bounds.width}px)`;
            else { context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high"; }
            context.drawImage(blur.canvas, -padding * width / bounds.width, -padding * height / bounds.height,
                expanded.width * width / bounds.width, expanded.height * height / bounds.height);
            context.restore();
            context.save();
            context.scale(width / bounds.width, height / bounds.height);
            context.translate(-bounds.left, -bounds.top);
            paintOverlays(context, bounds, overlays.filter(overlay => overlay.header));
            context.restore();
            return;
        }
    }
    context.clearRect(0, 0, width, height);
    context.save();
    try {
        context.scale(width / bounds.width, height / bounds.height);
        context.translate(-bounds.left, -bounds.top);
        context.globalAlpha = 1;
        context.fillStyle = background;
        context.fillRect(bounds.left, bounds.top, bounds.width, bounds.height);
        for (const layer of artwork ? Array.isArray(artwork) ? artwork : [artwork] : []) {
            if (!("image" in layer)) { paintOverlays(context, bounds, [layer]); continue; }
            const imageWidth = "naturalWidth" in layer.image ? layer.image.naturalWidth : layer.image.width;
            const imageHeight = "naturalHeight" in layer.image ? layer.image.naturalHeight : layer.image.height;
            let rect = layer.rect;
            if (layer.objectFit === "contain") {
                const scale = Math.min(rect.width / imageWidth, rect.height / imageHeight);
                const width = imageWidth * scale, height = imageHeight * scale;
                const [x = "50%", y = "50%"] = layer.objectPosition.split(/\s+/);
                const offset = (position: string, space: number) => position.endsWith("%") ? Number.parseFloat(position) / 100 * space : Number.parseFloat(position) || 0;
                rect = { left: rect.left + offset(x, rect.width - width), top: rect.top + offset(y, rect.height - height), width, height };
            }
            const region = intersection(bounds, rect);
            const patch = region && (layer.clip ? intersection(region, layer.clip) : region);
            const crop = patch && (layer.objectFit === "fill" ? {
                x: (patch.left - rect.left) / rect.width * imageWidth,
                y: (patch.top - rect.top) / rect.height * imageHeight,
                width: patch.width / rect.width * imageWidth,
                height: patch.height / rect.height * imageHeight,
            } : getLogoSampleCrop(imageWidth, imageHeight, rect, patch, layer.objectPosition));
            if (crop && patch) {
                context.globalAlpha = layer.opacity;
                context.drawImage(layer.image, crop.x, crop.y, crop.width, crop.height, patch.left, patch.top, patch.width, patch.height);
            }
        }
        paintOverlays(context, bounds, overlays);
    } finally {
        context.restore();
    }
}

/** Public image sampling bypasses the application server. */
export function logoSampleSource(source: string, _origin: string) {
    return artworkSampleUrl(source);
}
