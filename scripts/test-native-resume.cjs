const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { load } = require('./test-support/react-hooks.cjs');
let macHdrPeakNits = 1600;
const { MpvController } = load('lib/desktop/mpv-controller.ts', {
 '@/lib/media/playback-preferences': { readPlaybackPreferences: () => ({ audioLanguage: 'en', macHdrPeakNits }) },
}, { Event, EventTarget, CustomEvent, DOMException, URL, crypto, setTimeout, clearTimeout });
for (const platform of ['macos', 'windows', 'linux', 'android', 'ios']) {
 const sent = [];
 const controller = new MpvController({ platform, capabilities: { initialSeek: true }, send: m => sent.push(m), subscribe: () => () => {} });
 for (const [requested, expected] of [[123.4, 123.4], [0, 0], [-2, 0], [NaN, 0], [Infinity, 0]]) {
  controller.load('https://fixture.test/episode.mkv', undefined, requested);
  const request = sent.filter(m => m.type === 'load').at(-1);
  assert.equal(request.startPosition, expected, `${platform}: resume belongs to the load before the first frame`);
  assert.equal(sent.filter(m => m.session === request.session && m.type === 'seek').length, 0);
 }
 controller.dispose();
}
for (const platform of ['macos', 'windows', 'linux']) {
 const sent = [];
 const controller = new MpvController({ platform, send: m => sent.push(m), subscribe: () => () => {} });
 controller.load('https://fixture.test/episode.mkv', undefined, 123.4);
 assert.equal('startPosition' in sent.find(m => m.type === 'load'), false, 'Older runtimes reject unknown load fields; retain metadata-time resume');
 controller.dispose();
}
console.log('PASS: initial native resume, zero/reset, finite-value sanitization, and older-runtime compatibility');
for (const [platform, supported] of [['macos', true], ['macos', false], ['windows', true]]) {
 const sent = [];
 const controller = new MpvController({ platform, capabilities: { macHdrPeak: supported }, send: m => sent.push(m), subscribe: () => () => {} });
 for (const nits of [1600, null]) {
  macHdrPeakNits = nits;
  sent.length = 0;
  controller.load('https://fixture.test/movie.mkv');
  const loadIndex = sent.findIndex(message => message.type === 'load');
  if (platform === 'macos' && supported) {
   assert.equal(sent[loadIndex - 1].type, 'mac-hdr-peak');
   assert.equal(sent[loadIndex - 1].nits, nits);
  } else {
   assert.ok(!sent.some(message => message.type === 'mac-hdr-peak'));
  }
 }
 controller.dispose();
}
// Execute the real metadata handler: FILE_LOADED may arrive before time-pos
// reflects mpv's initial seek, so it must not issue a second seek for that case.
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const source = ts.createSourceFile('player.tsx', fs.readFileSync('components/global-media-player.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
 if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleVideoLoadedMetadata') handler = node.initializer.arguments[0].getText(source);
 ts.forEachChild(node, visit);
}
visit(source); assert.ok(handler);
const { safeResumePosition } = load('lib/media/resume-playback.ts');
for (const [initialSeek, type, requested, initial, expected, reported] of [
 [true, 'movie', 123.4, 0, [], 123.4],
 [false, 'movie', 123.4, 0, [123.4], 123.4],
 [true, 'movie', 500, 0, [299], 299],
 [true, 'series', 123.4, 0, [123.4], 123.4],
 [true, 'series', 299, 0, [], 0],
 [false, 'series', 500, 0, [], 0],
 [true, 'series', 300, 300, [0], 0],
]) {
 const seeks = [], reports = []; let position = initial;
 const media = { duration: 300, get currentTime() { return position; }, set currentTime(value) { position = value; seeks.push(value); }, play: () => Promise.resolve() };
 const context = { exports: {}, videoRef: { current: media }, currentMedia: { type, resumePositionTicks: requested }, safeResumePosition,
  desktopBridge: () => ({ capabilities: { initialSeek } }), setDuration() {}, currentTimeRef: { current: 0 }, setCurrentTime() {}, setCurrentTimestamp() {}, sendPlaybackUpdate: (...args) => reports.push(args) };
 vm.runInNewContext(ts.transpileModule(`exports.metadata = ${handler}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
 context.exports.metadata();
 assert.deepEqual(seeks, expected, `${type}: resume must respect the selected file duration`);
 assert.equal(reports[0][1].currentTimeSeconds, reported);
}
console.log('PASS: movie initial seek, legacy resume, and episode restart at zero for end-of-file offsets');
