"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useAtomValue } from "jotai";
import { isPlayerVisibleAtom } from "@/lib/atoms";
import { useAuroraRegistration } from "@/components/aurora-provider";
import { loadHomePalette } from "@/lib/aurora-palette-loader";
import { createHomeAuroraSelection, homeAuroraArtwork, homeAuroraBase } from "@/lib/home-aurora";

/** One controller for the whole scrollport, including streamed and deferred
 * catalog rows. The persistent Aurora renderer owns the color interpolation. */
export function HomeAuroraController() {
    const anchor = useRef<HTMLSpanElement>(null);
    const register = useAuroraRegistration();
    const pathname = usePathname();
    const { resolvedTheme } = useTheme();
    const playing = useAtomValue(isPlayerVisibleAtom);

    useEffect(() => {
        const viewport = anchor.current?.closest<HTMLElement>("[data-page-scroll]");
        if (!viewport || !register || resolvedTheme !== "dark" || playing) return;
        const header = viewport.closest("[data-app-layout]")?.querySelector<HTMLElement>("header") ?? null;
        const registration = register({ route: pathname, amplitude: 0.8, blend: 0.4, opacity: 0.3 });
        const selection = createHomeAuroraSelection(loadHomePalette, colors => registration.resolve(colors));
        const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
        let page: HTMLElement | null = null;
        let hovered: HTMLElement | null = null;
        let focused: HTMLElement | null = null;
        let frame = 0;
        let scrolling = false;

        const cardAt = (target: EventTarget | null) => {
            const card = target instanceof Element ? target.closest<HTMLElement>("[data-home-aurora-card]") : null;
            return card && viewport.contains(card) ? card : null;
        };
        function setHover(card: HTMLElement | null) {
            hovered = card;
            selection.setHover(homeAuroraArtwork(card));
        }
        function setFocus(card: HTMLElement | null) {
            focused = card;
            selection.setFocus(homeAuroraArtwork(card));
        }
        function measure(immediate = false) {
            const nextPage = viewport!.querySelector<HTMLElement>("[data-home-page]");
            if (nextPage !== page) {
                if (page) resize?.unobserve(page);
                page = nextPage;
                if (page) resize?.observe(page);
            }
            const base = page ? homeAuroraBase(page, viewport!, header) : null;
            if (scrolling) {
                scrolling = false;
                hovered = focused = null;
                selection.scroll(base);
            } else {
                // Row replacement may unmount a card without a pointerout.
                selection.setBase(base, immediate);
                setHover(hovered && page?.contains(hovered) ? hovered : null);
                setFocus(focused && page?.contains(focused) ? focused : null);
            }
        }
        function schedule() {
            if (frame) return;
            frame = window.requestAnimationFrame(() => { frame = 0; measure(); });
        }
        function onScroll() { scrolling = true; schedule(); }
        function onPointerMove(event: PointerEvent) {
            if (event.pointerType !== "mouse" || !finePointer.matches) return;
            const card = cardAt(event.target);
            if (card !== hovered) setHover(card);
        }
        function onPointerOut(event: PointerEvent) {
            if (event.pointerType !== "mouse") return;
            if (hovered && !hovered.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) {
                setHover(cardAt(event.relatedTarget));
            }
        }
        function onFocusIn(event: FocusEvent) {
            if (event.target instanceof Element && event.target.matches(":focus-visible")) setFocus(cardAt(event.target));
        }
        function onFocusOut(event: FocusEvent) {
            if (focused && !focused.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) setFocus(null);
        }
        function onPointerLeave() { setHover(null); }

        const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
        resize?.observe(viewport);
        if (header) resize?.observe(header);
        const mutations = new MutationObserver(schedule);
        mutations.observe(viewport, {
            childList: true, subtree: true, attributes: true,
            attributeFilter: ["data-aurora-primary", "data-aurora-fallback"],
        });
        viewport.addEventListener("scroll", onScroll, { capture: true, passive: true });
        viewport.addEventListener("pointermove", onPointerMove, { passive: true });
        viewport.addEventListener("pointerout", onPointerOut);
        viewport.addEventListener("pointerleave", onPointerLeave);
        viewport.addEventListener("focusin", onFocusIn);
        viewport.addEventListener("focusout", onFocusOut);
        window.addEventListener("resize", schedule, { passive: true });
        measure(true);

        return () => {
            if (frame) window.cancelAnimationFrame(frame);
            mutations.disconnect();
            resize?.disconnect();
            viewport.removeEventListener("scroll", onScroll, true);
            viewport.removeEventListener("pointermove", onPointerMove);
            viewport.removeEventListener("pointerout", onPointerOut);
            viewport.removeEventListener("pointerleave", onPointerLeave);
            viewport.removeEventListener("focusin", onFocusIn);
            viewport.removeEventListener("focusout", onFocusOut);
            window.removeEventListener("resize", schedule);
            selection.dispose();
            registration.release();
        };
    }, [register, pathname, resolvedTheme, playing]);

    return <span ref={anchor} hidden aria-hidden="true" />;
}
