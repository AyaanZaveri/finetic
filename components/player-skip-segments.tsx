"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { FastForward } from "lucide-react";
import { resolveSkipIMDbId } from "@/app/actions/skip-segments";
import { activeSkipSegment, fetchSkipSegments, formatSkipTime, type SkipSegment, type SkipLookup } from "@/lib/media/skip-segments";
import styles from "./player-skip-segments.module.css";

const labels = { intro: "Skip Intro", recap: "Skip Recap", credits: "Skip Credits" };

export function PlayerSkipSegments({ lookup, currentTime, mediaRef, onSeek, onSkipCredits, onSegmentsChange, enabled = true, hideCredits = false }: {
    enabled?: boolean;
    hideCredits?: boolean;
    onSegmentsChange?: (_segments: SkipSegment[]) => void;
    lookup: SkipLookup;
    currentTime: number | null;
    mediaRef: RefObject<HTMLVideoElement | null>;
    onSkipCredits?: () => void;
    onSeek: (_time: number) => void;
}) {
    const [segments, setSegments] = useState<SkipSegment[]>([]);
    const [skipped, setSkipped] = useState<SkipSegment[]>([]);
    const pendingSkip = useRef(false);
    useEffect(() => {
        onSegmentsChange?.(segments);
    }, [segments, onSegmentsChange]);
    useEffect(() => () => onSegmentsChange?.([]), [onSegmentsChange]);
    const { id, type, season, episode, duration } = lookup;
    useEffect(() => {
        const controller = new AbortController();
        void fetchSkipSegments({ id, type, season, episode, duration }, controller.signal, resolveSkipIMDbId, undefined,
            result => { if (!controller.signal.aborted) setSegments(result); })
            .then(result => { if (!controller.signal.aborted) setSegments(result); });
        return () => controller.abort();
    }, [id, type, season, episode, duration]);

    useEffect(() => {
        const media = mediaRef.current;
        if (!media) return;
        // Only a new seek initiated after ours completes can re-arm a skipped
        // segment. Delayed native position snapshots are not user rewinds.
        const seeking = () => {
            if (pendingSkip.current) return;
            const time = media.currentTime;
            setSkipped(previous => previous.filter(segment => time >= segment.end));
        };
        const seeked = () => { pendingSkip.current = false; };
        media.addEventListener("seeking", seeking);
        media.addEventListener("seeked", seeked);
        return () => {
            media.removeEventListener("seeking", seeking);
            media.removeEventListener("seeked", seeked);
        };
    }, [mediaRef]);

    const segment = currentTime === null ? undefined : activeSkipSegment(segments, currentTime, skipped, 2);
    const visibleSegment = hideCredits && segment?.kind === "credits" ? undefined : segment;
    useEffect(() => {
        console.log("[Navigator skips] Button state", {
            id, season, episode, time: currentTime === null ? null : formatSkipTime(currentTime), duration: formatSkipTime(duration),
            enabled, visible: enabled && !!visibleSegment,
            active: segment ? { kind: segment.kind, provider: segment.provider,
                start: formatSkipTime(segment.start), end: formatSkipTime(segment.end) } : null,
        });
        // Log visibility boundaries and fetched results, rather than every video frame.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, season, episode, duration, enabled, segment, segments, visibleSegment]);
    return (
        <>
            {(Object.keys(labels) as Array<SkipSegment["kind"]>).map(kind => {
                if (hideCredits && kind === "credits") return null;
                const visible = enabled && visibleSegment?.kind === kind;
                return <button
                    key={kind}
                    type="button"
                    data-player-skip=""
                    data-player-glass=""
                    data-visible={visible ? "" : undefined}
                    aria-hidden={!visible}
                    tabIndex={visible ? 0 : -1}
                    disabled={!visible}
                    className={styles.button}
                    onClick={event => {
                        event.stopPropagation();
                        if (!segment || !mediaRef.current) return;
                        if (segment.kind === "credits" && onSkipCredits) {
                            onSkipCredits();
                            return;
                        }
                        pendingSkip.current = true;
                        // Dismiss before seeking: native time updates can arrive
                        // later, or land a few frames before the requested end.
                        setSkipped(previous => [...previous, segment]);
                        try {
                            mediaRef.current.currentTime = segment.end;
                        } catch {
                            pendingSkip.current = false;
                            setSkipped(previous => previous.filter(item => item !== segment));
                            return;
                        }
                        onSeek(segment.end);
                    }} draggable={false}
                >
                    <FastForward aria-hidden="true" className="size-5 fill-current" />
                    {labels[kind]}
                </button>;
            })}
        </>
    );
}
