import { createHash } from 'node:crypto';

// The published embedding API cannot request a video-only route. Reserve -1 as
// an explicit audio-off ordinal, so the engine negotiates against video metadata
// only. Its existing no-audio route then skips audio decoding and output.
// Keep this adaptation version-locked and fail preparation if upstream changes.
export function patchWebGpuRuntime(source, version) {
    const expected = 'b4c4bdbd0cf2e2a0be336ebe703ba10ca507ccc78a4c7a7802d42eb075486243';
    if (version !== '0.5.0' || createHash('sha256').update(source).digest('hex') !== expected) {
        throw new Error('Review the WebGPU video-only adaptation before upgrading the runtime.');
    }
    const anchor = 'let q=zV(V),W=R.audioOrdinal??';
    if (source.split(anchor).length !== 2) throw new Error('WebGPU audio selection anchor changed.');
    return source.replace(anchor, 'R.audioOrdinal===-1&&(V={...V,MediaStreams:V.MediaStreams.filter(ee=>ee.Type!=="Audio")});' + anchor);
}
