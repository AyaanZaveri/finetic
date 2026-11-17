"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { motionTokens } from "@/components/arc/lib/motion-tokens";

export function EpisodeDescription({ text }: { text: string }) {
    const id = useId();
    const paragraph = useRef<HTMLParagraphElement>(null);
    const [expanded, setExpanded] = useState(false);
    const [instant, setInstant] = useState(true);
    const [size, setSize] = useState<{ collapsed: number; full: number } | null>(null);
    const reduced = useReducedMotion();

    useLayoutEffect(() => {
        const element = paragraph.current;
        if (!element) return;
        // Measure the unclamped paragraph so both directions keep the same text layout.
        const measure = () => {
            const full = element.scrollHeight;
            const collapsed = Math.min(full, parseFloat(getComputedStyle(element).lineHeight) * 3);
            setSize(previous => previous?.collapsed === collapsed && previous.full === full
                ? previous : { collapsed, full });
        };
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        measure();
        return () => observer.disconnect();
    }, [text]);

    return (
        <div className="min-w-0 max-w-prose">
            <motion.div
                id={id}
                initial={false}
                animate={{ height: size ? expanded ? size.full : size.collapsed : "auto" }}
                transition={reduced || instant ? { duration: 0 } : motionTokens.spring.smooth}
                className="overflow-hidden"
                style={size ? undefined : { maxHeight: "4.875rem" }}
            >
                <p ref={paragraph} className="break-words text-base leading-relaxed">
                    {text}
                </p>
            </motion.div>
            {size && size.full > size.collapsed + 1 && (
                <div className="flex py-1">
                    <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={id}
                        className="-ms-3 min-h-9 cursor-pointer rounded-sm px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        onClick={event => {
                            setInstant(event.detail === 0);
                            setExpanded(value => !value);
                        }} draggable={false}
                    >
                        {expanded ? "Show less" : "Show more"}
                    </button>
                </div>
            )}
        </div>
    );
}
