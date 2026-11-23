const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const constants = { URL, TextDecoder, Uint8Array, Response };
const { chapterCues, parseMatroskaChapters } = load('lib/media/chapters.ts', {}, constants);
const settle = () => new Promise(resolve => setImmediate(resolve));
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

    const host = hooks();
    const requestsForFrames = [], released = [];
    const media = Object.assign(new EventTarget(), { paused: false, readyState: 1, controller: {
        previewIfIdle: async time => { requestsForFrames.push(time); return `frame:${time}`; },
    } });
    const document = new EventTarget();
    let finishFirstCheck;
    const { useChapterPreviews } = load('components/player-chapter-choices.tsx', {
        react: host.react, 'react/jsx-runtime': host.jsx,
        '@mux/mux-video-react': 'mux', 'lucide-react': {}, 'media-chrome/utils/time': {},
        '@/components/artwork-image': {}, '@/lib/desktop/bridge': { desktopBridge: () => ({ capabilities: { nativePreviews: true } }) },
        '@/lib/media/chapter-preview-image': { loadChapterImage: async src => src === 'frame:2'
            ? new Promise(resolve => { finishFirstCheck = resolve; }) : src },
        '@/lib/media/preview-frames': {}, '@/lib/media/range-preview-frames': {}, './player-selection-row-styles': {},
    }, { document, URL: { revokeObjectURL: src => released.push(src) } });
    const chapters = Array.from({ length: 52 }, (_, index) => ({ startTime: index * 10, endTime: index * 10 + 10 }));
    let navigation = { source: 'https://fixture.test/first.mkv', media };
    const renderPreviews = (open = false) => host.render(() => useChapterPreviews(navigation, chapters, open, true));
    renderPreviews(); host.flush();
    assert.equal(requestsForFrames.length, 0, 'Warmup waits for a playable frame');
    media.paused = true;
    media.readyState = 2;
    media.dispatchEvent(new Event('loadeddata'));
    assert.deepEqual(requestsForFrames, [2], 'Start at the first decoded frame with the drawer closed');
    await settle();
    assert.equal(requestsForFrames.length, 52, 'Reuse one decoder while checking the previous image');
    assert.equal(renderPreviews().images.size, 51);
    finishFirstCheck(null);
    await settle();
    assert.equal(requestsForFrames.length, 53, 'Continue warming the full list with the drawer closed after pausing');
    assert.equal(requestsForFrames.at(-1), 4, 'Retry black images at another timestamp');
    renderPreviews(true).showFrames([500]); host.flush();
    renderPreviews().showFrames([]); host.flush();
    const loaded = renderPreviews(true).images;
    assert.equal(loaded.size, 52, 'Keep all warmed images, including more than 48 chapters');
    assert.equal(loaded.get(0), 'frame:4', 'Use the original chapter start as the image key');
    assert.equal(loaded.get(500), 'frame:502', 'Closing and reopening retains loaded previews');
    assert.equal(requestsForFrames.length, 53, 'Reopening never decodes cached chapter images again');
    navigation = { ...navigation, source: 'https://fixture.test/second.mkv' };
    assert.equal(renderPreviews().images.size, 0, 'Previews are isolated to the playback source');
    host.flush(); host.unmount();
    assert.equal(released.length, 52, 'Release chapter images when playback changes');
    console.log('PASS: chapter metadata and session isolation, immediate warmup, parallel image checks, black-frame retries and retention');
}

async function testBrowserFallback() {
    const host = hooks();
    const document = new EventTarget();
    document.createElement = () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'frame:browser' });
    const requests = [];
    const chapters = [{ startTime: 0, endTime: 10 }, { startTime: 10, endTime: 10.5 }];
    const media = Object.assign(new EventTarget(), { paused: false, readyState: 4 });
    const navigation = { source: 'https://fixture.test/chapters.mp4', media };
    let finishRangeCheck;
    const { useChapterPreviews } = load('components/player-chapter-choices.tsx', {
        react: host.react, 'react/jsx-runtime': host.jsx,
        '@mux/mux-video-react': 'mux', 'lucide-react': {}, 'media-chrome/utils/time': {},
        '@/components/artwork-image': {}, '@/lib/desktop/bridge': { desktopBridge: () => undefined },
        '@/lib/media/chapter-preview-image': { loadChapterImage: async src => src === 'frame:range'
            ? new Promise(resolve => { finishRangeCheck = resolve; }) : src },
        '@/lib/media/range-preview-frames': { RangePreviewFrames: class {
            constructor(source, ready, unavailable) { this.ready = ready; this.unavailable = unavailable; }
            want(time) { if (time === 2) this.ready(time, 'frame:range'); else this.unavailable(); }
            cancel() {}
            dispose() {}
        } }, './player-selection-row-styles': {},
    }, { document, URL: { revokeObjectURL() {} }, VideoDecoder: {} });
    const render = () => host.render(() => useChapterPreviews(navigation, chapters, false, true));
    assert.equal(render().decoder, false);
    host.flush(); await settle();
    assert.equal(render().decoder, false, 'Allow the previous JPEG check to complete before replacing the decoder');
    finishRangeCheck('frame:range');
    await settle();
    const fallback = render();
    assert.equal(fallback.decoder.type, 'video', 'Range failure mounts the fallback while the drawer is closed');
    assert.equal(fallback.images.get(0), 'frame:range');
    const video = Object.assign(new EventTarget(), {
        readyState: 2, currentTime: 0, pause() {}, removeAttribute() {}, load() {},
    });
    Object.defineProperty(video, 'currentTime', { get: () => requests.at(-1) ?? 0, set: time => requests.push(time) });
    fallback.decoder.props.ref(video);
    host.flush(); render(); host.flush();
    assert.deepEqual(requests, [10.25], 'Only the missing chapter is sought, within its short span');
    video.dispatchEvent(new Event('seeked'));
    await settle();
    assert.equal(render().images.get(0), 'frame:range');
    assert.equal(render().images.get(10), 'frame:browser');
    assert.equal(media.currentTime, undefined, 'Preview generation must never seek the playing video');
    host.flush(); host.unmount();
    console.log('PASS: browser fallback warms with the drawer closed, preserves existing images and respects short chapters');
}

async function testImageSelection() {
    const pixels = new Uint8ClampedArray(32 * 18 * 4).fill(8);
    const released = [];
    let serial = 0;
    const controller = new AbortController();
    const { loadChapterImage } = load('lib/media/chapter-preview-image.ts', {}, {
        fetch: async () => ({ ok: true, blob: async () => ({ size: 1 }) }),
        URL: { createObjectURL: () => `blob:frame-${++serial}`, revokeObjectURL: url => released.push(url) },
        Image: class { async decode() {} },
        document: { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) }) }) },
    });
    assert.equal(await loadChapterImage('blob:thumbnail', controller.signal), null, 'Reject near-black frames');
    assert.deepEqual(released, ['blob:frame-1']);
    pixels.fill(80, 0, 16 * 4);
    assert.equal(await loadChapterImage('blob:thumbnail', controller.signal), 'blob:frame-2', 'Keep dark scenes with visible detail');
    controller.abort();
    assert.equal(await loadChapterImage('blob:thumbnail', controller.signal), null);
    assert.equal(serial, 2, 'Canceled playback must not create an image URL');
    console.log('PASS: near-black detection, dark scene retention and URL cleanup');
}

main().then(testBrowserFallback).then(testImageSelection).catch(error => { console.error(error); process.exitCode = 1; });
