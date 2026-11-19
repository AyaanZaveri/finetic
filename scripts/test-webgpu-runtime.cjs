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
  const inferFileSize = (source, contentEncoding) => {
    // Execute the shipped UrlSource branch for a 206 range near a large file's end.
    const start = source.indexOf('e:if(this._orchestrator.fileSize===null');
    const end = source.indexOf('if(this._fileSizeDetermined=', start);
    assert.ok(start >= 0 && end > start, 'Find the pinned range-size branch');
    const sizeBranch = source.slice(start, end);
    const response = sizeBranch.match(/(\w+)\.headers\.get\("Content-Range"\)/)?.[1];
    assert.ok(response);
    const headers = new Headers({ 'Content-Range': 'bytes 22547354247-22547358342/22547495077', 'Content-Length': '4096' });
    if (contentEncoding !== undefined) headers.set('Content-Encoding', contentEncoding);
    const orchestrator = { fileSize: null, supplyFileSize(value) { this.fileSize = value; } };
    const read = vm.runInNewContext(`(function(${response},e){${sizeBranch}})`);
    read.call({ _orchestrator: orchestrator }, { status: 206, type: 'cors', headers }, { currentPos: 22547354247 });
    return orchestrator.fileSize;
  };
  assert.equal(inferFileSize(original, 'identity'), null, 'Reproduce the missing file size that disables Matroska Cues');
  for (const file of ['EmbeddedPlayer.js', 'CustomDecode.worker.js']) {
    const served = fs.readFileSync(`public/webgpu-player/0.5.0/libraries/webgpu-player/${file}`, 'utf8');
    assert.equal(inferFileSize(served), 22547495077, `${file} preserves an ordinary unencoded range`);
    assert.equal(inferFileSize(served, 'Identity'), 22547495077, `${file} accepts explicitly unencoded ranges`);
    for (const coding of ['gzip', 'br', 'gzip, identity']) {
      assert.equal(inferFileSize(served, coding), null, `${file} rejects compressed stream offsets`);
    }
  }
  console.log('PASS: embedded and worker range readers infer the size of 206 responses with identity encoding');
  const inspectDuration = (source, format, headerDuration) => {
    const start = source.indexOf('async function NV(r)');
    const end = source.indexOf('var Uoe=', start);
    const context = vm.createContext({
      PC: [], gl: class {}, moe: { Matroska: 'mkv', WebM: 'webm', MP4: 'mp4' }, poe: 10_000_000,
      ra: class {
        async getFormat() { return { name: format }; }
        async getTracks() { return []; }
        async getDurationFromMetadata() { return headerDuration; }
        async computeDuration() { return format === 'MP4' ? 60 : new Promise(() => {}); }
        dispose() {}
      },
    });
    return vm.runInContext(source.slice(start, end) + '\nNV("https://example.test/video")', context);
  };
  const pendingScan = Symbol('pending scan');
  const inspectWithoutWaiting = (...args) => Promise.race([
    inspectDuration(...args),
    new Promise(resolve => setImmediate(resolve, pendingScan)),
  ]);
  assert.equal(await inspectWithoutWaiting(original, 'Matroska', 42), pendingScan);
  for (const format of ['Matroska', 'WebM']) {
    const result = await inspectWithoutWaiting(patched, format, 42);
    assert.notEqual(result, pendingScan, `${format} startup must skip the packet scan`);
    assert.equal(result.RunTimeTicks, 420_000_000);
  }
  assert.equal((await inspectWithoutWaiting(patched, 'Matroska', null)).RunTimeTicks, null);
  assert.equal((await inspectWithoutWaiting(patched, 'MP4', 42)).RunTimeTicks, 600_000_000);
  console.log('PASS: Matroska and WebM startup uses header duration without waiting for the last packet');
  // Exercise the shipped embedding function. Stub GPU/device internals at its
  // negotiation boundary, where an unsupported audio codec rejects this file.
  const make = (source, includeAudio = true) => {
    const file = ts.createSourceFile('engine.js', source, ts.ScriptTarget.Latest, true);
    const exported = file.statements.find(node => ts.isExportDeclaration(node) && node.exportClause?.elements?.some(item => item.name.text === 'createEmbeddedPlayer'));
    const name = exported.exportClause.elements.find(item => item.name.text === 'createEmbeddedPlayer').propertyName.text;
    const fn = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    const observed = [], configurations = [];
    let configurationFactory;
    class Presenter { async setHDROutputEnabled() {} startSession() {} endSession() {} setDecodedFramePushMode() {} attach() {} destroy() {} }
    class Controller {
      playbackState = 'paused'; currentTimeMicroseconds = 0;
      setVolume() {} setMuted() {} setPlaybackRate() {} async play() { return { status: 'started' }; }
      pause() {} resume() {} async destroy() {}
    }
    class FrameLoop { schedule() {} cancel() {} synchronizePageVisibility() {} destroy() {} }
    const sourceInfo = { Container: 'mkv', MediaStreams: [
      { Type: 'Video', Index: 0, Width: 1920, Height: 1080 },
      ...(includeAudio ? [{ Type: 'Audio', Index: 1, Codec: 'eac3', Channels: 6, IsDefault: true }] : []),
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
      sc: () => ({}), $I: noOp, aE: () => 'stereo', GI: value => value, KI: async (_, request) => { configurationFactory = request.createHDRRenderConfiguration;
        configurations.push(configurationFactory(4000)); return true; },
      Uc: Controller, Bc: FrameLoop, Yoe: () => ({}), GV: inputPeakNits => ({ automaticInputPeakNits: true, settings: { mode: 'hdr-to-sdr', toneMapping: { inputPeakNits, outputPeakNits: 100, paperWhiteNits: 203 } } }), DC: (_, reason) => reason, Uoe: 'DirectPlay', Loe: /^\//,
      cr: class extends Error {}, WV: () => 'video-only', Koe: {},
    };
    const context = vm.createContext(globals);
    vm.runInContext(ts.createPrinter().printNode(ts.EmitHint.Unspecified, fn, file) + `\nthis.create = ${name};`, context);
    return { player: context.create({}, { onState: noOp, onDuration: noOp, onTime: noOp, onFallback: noOp, onError: noOp }), observed, configurations, configuration: peak => configurationFactory(peak) };
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
  const baselineHdr = make(original, false);
  await baselineHdr.player.setHDROutput(true, 600);
  await baselineHdr.player.open(request);
  assert.equal(baselineHdr.configurations[0].settings.toneMapping.outputPeakNits, 100,
    'Reproduce: unmodified HDR output still uses the SDR tone-map peak');
  baselineHdr.player.destroy();
  const hdr = make(patched, false);
  await hdr.player.setHDROutput(true, 600); await hdr.player.open(request);
  assert.equal(hdr.configurations[0].settings.toneMapping.outputPeakNits, 600);
  assert.ok(hdr.configurations[0].settings.toneMapping.outputPeakNits / hdr.configurations[0].settings.toneMapping.paperWhiteNits > 1,
    'HDR highlights can exceed SDR reference white');
  assert.equal(hdr.configuration(1000).settings.toneMapping.outputPeakNits, 600, 'Later metadata retains the display target');
  const otherHdr = make(patched, false);
  await otherHdr.player.setHDROutput(true, 1200); await otherHdr.player.open(request);
  assert.equal(otherHdr.configuration(4000).settings.toneMapping.outputPeakNits, 1200);
  assert.equal(hdr.configuration(4000).settings.toneMapping.outputPeakNits, 600, 'Player instances do not share peak settings');
  await hdr.player.setHDROutput(false);
  assert.equal(hdr.configuration(4000).settings.toneMapping.outputPeakNits, 100, 'SDR keeps its original target');
  await hdr.player.setHDROutput(true, NaN);
  assert.equal(hdr.configuration(4000).settings.toneMapping.outputPeakNits, 1000);
  hdr.player.destroy(); otherHdr.player.destroy();
  console.log('PASS: HDR SDR-peak reproduction, configured brightness, metadata persistence, isolated players and SDR reset');
  console.log('PASS: pinned runtime adaptation, changed-source rejection, actual embedding video-only negotiation and unchanged default audio');
})().catch(error => { console.error(error); process.exitCode = 1; });
