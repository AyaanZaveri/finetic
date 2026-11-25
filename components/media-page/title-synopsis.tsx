"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import styles from "./title-detail.module.css";

export function TitleSynopsis({ text }: { text: string }) {
    const id = useId();
    const paragraph = useRef<HTMLParagraphElement>(null);
    const [expanded, setExpanded] = useState(false);
    const [instant, setInstant] = useState(true);
    const [clamped, setClamped] = useState(true);
    const [size, setSize] = useState<{ collapsed: number; full: number } | null>(null);
    const reduced = useReducedMotion();

    useLayoutEffect(() => {
        const element = paragraph.current;
        if (!element) return;
        // Like the episode description, measure the full paragraph so the
        // disclosure spring can reverse without reflowing the text itself.
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

    return <div className={styles.synopsis}>
        <motion.div
            id={id}
            className={styles.synopsisPanel}
            data-measuring={!size || undefined}
            data-clamped={clamped || undefined}
            initial={false}
            animate={{ height: size ? expanded ? size.full : size.collapsed : "auto" }}
            transition={reduced || instant ? { duration: 0 } : motionTokens.spring.smooth}
            onAnimationComplete={() => { if (!expanded) setClamped(true); }}
        >
            <p ref={paragraph} className={`${styles.synopsisText} max-w-prose whitespace-pre-line break-words text-base leading-relaxed`}>
                {text}
            </p>
        </motion.div>
        {size && size.full > size.collapsed + 1 && <button
            type="button" aria-expanded={expanded} aria-controls={id}
            className={`${styles.synopsisButton} gap-1 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
            onClick={event => {
                setInstant(event.detail === 0);
                setClamped(false);
                setExpanded(value => !value);
            }}
        >
            {expanded ? "Read less" : "Read more"}
            <motion.span className="inline-flex" initial={false} animate={{ rotate: expanded ? 180 : 0 }}
                transition={reduced || instant ? { duration: 0 } : motionTokens.spring.snappy}>
                <ChevronDown aria-hidden="true" className="size-3.5" />
            </motion.span>
        </button>}
    </div>;
}
