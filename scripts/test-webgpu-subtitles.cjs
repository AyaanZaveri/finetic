const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');
const tick = async () => { for (let i = 0; i < 120; i++) await Promise.resolve(); };
const encoder = new TextEncoder();
const id = n => Buffer.from(n.toString(16).padStart(2, '0'), 'hex');
const el = (n, payload) => {
  payload = Buffer.from(payload); let length = 1;
  while (payload.length >= 2 ** (7 * length) - 1) length++;
  let size = payload.length + 2 ** (7 * length); const bytes = Buffer.alloc(length);
  for (let i = length - 1; i >= 0; i--) { bytes[i] = size % 256; size = Math.floor(size / 256); }
  return Buffer.concat([id(n), bytes, payload]);
};
const num = (n, value) => el(n, [value]);
const str = (n, value) => el(n, encoder.encode(value));
const entry = (number, label, codec = 'S_TEXT/UTF8', extra = []) => el(0xae, Buffer.concat([
  num(0xd7, number), num(0x83, 17), str(0x86, codec), str(0x22b59c, 'eng'), str(0x536e, label), ...extra,
]));
const table = el(0x1654ae6b, Buffer.concat([
  entry(7, 'English'), entry(42, 'English SDH', 'S_TEXT/UTF8', [num(0x55ab, 1)]),
  entry(60, 'Styled', 'S_TEXT/ASS'), entry(80, 'Pictures', 'S_HDMV/PGS'),
  entry(90, 'Forced', 'S_TEXT/UTF8', [num(0x55aa, 1)]),
]));
const header = Buffer.concat([el(0x1a45dfa3, []), el(0x18538067, table)]);
const globals = { TextDecoder, TextEncoder, Uint8Array, Blob, Response, DecompressionStream, Event, EventTarget,
  fetch: async () => new Response(header, { status: 206, headers: { 'Content-Range': `bytes 0-${header.length - 1}/${header.length}` } }) };
const api = load('lib/media/matroska-subtitles.ts', {}, globals);
const managerApi = load('lib/media/webgpu-subtitles.ts', {}, globals);
(async () => {
  const parsed = api.parseMatroskaSubtitleTracks(header);
  assert.equal(parsed.length, 4, 'Expose readable text tracks, not unsupported picture captions');
  assert.deepEqual(Array.from(parsed, track => track.number), [7, 42, 60, 90], 'Keep container track numbers, not menu ordinals');
  assert.equal(parsed[1].hearingImpaired, true); assert.equal(parsed[3].forced, true);
  const read = await api.readMatroskaSubtitleTracks('https://example.test/film.mkv', new AbortController().signal);
  assert.equal(read.length, 4);
  const packet = (trackNumber, timestampMs, text, durationMs = 2000) => ({ trackNumber, timestampMs, durationMs, data: encoder.encode(text) });
  const events = [], manager = managerApi.createWebGpuSubtitles('https://example.test/film.mkv', name => events.push(name));
  manager.supply([packet(42, 1000, '<i>Hello</i>\n&amp; goodbye')]);
  manager.start(); await tick();
  assert.equal(manager.tracks.length, 4);
  assert.equal(manager.text(1.5), null, 'Embedded captions start off until selected');
  manager.tracks[1].mode = 'showing';
  assert.equal(manager.text(1.5), 'Hello\n& goodbye', 'Early blocks render in the selected container track');
  assert.equal(manager.text(4), null); assert.equal(manager.text(1.5), 'Hello\n& goodbye', 'Backward seeks reuse retained cues');
  manager.supply([packet(42, 1000, '<i>Hello</i>\n&amp; goodbye'), packet(42, 1500, 'Overlap', 2000)]); await tick();
  assert.equal(manager.text(2), 'Hello\n& goodbye\nOverlap', 'Repeated clusters do not duplicate captions and overlaps remain visible');
  manager.tracks[1].mode = 'disabled'; assert.equal(manager.text(2), null, 'Off clears the current caption immediately');
  manager.tracks[2].mode = 'showing';
  manager.supply([packet(60, 4000, '0,0,Default,,0,0,0,,{\\i1}A comma, and a line\\NNext', 3000)]); await tick();
  assert.equal(manager.text(4.5), 'A comma, and a line\nNext', 'ASS text fallback strips fields and styling without losing commas');
  assert.ok(events.includes('subtitlechange')); assert.ok(events.includes('trackschange'));
  manager.dispose(); manager.supply([packet(60, 5000, 'late')]); await tick(); assert.equal(manager.text(5.5), null);

  // SeekHead can put Tracks outside the first header read. The reader follows only that range.
  const position = 200;
  const seek = el(0x114d9b74, el(0x4dbb, Buffer.concat([el(0x53ab, id(0x1654ae6b)), num(0x53ac, position)])));
  const padding = el(0xec, Buffer.alloc(position - seek.length - 3));
  const segment = Buffer.concat([seek, padding, table]);
  const separated = Buffer.concat([el(0x1a45dfa3, []), el(0x18538067, segment)]);
  const requests = [];
  const rangeApi = load('lib/media/matroska-subtitles.ts', {}, { ...globals, fetch: async (_, options) => {
    const start = Number(/^bytes=(\d+)-/.exec(options.headers.Range)[1]); requests.push(start);
    const bytes = start ? table : separated.subarray(0, 100);
    return new Response(bytes, { status: 206 });
  } });
  assert.equal((await rangeApi.readMatroskaSubtitleTracks('https://example.test/sparse.mkv', new AbortController().signal)).length, 4);
  assert.equal(requests.length, 2, 'Read the header and one track range, not video clusters');
  console.log('PASS: embedded Matroska headers, language/SDH/forced flags, sparse track reads, packet reuse, Off, seeks, overlap, ASS text fallback and disposal');
})().catch(error => { console.error(error); process.exitCode = 1; });
