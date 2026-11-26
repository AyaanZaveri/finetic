import { nativeWebGpuDrawCount } from "./native-webgpu-renderer";
import type { WebGpuVideo } from "./webgpu-video";
import type { MpvElementHandle } from "../desktop/mpv-element";

function bufferAheadMs(video: HTMLVideoElement) {
    const { buffered, currentTime, readyState } = video;
    if (!buffered || readyState < 1 || !Number.isFinite(currentTime)) return undefined;
    for (let index = 0; index < buffered.length; index++) {
        if (buffered.start(index) <= currentTime && buffered.end(index) >= currentTime) {
            return (buffered.end(index) - currentTime) * 1000;
        }
    }
    return 0;
}

export function readWebPlaybackStats(video: WebGpuVideo) {
    const gpu = video.webgpu;
    const stats = gpu?.stats();
    const quality = gpu ? undefined : video.getVideoPlaybackQuality?.();
    const draws = nativeWebGpuDrawCount(video);
    const path = gpu ? "WebGPU player" : draws !== undefined ? "Browser decoder + WebGPU" : "Browser player";
    return {
        path,
        route: stats?.route,
        resolution: video.videoWidth > 0 && video.videoHeight > 0 ? `${video.videoWidth} × ${video.videoHeight}` : undefined,
        presented: gpu ? stats?.framesPresented : quality && Math.max(0, quality.totalVideoFrames - quality.droppedVideoFrames),
        dropped: gpu ? stats?.framesDropped : quality?.droppedVideoFrames,
        late: stats?.framesLate,
        draws,
        hdr: gpu ? stats?.hdrOutput === undefined ? "Pending" : stats.hdrOutput ? "HDR" : "SDR"
            : draws !== undefined ? "SDR" : "Browser-managed",
        videoAheadMs: gpu ? stats?.videoAheadMs : bufferAheadMs(video),
        audioAheadMs: stats?.audioAheadMs,
        audioUnderflows: stats?.audioUnderflows,
        fallback: video.dataset.webgpuFallback,
        playing: !video.paused && !video.ended && !video.seeking,
    };
}

export type PlaybackStats = Partial<Omit<ReturnType<typeof readWebPlaybackStats>, "path" | "playing">> & {
    path: string;
    playing: boolean;
    decoderDropped?: number;
    videoCodec?: string;
    audioCodec?: string;
    videoDecoder?: string;
    audioDecoder?: string;
    engineVersion?: string;
    observedFps?: number;
};

export function readNativePlaybackStats(video: HTMLVideoElement): PlaybackStats {
    const controller = (video as unknown as MpvElementHandle).controller;
    return {
        path: "Native player",
        resolution: video.videoWidth > 0 && video.videoHeight > 0 ? `${video.videoWidth} × ${video.videoHeight}` : undefined,
        videoAheadMs: bufferAheadMs(video),
        playing: !video.paused && !video.ended && !video.seeking,
        ...controller?.playbackStats,
    };
}

export function playbackFrameRate(previous: PlaybackStats, current: PlaybackStats, elapsedMs: number,
    field: "presented" | "dropped" = "presented") {
    const start = previous[field];
    const end = current[field];
    if (!previous.playing || !current.playing || previous.path !== current.path || previous.route !== current.route
        || start === undefined || end === undefined || end < start || elapsedMs <= 0) return undefined;
    return (end - start) * 1000 / elapsedMs;
}
