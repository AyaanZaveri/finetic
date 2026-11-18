"use client";

import { useRef, useState, type ComponentProps } from "react";
import { motion, useReducedMotion } from "motion/react";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import userMenuStyles from "@/components/arc/user-menu/user-menu.module.css";
import type { ContextMenuGroup } from "@/components/ui/context-menu";

export function useActionMenuHighlight() {
    const reducedMotion = useReducedMotion();
    const pointerHighlight = useRef(false);
    const [highlight, setHighlight] = useState<{ top: number; height: number; glide: boolean } | null>(null);
    const updateHighlight = (target: EventTarget | null, glide: boolean) => {
        const row = target instanceof Element ? target.closest<HTMLElement>("[data-card-menu-item]") : null;
        if (!row || row.hasAttribute("data-disabled")) { setHighlight(null); return; }
        setHighlight(current => {
            const next = { top: row.offsetTop, height: row.offsetHeight, glide: glide && current !== null };
            return current?.top === next.top && current.height === next.height && current.glide === next.glide ? current : next;
        });
    };
    const resetHighlight = () => {
        pointerHighlight.current = false;
        setHighlight(null);
    };
    const groupProps: ComponentProps<typeof ContextMenuGroup> = {
        className: "relative",
        onPointerMoveCapture: event => {
            if (event.pointerType !== "mouse" || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
            pointerHighlight.current = true;
            updateHighlight(event.target, true);
        },
        onPointerLeave: resetHighlight,
        onKeyDownCapture: () => { pointerHighlight.current = false; },
        onFocusCapture: event => { if (!pointerHighlight.current) updateHighlight(event.target, false); },
        onBlurCapture: event => {
            // Radix focuses the popup between hovered rows. Keep the previous position for the next glide.
            if (!pointerHighlight.current && (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))) setHighlight(null);
        },
    };
    const highlightElement = (
        <motion.span aria-hidden="true" className={userMenuStyles.highlight} initial={false}
            style={{ height: highlight?.height ?? 0 }}
            animate={highlight ? { transform: `translateY(${highlight.top}px)`, opacity: 1 } : { opacity: 0 }}
            transition={{
                default: highlight?.glide && !reducedMotion ? motionTokens.spring.snappy : { duration: 0 },
                opacity: { duration: reducedMotion ? 0 : motionTokens.duration.instant },
            }} />
    );
    return { groupProps, highlightElement, resetHighlight };
}
