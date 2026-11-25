"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { HEADER_LOGO_SOURCES, chooseLogoTreatment, createLogoToneStabilizer, type LogoPixels, type LogoTone } from "@/lib/logo-contrast";
import { logoBlurRadius, logoSampleSource, paintLogoBackdrop, type LogoArtwork, type LogoOverlay } from "@/lib/logo-backdrop";
import { collectLogoSurfaces } from "@/lib/logo-surfaces";
import { subscribeLogoCanvas } from "@/lib/logo-canvas";
import styles from "./adaptive-header-logo.module.css";

export function AdaptiveHeaderLogo({ adaptive }: { adaptive: boolean }) {
    const ref = useRef<HTMLSpanElement>(null);
    const pathname = usePathname();
    const { resolvedTheme } = useTheme();
    // A theme change resamples the surface without discarding the current tone.
    const [sample, setSample] = useState<{ key: string; treatment: LogoTone } | null>(null);
    const tone = adaptive && sample?.key === pathname ? sample.treatment : null;

    useEffect(() => {
        const logo = ref.current;
        const scope = logo?.closest("header")?.parentElement;
        if (!adaptive || !logo || !scope) return;

        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 64;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        const blurCanvas = document.createElement("canvas");
        const header = logo.closest("header");

        let stopped = false;
        let frame = 0;
        let settleUntil = 0;
        let motionUntil = 0;
        let lastRead = -Infinity;
        const images = new Map<string, { image: HTMLImageElement; failedAt?: number }>();
        let previous: LogoTone | null = null;
        const stabilizeTone = createLogoToneStabilizer();
        const logoPixels: Partial<LogoPixels> = {};
        const paletteCanvas = document.createElement("canvas");
        paletteCanvas.width = paletteCanvas.height = canvas.width;
        const paletteContext = paletteCanvas.getContext("2d", { willReadFrequently: true });
        if (!paletteContext) return;
        const paletteImages = (Object.keys(HEADER_LOGO_SOURCES) as LogoTone[]).map(tone => {
            const image = new window.Image();
            image.onload = () => {
                if (stopped) return;
                try {
                    paletteContext.clearRect(0, 0, canvas.width, canvas.height);
                    paletteContext.drawImage(image, 0, 0, canvas.width, canvas.height);
                    logoPixels[tone] = paletteContext.getImageData(0, 0, canvas.width, canvas.height).data;
                    schedule();
                } catch { /* Retain the current tone if a palette cannot be read. */ }
            };
            image.src = HEADER_LOGO_SOURCES[tone];
            return image;
        });

        function scheduleFor(duration: number) {
            // Allow the 120ms tone confirmation and 240ms crossfade to settle.
            // Actual animated canvas frames have their own bounded wake signal.
            settleUntil = Math.max(settleUntil, performance.now() + duration);
            motionUntil = Math.max(motionUntil, performance.now() + duration);
            wake();
        }
        function schedule() { scheduleFor(360); }

        function canvasUpdated() {
            // Keep the last animated frame long enough to confirm its tone,
            // without upgrading canvas-only updates to scroll sampling speed.
            settleUntil = Math.max(settleUntil, performance.now() + 360);
            wake();
        }

        function wake() {
            if (!stopped && !document.hidden && !frame) frame = window.requestAnimationFrame(tick);
        }

        const resize = new ResizeObserver(schedule);
        resize.observe(logo);
        resize.observe(scope);

        function tick(now: number) {
            frame = 0;
            if (stopped || document.hidden) return;
            // During scrolling/settling sample up to 30Hz. Canvas crops notify
            // us at their existing 10Hz limit; static scenes need no idle loop.
            if (now - lastRead >= (now < motionUntil ? 32 : 100)) {
                lastRead = now;
                inspect();
            }
            if (!stopped && now < settleUntil) frame = window.requestAnimationFrame(tick);
        }

        function readable(source: string) {
            let entry = images.get(source);
            if (entry?.failedAt !== undefined && performance.now() - entry.failedAt > 10_000) {
                images.delete(source);
                entry = undefined;
            }
            if (!entry) {
                const image = new window.Image();
                entry = { image };
                const pending = entry;
                image.crossOrigin = "anonymous";
                image.onload = schedule;
                image.onerror = () => { pending.failedAt = performance.now(); schedule(); };
                images.set(source, entry);
                image.src = logoSampleSource(source, window.location.origin);
                // Bound this to nearby images, rather than retaining a gallery.
                if (images.size > 24) {
                    const oldest = images.keys().next().value!;
                    const old = images.get(oldest)!;
                    old.image.onload = old.image.onerror = null;
                    images.delete(oldest);
                }
            }
            return entry.failedAt === undefined && entry.image.complete && entry.image.naturalWidth ? entry.image : null;
        }

        function inspect() {
            if (!logo || !scope || !context || !header) return;
            if (!Object.keys(logoPixels).length) return;
            const bounds = logo.getBoundingClientRect();
            if (!bounds.width || !bounds.height) return;
            try {
                const blurLayers = Array.from(header.querySelectorAll<HTMLElement>("[data-progressive-blur-layer]"))
                    .map(element => {
                        const style = window.getComputedStyle(element);
                        return { rect: element.getBoundingClientRect(), filter: style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter"),
                            mask: style.maskImage || style.webkitMaskImage, opacity: Number(style.opacity) };
                    });
                const radius = logoBlurRadius(blurLayers, bounds);
                const padding = Math.ceil(radius * 3);
                const region = { left: bounds.left - padding, top: bounds.top - padding,
                    width: bounds.width + padding * 2, height: bounds.height + padding * 2 };
                const surfaces = collectLogoSurfaces(scope, header, region,
                    element => window.getComputedStyle(element), (x, y) => document.elementsFromPoint(x, y));
                const layers: (LogoArtwork | LogoOverlay)[] = [];
                for (const surface of surfaces) {
                    if (!("source" in surface)) { layers.push(surface); continue; }
                    const image = readable(surface.source);
                    if (image) layers.push({ ...surface, image });
                }
                const overlays = Array.from(header.querySelectorAll<HTMLElement>("[data-header-tint]"))
                    .map(element => {
                        const style = window.getComputedStyle(element);
                        return { rect: element.getBoundingClientRect(), background: style.backgroundImage === "none" ? style.backgroundColor : style.backgroundImage,
                            opacity: Number(style.opacity), header: true };
                    });
                paintLogoBackdrop(context, bounds,
                    window.getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
                    layers, overlays, { radius, canvas: blurCanvas });
                const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
                const nextTreatment = stabilizeTone(chooseLogoTreatment(pixels, logoPixels as LogoPixels, previous), performance.now());
                if (nextTreatment !== previous) {
                    previous = nextTreatment;
                    setSample({ key: pathname, treatment: nextTreatment });
                }
            } catch {
                // A failed/unsupported layer must not permanently stop sampling.
                // Reset the canvas too, in case a source tainted its readback.
                canvas.width = canvas.height = 64;
            }
        }

        const changes = new MutationObserver(records => {
            // Hero artwork dissolves for 600ms; sample the final pixels long
            // enough to confirm the new contrast, even for cached layers.
            scheduleFor(records.some(record => record.attributeName === "data-hero-backdrop-active") ? 840 : 360);
        });
        changes.observe(scope, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset", "data-artwork-state", "data-artwork-revealing", "data-hero-backdrop-active"] });
        const surfaceChanges = new MutationObserver(schedule);
        header?.querySelectorAll("[data-progressive-blur-layer], [data-header-tint]").forEach(layer =>
            surfaceChanges.observe(layer, { attributes: true, attributeFilter: ["style", "class"] }));
        scope.addEventListener("load", schedule, true);
        window.addEventListener("resize", schedule, { passive: true });
        window.addEventListener("scroll", schedule, { capture: true, passive: true });
        document.addEventListener("visibilitychange", schedule);
        const unsubscribeCanvas = subscribeLogoCanvas(canvasUpdated);
        schedule();

        return () => {
            stopped = true;
            unsubscribeCanvas();
            window.cancelAnimationFrame(frame);
            resize.disconnect();
            changes.disconnect();
            surfaceChanges.disconnect();
            images.forEach(({ image }) => { image.onload = image.onerror = null; });
            document.removeEventListener("visibilitychange", schedule);
            paletteImages.forEach(image => { image.onload = null; });
            scope.removeEventListener("load", schedule, true);
            window.removeEventListener("resize", schedule);
            window.removeEventListener("scroll", schedule, true);
        };
    }, [adaptive, pathname, resolvedTheme]);

    return (
        <span ref={ref} className={styles.frame} data-logo-tone={tone ?? "theme"}>
            {(Object.keys(HEADER_LOGO_SOURCES) as LogoTone[]).map(variant => <Image
                key={variant} src={HEADER_LOGO_SOURCES[variant]} alt="" width={32} height={32} draggable={false}
                className={styles.mark} data-tone={variant} data-active={tone === variant || undefined}
            />)}
        </span>
    );
}
