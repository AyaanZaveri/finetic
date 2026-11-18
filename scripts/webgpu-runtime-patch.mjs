import { createHash } from 'node:crypto';

// The published embedding API cannot request a video-only route. Reserve -1 as
// an explicit audio-off ordinal, so the engine negotiates against video metadata
// only. Its existing no-audio route then skips audio decoding and output.
// HDR output also needs an HDR tone-map target. The embedding defaults to a
// 100-nit SDR target even with its float canvas enabled. Keep the target local
// to each player, including subsequent static-metadata updates and audio routes.
// Keep these adaptations version-locked and fail preparation if upstream changes.
export function patchWebGpuRuntime(source, version) {
    const expected = 'b4c4bdbd0cf2e2a0be336ebe703ba10ca507ccc78a4c7a7802d42eb075486243';
    if (version !== '0.5.0' || createHash('sha256').update(source).digest('hex') !== expected) {
        throw new Error('Review the WebGPU runtime adaptations before upgrading the runtime.');
    }
    const anchor = 'let q=zV(V),W=R.audioOrdinal??';
    if (source.split(anchor).length !== 2) throw new Error('WebGPU audio selection anchor changed.');
    let patched = source.replace(anchor, 'R.audioOrdinal===-1&&(V={...V,MediaStreams:V.MediaStreams.filter(ee=>ee.Type!=="Audio")});' + anchor);
    // Finding the last packet can scan the whole Matroska/WebM file when it
    // lacks a usable index. Open with the header duration or an unknown duration.
    const duration = 'let o=await e.computeDuration().catch(()=>null)';
    if (patched.split(duration).length !== 2) throw new Error('WebGPU duration probe anchor changed.');
    patched = patched.replace(duration, 'let o=await (n==="mkv"||n==="webm"?e.getDurationFromMetadata():e.computeDuration()).catch(()=>null)');
    const factory = 'function Gwe(r,e){';
    const configuration = 'createHDRRenderConfiguration:GV';
    const setter = 'setHDROutput:R=>E.setHDROutputEnabled(R)';
    const statistics = 'toneMapped:W.mode==="hdr-to-sdr",';
    if (patched.split(factory).length !== 2 || patched.split(configuration).length !== 3
        || patched.split(setter).length !== 2 || patched.split(statistics).length !== 2) {
        throw new Error('WebGPU HDR configuration anchors changed.');
    }
    patched = patched.replace(factory, factory + `
        let navigatorHdrPeakNits = 0;
        const navigatorHdrConfiguration = inputPeak => {
            const configuration = GV(inputPeak);
            if (navigatorHdrPeakNits > 0) configuration.settings = {
                ...configuration.settings,
                toneMapping: { ...configuration.settings.toneMapping, outputPeakNits: navigatorHdrPeakNits }
            };
            return configuration;
        };
    `).replaceAll(configuration, 'createHDRRenderConfiguration:navigatorHdrConfiguration')
        .replace(setter, `setHDROutput:(enabled,peakNits=1000)=>{
            navigatorHdrPeakNits = enabled ? (Number.isFinite(peakNits) ? Math.max(203,Math.min(10000,peakNits)) : 1000) : 0;
            return E.setHDROutputEnabled(enabled);
        }`)
        .replace(statistics, statistics + 'hdrOutput:E.executorPlan?.output?.format==="rgba16float"&&E.executorPlan?.output?.toneMapping==="extended",');
    return patched;
}
