const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, requireFn) {
    const context = { exports: {}, require: requireFn, setTimeout, clearTimeout, AbortController };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, context);
    return context.exports;
}
const language = load('lib/media/audio-language.ts');
const { streamEnglishPreference: rank, preferredEnglishTrack, installEnglishAudioPreference } = language;
assert.equal(rank({ description: '✓ ʀᴜ · ᴇɴ · sᴜʙ (ᴇɴᶜᶜ · ᴇɴ)' }), 1);
assert.equal(rank({ description: 'Audio: Russian\nSubtitles: English' }), -1);
assert.equal(rank({ title: 'Movie.Rus.Eng.1080p' }), 1);
assert.equal(rank({ description: 'Russian audio, English subtitles' }), -1);
assert.equal(rank({ title: 'Movie.ENG.1080p' }), 2);
assert.equal(rank({ title: 'Movie.1080p' }), 0);
const tracks = [{ language: 'ru', enabled: true }, { language: 'eng', label: 'Commentary', enabled: false }, { language: 'en-US', enabled: false }];
assert.equal(preferredEnglishTrack(tracks), tracks[2]);
assert.equal(preferredEnglishTrack([{ lang: 'rus', title: 'English' }]), undefined);
const media = new EventTarget();
media.audioTracks = Object.assign(new EventTarget(), { 0: tracks[0], 1: tracks[1], 2: tracks[2], length: 3 });
const cleanup = installEnglishAudioPreference(media);
assert.equal(tracks[0].enabled, false);
assert.equal(tracks[2].enabled, true);
tracks[2].enabled = false;
tracks[0].enabled = true;
media.dispatchEvent(new Event('canplay'));
assert.equal(tracks[0].enabled, true, 'Manual audio choice must survive future player events');
cleanup();
const titles = load('lib/media/playback-titles.ts');
const generic = { id: 'tt1442437', type: 'series', showName: 'Modern Family', name: 'Episode 16', episodeTitle: 'Episode 16', mediaSourceId: 'tt1442437:8:16' };
assert.equal(titles.getPlaybackTitles(generic, { videos: [{ id: generic.mediaSourceId, title: 'Basketball' }] }).primaryTitle, 'Basketball');
const { resolvePlayback } = load('lib/media/resolve-playback.ts', name => name === '@/lib/media/audio-language'
    ? language : load(name.replace('@/', '') + '.ts', () => language));
(async () => {
    const streams = [{ url: 'https://test/Russian.mp4', title: 'Russian H264 AAC' }, { url: 'https://test/English.mp4', title: 'English H264 AAC' }];
    for (const environment of ['native', 'web']) {
        const result = await resolvePlayback({ id: 'movie', type: 'movie' }, { environment, fetchStreams: async () => streams }, () => {});
        assert.equal(result.streamUrl, streams[0].url, "Ordinary Play respects add-on order; preferred audio is applied to the selected source");
    }
    const result = await resolvePlayback({ id: 'movie', type: 'movie' }, {
        environment: 'web', autoSelectWebStream: true, fetchStreams: async () => streams.map(s => ({ ...s, title: 'H264 AAC' })), canPlayType: () => true,
        verifyStream: async () => 'supported',
        inspectStream: async s => ({ video: { codec: 'h264', codecString: 'avc1.640028' }, audio: [{ codec: 'aac', codecString: 'mp4a.40.2', language: s.url.includes('Russian') ? 'rus' : 'eng', primary: true }] }),
    }, () => {});
    assert.equal(result.streamUrl, streams[1].url, 'Container audio language repairs absent release labels');
    console.log('PASS: English stream labels, subtitle exclusion, primary audio metadata, actual browser tracks, manual selection, and generic episode names.');
})().catch(error => { console.error(error); process.exitCode = 1; });
