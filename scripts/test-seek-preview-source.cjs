const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { previewFrameSize } = require('./test-support/react-hooks.cjs').load('lib/media/preview-frames.ts');
const portrait = previewFrameSize(9 / 16);
assert.equal(portrait.width / portrait.height, 9 / 16, 'Bound tall frames without distorting them');
const context = { exports: {}, require(name) {
  if (name === 'react') return {
    useState: value => [value, () => {}], useRef: value => ({ current: value }),
    useLayoutEffect() {}, useCallback: value => value,
  };
  if (name === 'react/jsx-runtime') return { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
  if (name.includes('preview-frames')) return { PreviewCache: class { get() {} }, PreviewScheduler: class {}, previewBucket: Math.round, previewFrameSize };
  return { __esModule: true, default: 'MuxVideo', PreviewImage: 'PreviewImage', PreviewLoadingIndicator: 'PreviewLoadingIndicator' };
} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/seek-preview.tsx', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText, context);
const media = { src: 'blob:https://navigator.test/main-decoder', getAttribute: () => 'blob:https://navigator.test/main-decoder', videoWidth: 1920, videoHeight: 1440 };
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
  assert.ok(view.props.children.some(node => node?.type === 'PreviewLoadingIndicator'), 'A pending first frame uses the corner indicator');
  assert.equal(view.props.style.height, 168, 'The loading preview uses the known media dimensions');
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
assert.match(player, /<PlayerControlBar\b[^>]*previewSource=\{routedStreamUrl\s*\?\?\s*streamUrl\s*\?\?\s*undefined\}/, 'The production caller passes the routed transport URL, with the original stream as fallback, to previews');
const controls = fs.readFileSync('components/player-control-bar.tsx', 'utf8');
assert.match(controls, /<MediaPlayerSeek\b[^>]*previewSource=\{previewSource\}/, 'The shared controls pass the resolved URL to the timeline');
console.log('PASS: original HLS source survives MSE blob replacement; progressive formats keep their native decoder');

const timeline = ts.createSourceFile('media-player.tsx', fs.readFileSync('components/ui/media-player.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let enter;
function findEnter(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(timeline) === 'onPointerEnter'
      && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(timeline) === 'React.useCallback') enter = node.initializer.arguments[0];
  ts.forEachChild(node, findEnter);
}
findEnter(timeline);
assert.ok(enter);
const hoverEvents = [];
const rect = { left: 100, width: 200 };
const hover = {
  seekRef: { current: { getBoundingClientRect: () => rect } }, seekRectRef: { current: null },
  collisionDataRef: {}, lastPointerXRef: {}, hoverTimeRef: {}, seekableStart: 0, seekableEnd: 120, tooltipDisabled: false,
  onPreviewUpdate: time => hoverEvents.push(['preview', time]),
  onTooltipPositionUpdate: x => hoverEvents.push(['position', x]),
  setSeekState: update => hoverEvents.push(['visible', update({ isHovering: false }).isHovering]),
};
vm.runInNewContext(ts.transpileModule(`(${enter.getText(timeline)})({ pointerType: "mouse", clientX: 150 })`, {}).outputText, hover);
assert.deepEqual(hoverEvents, [['preview', 30], ['position', 150], ['visible', true]], 'First hover activates the preview without a timer or another pointer move');

async function verifyFullscreenPreviewStyles() {
  const { compile } = require('tailwindcss');
  const { parse } = require('postcss');
  delete context.VideoDecoder;
  const fallback = context.exports.SeekPreview({ media, source: 'https://stream.test/movie.mp4', time: 20, duration: 120, active: true });
  const decoder = fallback.type(fallback.props).props.children[0];
  const playerClasses = timeline.text.split(/[\s"]+/).filter(candidate => candidate.includes('[&_video'));
  const utilities = await compile('@tailwind utilities;');
  const css = parse(utilities.build([...playerClasses, ...decoder.props.className.split(' ')]));
  const rules = css.nodes.filter(node => node.type === 'rule');
  const sets = (rule, prop, value) => rule.nodes.some(node => node.prop === prop && node.value === value);
  assert.ok(rules.some(rule => rule.selector === '.absolute' && sets(rule, 'position', 'absolute')));
  assert.ok(!rules.some(rule => rule.selector.endsWith(' video') && sets(rule, 'position', 'relative')),
    'The fullscreen portal puts the preview inside the player, where a descendant video rule would override .absolute');
  const playbackVideo = rules.filter(rule => rule.selector.endsWith(" video[data-slot='media-player-video']"));
  assert.ok(playbackVideo.some(rule => sets(rule, 'position', 'relative')));
  assert.ok(playbackVideo.some(rule => sets(rule, 'object-fit', 'contain')));
  assert.ok(playbackVideo.some(rule => sets(rule, 'height', '100%') && rule.selector.includes('[data-state="fullscreen"]')));
  console.log('PASS: fullscreen playback styles keep the preview decoder out of the thumbnail layout');
}
verifyFullscreenPreviewStyles().catch(error => { console.error(error); process.exitCode = 1; });
