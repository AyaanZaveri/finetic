const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');
const constants = { URL, TextDecoder, Uint8Array, Response };
const { chapterCues, parseMatroskaChapters } = load('lib/media/chapters.ts', {}, constants);
const bytes = (...parts) => Buffer.concat(parts.map(part => Buffer.from(part)));
function el(id, data) {
    const tag = Buffer.from(id.toString(16).padStart(id > 255 ? 4 : 2, '0'), 'hex');
    const size = data.length < 127 ? [0x80 | data.length] : [0x40 | data.length >> 8, data.length & 255];
    return bytes(tag, size, data);
}
function uint(id, value) {
    const data = Buffer.alloc(8); data.writeBigUInt64BE(BigInt(value)); return el(id, data);
}
const atom = (time, title) => el(0xb6, bytes(uint(0x91, time * 1e9), el(0x80, el(0x85, Buffer.from(title)))));
const chapterData = el(0x1043a770, el(0x45b9, bytes(atom(0, 'Opening'), atom(60, 'The journey'), atom(120, 'Credits'))));
const markers = parseMatroskaChapters(chapterData);
assert.deepEqual(JSON.parse(JSON.stringify(markers)), [
    { time: 0, title: 'Opening' }, { time: 60, title: 'The journey' }, { time: 120, title: 'Credits' },
]);
const cues = chapterCues(markers, 150);
assert.equal(cues[0].endTime, 60);
assert.equal(cues[1].text, 'The journey');
assert.equal(cues[2].endTime, 150);
assert.equal(cues.find(cue => 60 >= cue.startTime && 60 < cue.endTime).text, 'The journey');
const corrupt = chapterCues([{ time: 60 }, { time: -1 }, { time: Infinity }, { time: 60, title: 'Duplicate' }, { time: 500 }, { time: 0, title: '  Intro  ' }], 120);
assert.equal(corrupt.length, 2);
assert.equal(corrupt[0].text, 'Intro');
assert.equal(corrupt[1].text, 'Chapter 2');
assert.equal(chapterCues(markers, NaN).length, 0);
const ordered = el(0x1043a770, el(0x45b9, bytes(uint(0x45dd, 1), atom(5, 'Virtual'))));
assert.equal(parseMatroskaChapters(ordered).length, 0, 'Do not mislabel virtual ordered-edition times');

// A sparse file must not keep Intro over the entire story until Credits.
const { boundSkipChapterLabels, chapterTrackMask } = load('lib/media/chapter-timeline.ts');
const sparse = chapterCues([{ time: 0, title: 'Intro' }, { time: 1200, title: 'Credits' }], 1500);
const bounded = boundSkipChapterLabels(sparse, [
    { kind: 'intro', start: 0, end: 90 }, { kind: 'credits', start: 1200, end: 1350 },
]);
const at = time => bounded.find(cue => cue.startTime <= time && time < cue.endTime)?.text;
assert.equal(at(30), 'Intro');
assert.equal(at(90), undefined);
assert.equal(at(800), undefined, 'Story time must not be labeled Intro');
assert.equal(at(1250), 'Credits');
assert.equal(at(1400), undefined, 'Post-credit story time must not be labeled Credits');
const normal = [{ startTime: 0, endTime: 100, text: 'The journey' }];
assert.equal(boundSkipChapterLabels(normal, [{ kind: 'intro', start: 0, end: 90 }])[0], normal[0]);
const explicit = el(0x1043a770, el(0x45b9, el(0xb6, bytes(uint(0x91, 0), uint(0x92, 90e9), el(0x80, el(0x85, Buffer.from('Intro')))))));
assert.equal(chapterCues(parseMatroskaChapters(explicit), 1500)[0].endTime, 90, 'Retain authored MKV end times');
const mask = chapterTrackMask(bounded, 0, 1500);
assert.match(mask, /transparent calc\(clamp\(min\(5px, 50%\), 6%, max\(50%, 100% - 5px\)\) - 1px\)/, 'The intro gap must preserve the track caps');
assert.match(mask, /80%/);
const edgeMask = chapterTrackMask([{ startTime: 0.1, endTime: 999.9, text: 'Story' }], 0, 1000);
assert.equal(edgeMask.match(/clamp\(min\(5px, 50%\),/g).length, 8, 'Both sides of each near-edge gap are bounded');
assert.equal(chapterTrackMask([], 0, 100), undefined);
assert.equal(chapterTrackMask(bounded, 0, 0), undefined);

async function main() {
    const segment = el(0x18538067, chapterData);
    const mkv = bytes(el(0x1a45dfa3, []), segment);
    let requests = [];
    let module = load('lib/media/chapters.ts', {}, { ...constants, fetch: async (_, options) => {
        requests.push(options);
        return new Response(mkv, { status: 206, headers: { 'content-range': `bytes 0-${mkv.length - 1}/${mkv.length}` } });
    } });
    assert.equal((await module.readEmbeddedChapters('https://fixture.test/file', new AbortController().signal)).length, 3);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.Range, 'bytes=0-262143');
    // SeekHead points to chapter metadata beyond the video clusters.
    const target = 1000000;
    const seek = el(0x114d9b74, el(0x4dbb, bytes(uint(0x53ab, 0x1043a770), uint(0x53ac, target))));
    const head = bytes(el(0x1a45dfa3, []), Buffer.from([0x18,0x53,0x80,0x67,0xff]), seek);
    requests = [];
    module = load('lib/media/chapters.ts', {}, { ...constants, fetch: async (_, options) => {
        requests.push(options.headers.Range);
        return new Response(requests.length === 1 ? head : chapterData, { status: 206 });
    } });
    assert.equal((await module.readEmbeddedChapters('https://fixture.test/file', new AbortController().signal))[1].title, 'The journey');
    assert.equal(requests.length, 2);
    assert.equal(requests[1], `bytes=${target + 10}-${target + 10 + 262143}`);
    let canceled = false;
    module = load('lib/media/chapters.ts', {}, { ...constants, fetch: async () => ({ status: 200, body: { cancel: async () => { canceled = true; } } }) });
    await assert.rejects(() => module.readEmbeddedChapters('https://fixture.test/file', new AbortController().signal), /HTTP ranges/);
    assert.ok(canceled, 'Never consume a full video response');
    const { MpvController } = load('lib/desktop/mpv-controller.ts', {
        '@/lib/media/playback-preferences': { readPlaybackPreferences: () => ({ audioLanguage: 'en' }) },
    }, { Event, EventTarget, CustomEvent, DOMException, URL, crypto: require('node:crypto') });
    const sent = []; let receive;
    const controller = new MpvController({ platform: 'macos', send: message => sent.push(message), subscribe: listener => { receive = listener; return () => {}; } });
    controller.load('https://fixture.test/first');
    const first = sent.find(message => message.type === 'load').session;
    receive({ type: 'chapters', session: first, chapters: markers });
    assert.equal(controller.chapters.length, 3);
    controller.load('https://fixture.test/second');
    assert.equal(controller.chapters.length, 0);
    receive({ type: 'chapters', session: first, chapters: markers });
    assert.equal(controller.chapters.length, 0, 'Previous playback cannot replace current chapters');
    controller.dispose();
    console.log('PASS: embedded MKV chapters, names/boundaries, invalid markers, ordered editions, SeekHead range reads, full-download rejection, and native session isolation');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
