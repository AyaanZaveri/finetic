const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, globals = {}) {
    const context = { exports: {}, ...globals };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, context);
    return context.exports;
}

const routes = load('lib/series-route.ts');
const helpers = load('lib/media/resume-playback.ts', { require: () => routes });
const { resumePlaybackTarget, formatResumePosition } = helpers;
const media = { id: 'show', seriesId: 'show', type: 'series', name: 'Episode 3', showName: 'Show',
    mediaSourceId: 'show:1:3', seasonNumber: 1, episodeNumber: 3 };
const progress = { videoId: 'show:1:3', resumePositionTicks: 754, totalDuration: 1800 };
assert.equal(formatResumePosition(754), '12:34');
assert.equal(formatResumePosition(3754), '1:02:34');
assert.equal(resumePlaybackTarget(media, progress).resumePositionTicks, 754);
assert.equal(resumePlaybackTarget(media, { ...progress, videoId: 'show:1:2' }).resumePositionTicks, undefined,
    'Another episode’s progress must never become this episode’s resume position');
for (const position of [0, -1, NaN, Infinity, 1799, 1800, 1801]) {
    assert.equal(resumePlaybackTarget(media, { ...progress, resumePositionTicks: position }).resumePositionTicks, undefined);
}
assert.equal(resumePlaybackTarget(media, { ...progress, resumePositionTicks: 1790 }).resumePositionTicks, 1790);
const overview = { id: 'show', type: 'series', name: 'Show' };
const resumed = resumePlaybackTarget(overview, progress);
assert.equal(resumed.mediaSourceId, 'show:1:3');
assert.equal(resumed.seasonNumber, 1);
assert.equal(resumed.episodeNumber, 3);
assert.equal(resumePlaybackTarget(overview, { ...progress, videoId: 'other:1:3' }).resumePositionTicks, undefined);
assert.equal(resumePlaybackTarget(overview, { ...progress, videoId: 'show:0:1' }).resumePositionTicks, undefined,
    'Show-level playback continues to ignore specials');
const opaque = resumePlaybackTarget(overview, { ...progress, videoId: 'opaque-source' }, [
    { id: 'opaque-source', season: 2, episode: 12, title: 'Known episode' },
]);
assert.equal(opaque.episodeTitle, 'Known episode');
assert.equal(opaque.episodeNumber, 12);

let saved;
const played = [];
const { MediaPlayButton } = load('components/media-page/play-button.tsx', {
    require: name => {
        if (name === 'react') return { useState: () => [saved, () => {}], useEffect() {} };
        if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
        if (name === '@/lib/media/resume-playback') return helpers;
        if (name === '@/contexts/MediaPlayerContext') return { usePlaybackActions: () => ({ playMedia: target => played.push(target) }) };
        if (name === '@/contexts/account-context') return { useAccountAccess: () => ({ authenticated: true }) };
        if (name === '@/components/metadata-preload') return { useMetadataIntent: () => ({}) };
        if (name === '@/components/ui/button') return { Button: 'button' };
        return new Proxy({}, { get: (_, key) => key });
    },
});
function render(target, state = progress) {
    saved = { key: `${target.type}:${target.seriesId || target.id}:${target.mediaSourceId || 'overview'}`, progress: state };
    return MediaPlayButton({ media: target });
}
const episodeTree = render(media);
const [resumeButton, tooltip] = episodeTree.props.children;
const label = resumeButton.props.children[1];
assert.equal(label.type, 'span');
assert.equal(label.props.children[0], 'Resume');
assert.equal(label.props.children[1].props.children[0], ' ', 'Use a natural inline space');
const detail = label.props.children[1].props.children[1];
assert.equal(detail.props.children, 'from 12:34');
assert.ok(detail.props.className.includes('text-background/60'), 'From and timestamp are muted');
resumeButton.props.onClick();
assert.equal(played.at(-1).resumePositionTicks, 754);
assert.equal(tooltip.props.delayDuration, 600);
const restart = tooltip.props.children[0].props.children;
assert.equal(restart.props.variant, 'media-secondary');
assert.equal(restart.props.size, 'icon-lg');
assert.ok(restart.props.className.includes('rounded-full'));
assert.equal(restart.props['aria-label'], 'Play from start');
restart.props.onClick();
assert.equal(played.at(-1).resumePositionTicks, 0);
assert.equal(played.at(-1).mediaSourceId, media.mediaSourceId, 'Restart targets the selected episode');
const showTree = render(overview);
const showButton = showTree.props.children[0];
assert.equal(showButton.props.children[1].props.children[0], 'Resume');
assert.equal(showButton.props.children[1].props.children[1].props.children[1].props.children, 'S01E03');
showButton.props.onClick();
assert.equal(played.at(-1).mediaSourceId, progress.videoId, 'Show overview resumes the saved episode');
showTree.props.children[1].props.children[0].props.children.props.onClick();
assert.equal(played.at(-1).mediaSourceId, progress.videoId, 'Overview restart plays the resume episode from zero');
assert.equal(played.at(-1).resumePositionTicks, 0);
const unwatched = render(media, null);
assert.equal(unwatched.props.children[0].props.children[1].props.children[0], 'Play');
assert.equal(unwatched.props.children[1], false, 'No redundant restart button without progress');
saved = null;
assert.equal(MediaPlayButton({ media }).props.children[0].props.disabled, true, 'Wait for current episode progress before playing');
console.log('PASS: selected-episode resume, show episode labels, muted detail, delayed restart tooltip, fresh playback targets, and progress isolation.');
