import { nativeWebGpuDrawCount } from "./native-webgpu-renderer";
import type { WebGpuVideo } from "./webgpu-video";

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
        videoAheadMs: stats?.videoAheadMs,
        audioAheadMs: stats?.audioAheadMs,
        audioUnderflows: stats?.audioUnderflows,
        fallback: video.dataset.webgpuFallback,
        playing: !video.paused && !video.ended && !video.seeking,
    };
}

type FrameSample = ReturnType<typeof readWebPlaybackStats>;

export function playbackFrameRate(previous: FrameSample, current: FrameSample, elapsedMs: number) {
    if (!previous.playing || !current.playing || previous.path !== current.path || previous.route !== current.route
        || previous.presented === undefined || current.presented === undefined
        || current.presented < previous.presented || elapsedMs <= 0) return undefined;
    return (current.presented - previous.presented) * 1000 / elapsedMs;
}
