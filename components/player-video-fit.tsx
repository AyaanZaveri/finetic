"use client";

import { useEffect, useState, type RefObject } from "react";
import { Crop, RectangleHorizontal, Scan } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MediaPlayerTooltip } from "@/components/ui/media-player";
import { desktopBridge } from "@/lib/desktop/bridge";
import type { MpvElementHandle } from "@/lib/desktop/mpv-element";

const modes = [
    { id: "fit", label: "Fit", objectFit: "contain", Icon: Scan },
    { id: "crop", label: "Fill / crop", objectFit: "cover", Icon: Crop },
    { id: "stretch", label: "Stretch", objectFit: "fill", Icon: RectangleHorizontal },
] as const;

export function PlayerVideoFit({ mediaRef, sourceKey }: { mediaRef: RefObject<HTMLVideoElement | null>; sourceKey: string }) {
    const [index, setIndex] = useState(0);
    const bridge = desktopBridge();
    const supported = !bridge || bridge.capabilities?.videoFit;
    useEffect(() => { setIndex(0); }, [sourceKey]);
    useEffect(() => {
        const media = mediaRef.current;
        if (!media || !supported) return;
        const mode = modes[index];
        if (bridge) {
            const session = (media as unknown as MpvElementHandle).controller?.previewSession;
            if (session) bridge.send({ type: "video-fit", session, mode: mode.id });
        } else {
            media.style.objectFit = mode.objectFit;
            media.style.setProperty("--media-object-fit", mode.objectFit);
        }
    }, [index, bridge, supported, mediaRef, sourceKey]);
    if (!supported) return null;
    const { Icon, label } = modes[index];
    const next = modes[(index + 1) % modes.length];
    return <MediaPlayerTooltip tooltip={`Video framing: ${label}`} shortcut="A">
        <Button type="button" variant="ghost" size="icon" data-player-video-fit={modes[index].id}
            className="text-white hover:text-white hover:bg-white/20" aria-keyshortcuts="A"
            aria-label={`Video framing: ${label}. Switch to ${next.label}`} onClick={() => setIndex((index + 1) % modes.length)}>
            <Icon aria-hidden="true" />
            <span className="sr-only" aria-live="polite">{label}</span>
        </Button>
    </MediaPlayerTooltip>;
}
