const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const context = { exports: {}, require(name) {
  if (name === 'react') return {
    useState: value => [value, () => {}], useRef: value => ({ current: value }),
    useLayoutEffect() {}, useCallback: value => value,
  };
  if (name === 'react/jsx-runtime') return { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
  if (name.includes('preview-frames')) return { PreviewCache: class { get() {} }, PreviewScheduler: class {}, previewBucket: Math.round };
  return { __esModule: true, default: 'MuxVideo', PreviewImage: 'PreviewImage', Skeleton: 'Skeleton' };
} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/seek-preview.tsx', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText, context);
const media = { src: 'blob:https://navigator.test/main-decoder', getAttribute: () => 'blob:https://navigator.test/main-decoder' };
for (const [source, expected] of [
  ['https://stream.test/movie.m3u8?token=fixture', 'MuxVideo'],
  ['https://stream.test/movie.mp4', 'video'],
  ['https://stream.test/movie.mkv', 'video'],
]) {
  const child = context.exports.SeekPreview({ media, source, time: 20, duration: 120, active: true });
  assert.equal(child.props.source, source, 'The independent decoder must receive the original URL, never playback’s MediaSource blob');
  const view = child.type(child.props);
  const decoder = view.props.children[0];
  assert.equal(decoder.type, expected);
  assert.equal(decoder.props.src, source);
  assert.equal(decoder.props.preload, 'auto', 'An active preview must request decoded video data, not stop at metadata');
}
const plain = { src: 'https://stream.test/plain.webm', getAttribute: () => null };
assert.equal(context.exports.SeekPreview({ media: plain, time: 0, duration: 120, active: false }).props.source, plain.src);
const player = fs.readFileSync('components/global-media-player.tsx', 'utf8');
context.VideoDecoder = class {};
const sparse = context.exports.SeekPreview({ media, source: 'https://stream.test/large-hdr.mkv', time: 20, duration: 120, active: true });
assert.equal(sparse.type(sparse.props).props.children[0], false, 'WebCodecs previews do not mount a second full-size HTML video decoder');
context.window = { navigatorDesktop: { platform: 'windows', capabilities: { nativePreviews: true } } };
const nativeMedia = { controller: { previewSession: 'native', cachedPreview() {} } };
const manifest = context.exports.SeekPreview({ media: nativeMedia, source: 'https://stream.test/movie.m3u8', time: 20, duration: 120, active: true });
assert.equal(manifest.type(manifest.props).props.children[0].type, 'MuxVideo', 'Native keyframe previews must retain the browser decoder for HLS manifests');
assert.match(player, /<MediaPlayerSeek\b[^>]*previewSource=\{streamUrl\s*\?\?\s*undefined\}/, 'The production caller passes the resolved URL to the timeline');
console.log('PASS: original HLS source survives MSE blob replacement; progressive formats keep their native decoder');
