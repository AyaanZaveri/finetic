const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const find = (node, predicate) => !node || typeof node !== 'object' ? [] : [
    ...(predicate(node) ? [node] : []), ...[].concat(node.props?.children ?? []).flatMap(child => find(child, predicate)),
];
const visibleText = node => Array.isArray(node) ? node.map(visibleText).join('')
    : typeof node === 'object' && node ? visibleText(node.props?.children) : String(node ?? '');
(async () => {
    const h = hooks();
    let attempts = 0, invalidations = 0, released = 0;
    let publishStreams;
    const queries = {
        acquire: () => {
            const failed = attempts++ === 0;
            return { release: () => released++, request: {
                subscribe: listener => {
                    publishStreams = (streams, pending = 0) => listener({ streams, total: 2, pending, complete: pending === 0 });
                    publishStreams([]);
                    return () => {};
                },
                promise: failed ? Promise.reject(new Error('offline')) : Promise.resolve([]),
            } };
        },
        invalidate: target => { assert.equal(target.id, 'tt123:2:2'); invalidations++; },
    };
    const { MediaActions } = load('components/media-actions.tsx', {
        react: h.react, 'react/jsx-runtime': h.jsx,
        '@/components/stream-query-provider': { useStreamQueries: () => queries },
        '@/contexts/account-context': { useAccountAccess: () => ({ authenticated: true }) },
        '@/contexts/MediaPlayerContext': { usePlaybackActions: () => ({}) },
        '@/app/actions': { fetchPlaybackProgress: async () => null },
        '@/components/ui/empty': Object.fromEntries(['Empty', 'EmptyDescription', 'EmptyHeader', 'EmptyMedia', 'EmptyTitle'].map(name => [name, name])),
        '@/components/ui/button': { Button: 'button' },
        '@/components/ui/loading-placeholder': { LoadingPlaceholder: 'loading' },
        '@/components/ui/skeleton': { Skeleton: 'skeleton' },
        '@/components/arc/search-field/search-field': { SearchField: 'search' },
        '@/components/arc/chip-group/chip-group': { ChipGroup: 'chips' },
        '@/components/stream-summary': { StreamSummary: 'summary' },
        '@/components/stream-actions-menu': { StreamActionsMenu: 'stream-actions-menu' },
        '@/components/ui/input-group': Object.fromEntries(['InputGroup', 'InputGroupAddon', 'InputGroupButton', 'InputGroupInput', 'InputGroupText'].map(name => [name, name])),
        '@/components/sign-in-for-streams': { SignInForStreams: 'sign-in' },
        '@/lib/desktop/bridge': { desktopBridge: () => null },
        './media-actions.module.css': {},
    }, { console: { error() {} } });
    const render = streamSelection => { const tree = h.render(MediaActions, { media: { id: 'tt123:2:2', type: 'series', name: 'Episode' }, streamSelection }); h.flush(); return tree; };
    render(); await tick(); let tree = render();
    assert.equal(find(tree, node => node.type === 'EmptyTitle')[0].props.children, 'Could not load streams');
    find(tree, node => node.type === 'button' && node.props.children === 'Retry')[0].props.onClick();
    render(); await tick(); tree = render();
    assert.equal(attempts, 2); assert.equal(invalidations, 1); assert.equal(released, 1);
    assert.equal(find(tree, node => node.type === 'EmptyTitle')[0].props.children, 'No streams crawled out of hiding', 'A successful empty retry must clear the previous error');
    const fileUrl = 'https://media.example.com/episode.mkv?token=signed';
    const streams = [
        { url: fileUrl, title: '4K', behaviorHints: { filename: 'Episode.mkv' } },
        { url: 'https://media.example.com/live.m3u8?token=signed' },
        { externalUrl: 'https://provider.example.com/watch' },
    ];
    publishStreams(streams);
    tree = render();
    const downloads = find(tree, node => node.type === 'stream-actions-menu' && node.props.downloadUrl);
    assert.equal(downloads.length, 1, 'Only the direct media file should be offered for download');
    assert.equal(downloads[0].props.downloadUrl, fileUrl, 'Download should use the original signed media URL');
    assert.equal(downloads[0].props.filename, 'Episode.mkv');
    assert.equal(find(tree, node => node.type === 'chips').length, 1);

    const drawer = { currentUrl: fileUrl, onSelect() {} };
    publishStreams(streams, 1);
    tree = render(drawer);
    assert.equal(find(tree, node => node.type === 'chips').length, 0);
    const endAddon = find(tree, node => node.type === 'InputGroupAddon' && node.props.align === 'inline-end')[0];
    const status = find(endAddon, node => node.props.role === 'status')[0];
    assert.match(visibleText(status), /1 add-on loading/);
    find(tree, node => node.type === 'InputGroupInput')[0].props.onChange({ target: { value: '2160p' } });
    publishStreams(streams);
    tree = render(drawer);
    assert.equal(visibleText(find(tree, node => node.props.role === 'status')[0]), '1 stream');
    find(tree, node => node.props['aria-label'] === 'Clear search')[0].props.onClick();
    assert.equal(visibleText(find(render(drawer), node => node.props.role === 'status')[0]), '3 streams');
    h.unmount();
    console.log('PASS: stream errors, retry, and direct media downloads');
})().catch(error => { console.error(error); process.exitCode = 1; });
