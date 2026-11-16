const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const find = (node, predicate) => !node || typeof node !== 'object' ? [] : [
    ...(predicate(node) ? [node] : []), ...[].concat(node.props?.children ?? []).flatMap(child => find(child, predicate)),
];
(async () => {
    const h = hooks();
    let attempts = 0, invalidations = 0, released = 0;
    const queries = {
        acquire: () => {
            const failed = attempts++ === 0;
            return { release: () => released++, request: {
                subscribe: listener => { listener({ streams: [], total: 2, pending: 0, complete: true }); return () => {}; },
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
        '@/components/sign-in-for-streams': { SignInForStreams: 'sign-in' },
        './media-actions.module.css': {},
    }, { console: { error() {} } });
    const render = () => { const tree = h.render(MediaActions, { media: { id: 'tt123:2:2', type: 'series', name: 'Episode' } }); h.flush(); return tree; };
    render(); await tick(); let tree = render();
    assert.equal(find(tree, node => node.type === 'EmptyTitle')[0].props.children, 'Could not load streams');
    find(tree, node => node.type === 'button' && node.props.children === 'Retry')[0].props.onClick();
    render(); await tick(); tree = render();
    assert.equal(attempts, 2); assert.equal(invalidations, 1); assert.equal(released, 1);
    assert.equal(find(tree, node => node.type === 'EmptyTitle')[0].props.children, 'No streams crawled out of hiding', 'A successful empty retry must clear the previous error');
    h.unmount();
    console.log('PASS: stream failures have distinct copy, Retry invalidates and reacquires, and successful empty responses clear errors');
})().catch(error => { console.error(error); process.exitCode = 1; });
