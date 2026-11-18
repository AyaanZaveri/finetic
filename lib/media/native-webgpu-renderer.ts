/// <reference types="@webgpu/types" />

const shader = `
@group(0) @binding(0) var imageSampler: sampler;
@group(0) @binding(1) var videoFrame: texture_external;

struct Vertex {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@vertex fn vertex(@builtin(vertex_index) index: u32) -> Vertex {
    let points = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
    let point = points[index];
    return Vertex(vec4f(point, 0, 1), vec2f(point.x + 1, 1 - point.y) * 0.5);
}

@fragment fn fragment(input: Vertex) -> @location(0) vec4f {
    return textureSampleBaseClampToEdge(videoFrame, imageSampler, input.uv);
}
`;

const renderers = new WeakMap<HTMLVideoElement, { canvas: HTMLCanvasElement; draws: number }>();

export function nativeWebGpuDrawCount(video: HTMLVideoElement): number | undefined {
    const renderer = renderers.get(video);
    return renderer?.canvas.parentElement && !renderer.canvas.hidden ? renderer.draws : undefined;
}

/** Present the browser-decoded frame. The media element stays in charge of playback. */
export function renderNativeVideoWithWebGpu(video: HTMLVideoElement): () => void {
    const gpu = navigator.gpu;
    const host = video.parentElement;
    if (!gpu || !host || typeof video.requestVideoFrameCallback !== "function") return () => {};

    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.dataset.nativeWebGpu = "";
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    const context = canvas.getContext("webgpu");
    if (!context) return () => {};
    const renderer = { canvas, draws: 0 };
    renderers.set(video, renderer);

    let device: GPUDevice | undefined;
    let callback: number | undefined;
    let stopped = false;
    let targetWidth = 0;
    let targetHeight = 0;
    const fit = () => { canvas.style.objectFit = getComputedStyle(video).objectFit; };
    const showNativeCaptions = () => {
        canvas.hidden = Array.from(video.textTracks).some(track => track.mode === "showing");
    };
    const sizing = new ResizeObserver(() => {
        targetWidth = video.clientWidth * window.devicePixelRatio;
        targetHeight = video.clientHeight * window.devicePixelRatio;
    });
    const styles = new MutationObserver(fit);
    const stop = () => {
        if (stopped) return;
        stopped = true;
        if (callback !== undefined) video.cancelVideoFrameCallback(callback);
        video.textTracks.removeEventListener("change", showNativeCaptions);
        sizing.disconnect();
        styles.disconnect();
        canvas.remove();
        renderers.delete(video);
        context.unconfigure();
        device?.destroy();
    };

    const start = async () => {
        const adapter = await gpu.requestAdapter();
        if (!adapter || stopped) return;
        const owned = await adapter.requestDevice();
        if (stopped) { owned.destroy(); return; }
        device = owned;
        void owned.lost.then(stop);
        owned.addEventListener("uncapturederror", stop, { once: true });
        const format = gpu.getPreferredCanvasFormat();
        const shaderModule = owned.createShaderModule({ code: shader });
        const pipeline = await owned.createRenderPipelineAsync({
            layout: "auto",
            vertex: { module: shaderModule, entryPoint: "vertex" },
            fragment: { module: shaderModule, entryPoint: "fragment", targets: [{ format }] },
        });
        if (stopped) return;
        const layout = pipeline.getBindGroupLayout(0);
        const sampler = owned.createSampler({ magFilter: "linear", minFilter: "linear" });
        context.configure({ device: owned, format });
        fit();
        showNativeCaptions();
        video.textTracks.addEventListener("change", showNativeCaptions);
        sizing.observe(video);
        styles.observe(video, { attributes: true, attributeFilter: ["class", "style"] });
        const draw = () => {
            if (stopped) return;
            try {
                const { videoWidth, videoHeight } = video;
                if (!canvas.hidden && videoWidth && videoHeight && targetWidth && targetHeight) {
                    const scale = Math.min(1, Math.max(targetWidth / videoWidth, targetHeight / videoHeight),
                        owned.limits.maxTextureDimension2D / Math.max(videoWidth, videoHeight));
                    const width = Math.max(1, Math.round(videoWidth * scale));
                    const height = Math.max(1, Math.round(videoHeight * scale));
                    if (canvas.width !== width) canvas.width = width;
                    if (canvas.height !== height) canvas.height = height;
                    const frame = owned.importExternalTexture({ source: video });
                    const group = owned.createBindGroup({ layout, entries: [
                        { binding: 0, resource: sampler }, { binding: 1, resource: frame },
                    ] });
                    const encoder = owned.createCommandEncoder();
                    const pass = encoder.beginRenderPass({ colorAttachments: [{
                        view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store",
                    }] });
                    pass.setPipeline(pipeline);
                    pass.setBindGroup(0, group);
                    pass.draw(3);
                    pass.end();
                    owned.queue.submit([encoder.finish()]);
                    renderer.draws++;
                    if (!canvas.parentElement) host.append(canvas);
                }
                callback = video.requestVideoFrameCallback(draw);
            } catch { stop(); }
        };
        callback = video.requestVideoFrameCallback(draw);
    };
    void start().catch(stop);
    return stop;
}
