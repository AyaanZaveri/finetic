import { isMediaFlowSource } from "./mediaflow-url";
import type { PlaybackPreferences } from "./playback-preferences";

export const WEB_RECOVERY_TOAST_ID = "web-stream-recovery";
export const IN_HOUSE_PROXY_ENABLED = "In-house proxy enabled";

export type PlaybackError = {
    message: string;
    suggestInHouseProxy?: boolean;
};

export function isWebGpuSourceAccessFailure(reason: string): boolean {
    return /^(?:network-failed|range-unsupported)(?:$|:)/i.test(reason)
        || /\b(?:cors|failed to fetch|load failed|networkerror|network request failed)\b/i.test(reason);
}

export function describePlaybackError({
    message, gpuReason, sourceAccessFailed, source, mediaFlowMode,
}: {
    message: string;
    gpuReason?: string;
    sourceAccessFailed?: boolean;
    source: string | null;
    mediaFlowMode: PlaybackPreferences["mediaFlowMode"];
}): PlaybackError {
    if (!gpuReason) return { message: message || "Couldn’t play this stream" };

    const suggestInHouseProxy = mediaFlowMode === "off" && Boolean(source && !isMediaFlowSource(source))
        && Boolean(sourceAccessFailed || isWebGpuSourceAccessFailure(gpuReason));
    return {
        message: "Couldn’t play this stream",
        suggestInHouseProxy,
    };
}
