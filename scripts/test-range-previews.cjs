const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile = path => ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const frames = { exports: {} }; vm.runInNewContext(compile('lib/media/preview-frames.ts'), frames);
let sourceOptions, sourceUrl, disposed = 0, decodable = true, fallback = 0;
const requests = [], answers = [], revoked = [], keyLookups = [];
const timers = new Map();
let blobId = 0, timerId = 0;
const bundle = {
  MP4: {}, MATROSKA: {}, WEBM: {}, QTFF: {},
  UrlSource: class { constructor(url, options) { sourceUrl = url; sourceOptions = options; } },
  Input: class { async getPrimaryVideoTrack() { return { canDecode: async () => decodable, getDisplayWidth: async () => 3840, getDisplayHeight: async () => 2160 }; } dispose() { disposed++; } },
  EncodedPacketSink: class {
    async getKeyPacket(time, options) {
      assert.equal(options.metadataOnly, true);
      keyLookups.push(time);
      return { timestamp: Math.floor(time / 10) * 10 };
    }
  },
  CanvasSink: class { constructor(track, options) { assert.ok(options.width <= 448 && options.height <= 252); assert.equal(options.poolSize, 1); } getCanvas(time) { return new Promise(resolve => requests.push({ time, resolve })); } },
};
let response;
const context = { exports: {},
  setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
  clearTimeout(id) { timers.delete(id); }, Headers, AbortController, AbortSignal,
  URL: { createObjectURL: () => `blob:preview-${++blobId}`, revokeObjectURL: src => revoked.push(src) }, fetch: async () => response,
  document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,thumbnail' }) },
  require: name => name === 'mediabunny' ? bundle : name === './webgpu-source' ? { resolveWebGpuSource: async () => 'https://fixture.test/resolved.mkv' } : frames.exports,
};
vm.runInNewContext(compile('lib/media/range-preview-frames.ts'), context);
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const finish = index => requests[index].resolve({ canvas: { width: 448, height: 252, convertToBlob: async () => new Blob([new Uint8Array(2048)], { type: 'image/jpeg' }) }, timestamp: requests[index].time - .02, duration: .04 });
(async () => {
  const preview = new context.exports.RangePreviewFrames('https://fixture.test/large-hdr.mkv', (...args) => answers.push(args), () => fallback++);
  try {
    await preview.prepare(); assert.equal(requests.length, 0, 'Warm only the index, without decoding background frames');
    assert.equal(sourceUrl, 'https://fixture.test/resolved.mkv', 'Previews share the playback redirect resolver');
    preview.want(24); await settle(); assert.equal(requests[0].time, 20, 'Decode the keyframe first');
    assert.equal(sourceOptions.parallelism, 2); assert.ok(sourceOptions.maxCacheSize <= 16 * 1024 * 1024);
    finish(0); await settle(); assert.equal(answers.at(-1)[0], 24);
    const first = answers.at(-1)[1];
    preview.want(22); await settle();
    assert.deepEqual(answers.at(-1), [22, first], 'Reuse the same image within a known keyframe interval');
    assert.deepEqual(keyLookups, [24]);
    assert.equal(requests.length, 1);
    preview.want(26); await settle();
    assert.deepEqual(answers.at(-1), [26, first], 'New positions in the same keyframe reuse its JPEG');
    assert.equal(requests.length, 1, 'Moving within a keyframe never repeats decoding');
    assert.equal(timers.size, 0, 'A cached keyframe leaves no delayed refinement scheduled');
    preview.want(44); await settle();
    assert.equal(requests[1].time, 40);
    preview.want(63); finish(1); await settle();
    assert.equal(requests[2].time, 60);
    assert.equal(answers.at(-1)[0], 44, 'Keep showing completed keyframes while the pointer moves');
    finish(2); await settle(); assert.equal(answers.at(-1)[0], 63);
    assert.equal(timers.size, 0, 'After the pointer stops, no exact frame is scheduled');
    preview.want(26); await settle();
    assert.deepEqual(answers.at(-1), [26, first]);
    assert.equal(requests.length, 3, 'Returning to a cached interval avoids decoding');
    preview.want(80); await settle(); preview.cancel(); finish(3); await settle();
    assert.equal(answers.at(-1)[0], 26, 'Hover exit suppresses publication');
    assert.equal(requests.length, 4);
    let cancelled = false;
    response = { ok: true, status: 200, body: { cancel: async () => { cancelled = true; } } };
    await assert.rejects(sourceOptions.fetchFn('https://fixture.test/no-range', { headers: { Range: 'bytes=0-65535' } }));
    assert.equal(cancelled, true, 'A server ignoring ranges cannot trigger a whole-file download');
  } finally { preview.dispose(); }
  assert.equal(disposed, 1); assert.equal(fallback, 0);
  assert.equal(revoked.length, blobId, 'All cached binary frames are released on disposal');
  decodable = false;
  const unsupported = new context.exports.RangePreviewFrames('https://fixture.test/unsupported.mkv', () => {}, () => fallback++);
  unsupported.want(10); await settle(); assert.equal(fallback, 1); assert.equal(disposed, 2);
  decodable = true;
  const chapterAnswers = [];
  const exact = new context.exports.RangePreviewFrames('https://fixture.test/chapters.mkv', (...args) => chapterAnswers.push(args), () => fallback++, true);
  try {
    exact.want(24); await settle();
    assert.equal(requests[4].time, 24, 'Chapter samples must decode the requested time instead of an earlier keyframe');
    requests[4].resolve(null); await settle();
    assert.deepEqual(chapterAnswers, [[24, null]], 'A missing frame should allow another sample without switching decoders');
    exact.want(26); await settle();
    assert.equal(requests[5].time, 26);
    finish(5); await settle();
    assert.equal(chapterAnswers.at(-1)[0], 26);
    assert.match(chapterAnswers.at(-1)[1], /^blob:/);
    assert.equal(fallback, 1);
  } finally { exact.dispose(); }
  // Exercise the real demuxer against a sparse 8GB MP4 without a server/browser.
  const { Input, UrlSource, MP4, EncodedPacketSink } = require('mediabunny');
  const fixture = fs.readFileSync('scripts/fixtures/seek-preview.mp4');
  const size = 8 * 1024 ** 3;
  let moov;
  for (let at = 0; at < fixture.length;) {
    const length = fixture.readUInt32BE(at);
    assert.ok(length >= 8);
    if (fixture.toString('ascii', at + 4, at + 8) === 'moov') moov = { at, length, data: fixture.subarray(at, at + length) };
    at += length;
  }
  assert.ok(moov);
  // Keep sample byte offsets intact, but move the index to the far end of 8GB.
  const prefix = Buffer.alloc(fixture.length + 16); fixture.copy(prefix);
  prefix.fill(0, moov.at, moov.at + moov.length); prefix.writeUInt32BE(moov.length, moov.at); prefix.write('free', moov.at + 4);
  prefix.writeUInt32BE(1, fixture.length); prefix.write('free', fixture.length + 4); prefix.writeBigUInt64BE(BigInt(size - fixture.length - moov.length), fixture.length + 8);
  let bytes = 0, ranges = 0, readTail = false;
  const input = new Input({ formats: [MP4], source: new UrlSource('https://fixture.test/eight-gigabytes.mp4', {
    parallelism: 1, getRetryDelay: () => null,
    fetchFn: async (url, init) => {
      const range = new Headers(init.headers).get('Range'); assert.ok(range);
      const match = /bytes=(\d+)-(\d*)/.exec(range); assert.ok(match);
      const start = Number(match[1]), end = Math.min(size - 1, start + 65535, match[2] ? Number(match[2]) : size - 1);
      const body = new Uint8Array(end - start + 1);
      if (start < prefix.length) body.set(prefix.subarray(start, Math.min(prefix.length, end + 1)));
      const tailAt = size - moov.length;
      if (end >= tailAt) {
        const from = Math.max(start, tailAt);
        body.set(moov.data.subarray(from - tailAt, end - tailAt + 1), from - start); readTail = true;
      }
      bytes += body.length; ranges++;
      return new Response(body, { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(body.length) } });
    },
  }) });
  try {
    const track = await input.getPrimaryVideoTrack(); assert.ok(track);
    const packet = await new EncodedPacketSink(track).getKeyPacket(1);
    assert.ok(packet?.data.length); assert.ok(packet.timestamp <= 1);
    assert.ok(readTail, 'The large-file index is read from the end using 64-bit byte positions');
    assert.ok(bytes < 1024 * 1024, `Sparse metadata/keyframe extraction read ${bytes} bytes`);
    console.log(`PASS: real 8GB MP4 sparse range demux (${bytes} bytes, ${ranges} requests), bounded HDR decoding, latest request/cache/cancel and HTML fallback`);
  } finally { input.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
