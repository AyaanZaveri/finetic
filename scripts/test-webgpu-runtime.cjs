const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
(async () => {
  const { patchWebGpuRuntime } = await import('./webgpu-runtime-patch.mjs');
  const original = fs.readFileSync(require.resolve('@aiostreams/webgpu-player/package.json').replace('package.json', 'libraries/webgpu-player/EmbeddedPlayer.js'), 'utf8');
  const patched = patchWebGpuRuntime(original, '0.5.0');
  assert.throws(() => patchWebGpuRuntime(original + ' ', '0.5.0'), /Review/);
  assert.throws(() => patchWebGpuRuntime(original, '0.6.0'), /Review/);
  // Exercise the shipped embedding function. Stub GPU/device internals at its
  // negotiation boundary, where an unsupported audio codec rejects this file.
  const make = source => {
    const file = ts.createSourceFile('engine.js', source, ts.ScriptTarget.Latest, true);
    const exported = file.statements.find(node => ts.isExportDeclaration(node) && node.exportClause?.elements?.some(item => item.name.text === 'createEmbeddedPlayer'));
    const name = exported.exportClause.elements.find(item => item.name.text === 'createEmbeddedPlayer').propertyName.text;
    const fn = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    const observed = [];
    class Presenter { startSession() {} endSession() {} setDecodedFramePushMode() {} attach() {} destroy() {} }
    class Controller {
      playbackState = 'paused'; currentTimeMicroseconds = 0;
      setVolume() {} setMuted() {} setPlaybackRate() {} async play() { return { status: 'started' }; }
      pause() {} resume() {} async destroy() {}
    }
    class FrameLoop { schedule() {} cancel() {} synchronizePageVisibility() {} destroy() {} }
    const sourceInfo = { Container: 'mkv', MediaStreams: [
      { Type: 'Video', Index: 0, Width: 1920, Height: 1080 },
      { Type: 'Audio', Index: 1, Codec: 'eac3', Channels: 6, IsDefault: true },
    ] };
    const noOp = () => {};
    const audio = source => source.MediaStreams.filter(stream => stream.Type === 'Audio');
    const globals = { document: { addEventListener: noOp, removeEventListener: noOp }, requestAnimationFrame: () => 1, cancelAnimationFrame: noOp,
      ys: Presenter, XI: () => noOp, RC: () => true, of: () => ({ close: async () => {}, audioContext: null }), iu: 48000,
      NV: async () => sourceInfo, zV: source => audio(source).map((stream, ordinal) => ({ ordinal, isDefault: stream.IsDefault })), wC: audio,
      Ni: value => value / 1000, LV: value => value * 1000, LI: () => ({ colorMetadata: null, dolbyVisionBaseColorMetadata: null }), HI: () => true,
      S0: async () => ({}), k0: async () => ({}), qoe: async () => ({ audio: [], video: [] }), WI: async () => ({}), jI: async () => [],
      Fk(options) { observed.push(options.mediaSource); return audio(options.mediaSource).length ? { eligible: false, reason: 'audio-codec-unsupported' }
        : { eligible: true, audioTrackIndex: null, videoTrackIndex: 0, durationMicroseconds: 100000000 }; },
      sc: () => ({}), $I: noOp, aE: () => 'stereo', GI: value => value, KI: async () => true,
      Uc: Controller, Bc: FrameLoop, Yoe: () => ({}), GV: noOp, DC: (_, reason) => reason, Uoe: 'DirectPlay', Loe: /^\//,
      cr: class extends Error {}, WV: () => 'video-only', Koe: {},
    };
    const context = vm.createContext(globals);
    vm.runInContext(ts.createPrinter().printNode(ts.EmitHint.Unspecified, fn, file) + `\nthis.create = ${name};`, context);
    return { player: context.create({}, { onState: noOp, onDuration: noOp, onTime: noOp, onFallback: noOp, onError: noOp }), observed };
  };
  const request = { url: 'https://example.test/fixture.mkv', startMs: 12000, paused: true, audioOrdinal: -1, volume: 1, muted: false, rate: 1 };
  const before = make(original);
  assert.equal((await before.player.open(request)).eligible, false, 'Unmodified embedding still selects audio for -1'); before.player.destroy();
  const after = make(patched);
  const result = await after.player.open(request);
  assert.equal(result.eligible, true, 'The adapted embedding negotiates the existing no-audio engine route');
  assert.equal(result.audio.length, 0); assert.equal(after.observed[0].MediaStreams.length, 1); after.player.destroy();
  const normal = make(patched);
  assert.equal((await normal.player.open({ ...request, audioOrdinal: null })).eligible, false, 'Normal/default audio negotiation remains intact'); normal.player.destroy();
  console.log('PASS: pinned runtime adaptation, changed-source rejection, actual embedding video-only negotiation and unchanged default audio');
})().catch(error => { console.error(error); process.exitCode = 1; });
