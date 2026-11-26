const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function languageRequire(name) {
    if (!['@/lib/media/audio-language', '@/lib/media/stream-release-info', '@/lib/media/stream-codecs', '@/lib/media/stream-cache-status', '@/lib/media/playback-limits'].includes(name)) return require(name);
    const context = { exports: {}, require: languageRequire };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(name.replace('@/', '') + '.ts', 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, context);
    return context.exports;
}

const context = { exports: {}, require: languageRequire, setTimeout, clearTimeout, AbortController };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/media/resolve-playback.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, context);
const { resolvePlayback, playbackPhaseLabels, webMetadataSupport, scoreWebStream } = context.exports;
async function test() {
    const labeled = title => ({ url: 'https://example.test/file.mp4', title });
    assert.ok(scoreWebStream(labeled('1080p H264 AAC DTS')) < scoreWebStream(labeled('1080p H264 AAC')),
        'AAC cannot hide ambiguous potentially unsupported default audio in a mixed release label');
    assert.ok(scoreWebStream(labeled('1080p HEVC AAC DV HDR10')) > scoreWebStream(labeled('1080p HEVC AAC DV')),
        'Dolby Vision with declared HDR10 fallback is ranked differently from DV-only');
    assert.equal(scoreWebStream(labeled('Silent (2020)')), scoreWebStream(labeled('Movie (2020)')),
        'A movie title is not a silent-video warning');
    assert.equal(scoreWebStream(labeled('AAC (2020) 1080p')), scoreWebStream(labeled('Movie (2020) 1080p')),
        'A codec-like movie title before the release metadata tail is not an audio declaration');
    const phases = [], calls = [];
    const deps = {
        async fetchStreams(id, type) {
            calls.push([id, type]);
            return [{ infoHash: 'torrent-only' }, { url: 'https://example.test/top.mkv', behaviorHints: {
                filename: 'Top.mkv', videoSize: 123, proxyHeaders: { request: { Referer: 'https://example.test' } },
            } }, { url: 'https://example.test/lower.mp4' }];
        },
        async getNextEpisodeForSeries(id) {
            calls.push(['episode', id]);
            return { id: 'show:1:2', title: 'Second episode', season: 1, episode: 2, resumePositionTicks: 42 };
        },
    };
    const movie = await resolvePlayback({ id: 'movie', name: 'Movie', type: 'movie' }, deps, phase => phases.push(phase));
    assert.equal(movie.streamUrl, 'https://example.test/top.mkv');
    assert.equal(movie.requestHeaders.Referer, 'https://example.test');
    assert.equal(movie.subtitleFilename, 'Top.mkv');
    assert.equal(movie.subtitleVideoSize, 123);
    assert.deepEqual(phases, ['fetching-streams', 'loading-stream']);
    assert.deepEqual(calls, [['movie', 'movie']]);
    calls.length = phases.length = 0;
    const episode = await resolvePlayback({ id: 'show', name: 'Show', type: 'series', mediaSourceId: 'show:2:3', resumePositionTicks: 15 }, deps, phase => phases.push(phase));
    assert.deepEqual(calls, [['show:2:3', 'series']], 'Explicit episode Play must fetch that episode, not the series or first episode');
    assert.equal(episode.resumePositionTicks, 15);
    calls.length = phases.length = 0;
    const show = await resolvePlayback({ id: 'show', name: 'Show', type: 'series' }, deps, phase => phases.push(phase));
    assert.deepEqual(calls, [['episode', 'show'], ['show:1:2', 'series']]);
    assert.equal(show.showName, 'Show');
    assert.equal(show.episodeTitle, 'Second episode');
    assert.equal(show.resumePositionTicks, 42);
    assert.deepEqual(phases, ['finding-episode', 'fetching-streams', 'loading-stream']);
    calls.length = phases.length = 0;
    const direct = await resolvePlayback({ ...movie, streamUrl: 'https://example.test/chosen.mp4' }, deps, phase => phases.push(phase));
    assert.equal(direct.streamUrl, 'https://example.test/chosen.mp4');
    assert.deepEqual(calls, [], 'A manually chosen stream must not trigger source selection');
    assert.deepEqual(phases, ['loading-stream']);
    await assert.rejects(resolvePlayback({ id: 'empty', name: 'Empty', type: 'movie' }, { ...deps, fetchStreams: async () => [] }, () => {}), /No playable streams found/);
    const browserStreams = [
        { url: 'https://example.test/remux.mkv', title: '2160p DV HEVC DTS-HD MA REMUX' },
        { url: 'https://example.test/silent.mp4', title: '2160p H264 video only no audio' },
        { url: 'https://example.test/low.mp4', title: '720p H264 AAC' },
        { url: 'https://example.test/best.mp4', title: '1080p WEB-DL H264 AAC 5.1' },
        { url: 'https://example.test/header.mp4', title: '2160p H264 AAC', behaviorHints: { proxyHeaders: { request: { Referer: 'https://example.test' } } } },
    ];
    let candidates;
    const webDeps = { ...deps, environment: 'web', autoSelectWebStream: true, fetchStreams: async () => browserStreams,
        verifyStream: async () => 'supported',
        onCandidates: streams => { candidates = streams; } };
    for (const autoSelectWebStream of [undefined, false]) {
        let inspections = 0;
        const first = await resolvePlayback({ id: 'movie', name: 'Movie', type: 'movie' }, {
            ...webDeps, autoSelectWebStream, canPlayType: () => false,
            inspectStream: async () => { inspections++; return undefined; },
        }, () => {});
        assert.equal(inspections, 0, 'Default playback must not inspect candidates');
        assert.equal(first.streamUrl, browserStreams[0].url, 'Automatic selection is off by default and retains desktop ordering');
        assert.equal(candidates.length, browserStreams.length, 'Default playback does not filter unsupported candidates');
    }
    const web = await resolvePlayback({ id: 'movie', name: 'Movie', type: 'movie', resumePositionTicks: 8228 }, webDeps, () => {});
    assert.equal(web.streamUrl, 'https://example.test/best.mp4', 'Web must prioritize supported video AND audio over the first add-on file, silent video, and headers it cannot send');
    assert.equal(web.resumePositionTicks, 8228);
    const next = await resolvePlayback({ id: 'movie', name: 'Movie', type: 'movie' }, { ...webDeps, excludeUrls: new Set([web.streamUrl]) }, () => {});
    assert.equal(next.streamUrl, 'https://example.test/low.mp4', 'Fallback must choose the next compatible file without repeating a failed URL');
    assert.ok(candidates.length > 1);
    const capabilityStreams = [
        { url: 'https://example.test/4k.mp4', title: '2160p HEVC AAC 5.1' },
        { url: 'https://example.test/1080.mp4', title: '1080p H264 AAC 5.1' },
        { url: 'https://example.test/silent-ddp.mp4', title: '2160p H264 DDP5.1' },
    ];
    const capabilityDeps = { ...webDeps, fetchStreams: async () => capabilityStreams };
    const unsupported = await resolvePlayback({ id: 'movie', name: 'Movie', type: 'movie' }, { ...capabilityDeps, canPlayType: () => false }, () => {});
    assert.equal(unsupported.streamUrl, 'https://example.test/1080.mp4', 'Unsupported HEVC and DDP5.1 audio must lose to a fully compatible source');
    const supported = await resolvePlayback({ id: 'movie', name: 'Movie', type: 'movie' }, { ...capabilityDeps, canPlayType: mime => mime.includes('hvc1') }, () => {});
    assert.equal(supported.streamUrl, 'https://example.test/4k.mp4', 'Prefer higher video quality when its video and audio codecs are supported');

    const inspected = [];
    const actualTracks = url => ({ mimeType: 'video/mp4', video: { codec: 'avc', codecString: 'avc1.640028', internalCodecId: 'avc1' },
        audio: [{ codec: url.includes('best') ? 'ac3' : 'aac', codecString: url.includes('best') ? 'ac-3' : 'mp4a.40.2', internalCodecId: url.includes('best') ? 'ac-3' : 'mp4a', primary: true, channels: 2 }] });
    const verified = await resolvePlayback({ id: 'movie', name: 'Movie', type: 'movie' }, { ...webDeps,
        canPlayType: mime => !mime.includes('ac-3'),
        inspectStream: async stream => { inspected.push(stream.url); return actualTracks(stream.url); },
        verifyStream: async stream => webMetadataSupport(actualTracks(stream.url), mime => !mime.includes('ac-3')),
    }, () => {});
    assert.equal(verified.streamUrl, 'https://example.test/low.mp4', 'Actual unsupported default audio must override an AAC filename claim');
    assert.ok(inspected.length >= 2 && inspected.length <= 5, 'Preflight uses a small bounded candidate pool');
    const mixedAudio = actualTracks('best');
    mixedAudio.audio.push({ ...actualTracks('low').audio[0], primary: false });
    assert.equal(webMetadataSupport(mixedAudio, mime => !mime.includes('ac-3')), 'unsupported', 'An alternate AAC track cannot hide unsupported primary audio');
    assert.equal(webMetadataSupport({ ...mixedAudio, audio: [] }, () => true), 'unsupported', 'A file without audio is unsuitable for movie playback');
    assert.equal(webMetadataSupport({ ...mixedAudio, audio: [{ codec: 'pcm-s16', codecString: 'pcm-s16', internalCodecId: 'A_PCM/INT/LIT', primary: true }] }, mime => mime.startsWith('video/') || mime === 'audio/wav'), 'supported', 'PCM audio must use WAV capabilities instead of an invalid MP4 PCM codec string');
    const unavailable = await resolvePlayback({ id: 'movie', name: 'Movie', type: 'movie' }, { ...webDeps,
        canPlayType: () => true, inspectStream: async () => { throw new Error('CORS'); },
    }, () => {});
    assert.equal(unavailable.streamUrl, web.streamUrl, 'Unavailable metadata must preserve normal ranking rather than reject every source');
    const described = await resolvePlayback({ id: 'movie', name: 'Movie', type: 'movie' }, { ...webDeps, fetchStreams: async () => [
        { url: 'https://example.test/a.mp4', description: '2160p H264 Dolby Digital Plus 5.1' },
        { url: 'https://example.test/b.mp4', description: '1080p H264 AAC' },
    ], canPlayType: () => false }, () => {});
    assert.equal(described.streamUrl, 'https://example.test/b.mp4', 'Modern Stremio description metadata must participate in audio filtering');

    const native = await resolvePlayback({ id: 'movie', name: 'Movie', type: 'movie' }, { ...webDeps, environment: 'native',
        inspectStream: async () => { assert.fail('Native selection must not probe or filter sources'); },
    }, () => {});
    assert.equal(native.streamUrl, browserStreams[0].url, 'Native playback must preserve add-on order');
    assert.equal(playbackPhaseLabels['fetching-streams'], 'Fetching streams…');
    assert.equal(playbackPhaseLabels['loading-stream'], 'Loading stream…');
    console.log('PASS: movie/episode/show Play selects the first playable source in order, preserves headers and resume data, respects manual sources, and reports accurate phases.');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
