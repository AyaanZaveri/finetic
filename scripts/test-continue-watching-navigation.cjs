const assert = require('node:assert/strict');
const { QueryClient, timeoutManager } = require('@tanstack/react-query');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
timeoutManager.setTimeoutProvider({
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout,
    setInterval: (fn, ms) => { const timer = setInterval(fn, ms); timer.unref(); return timer; }, clearInterval,
});
const { createStreamQueries } = load('lib/media/stream-queries.ts', {}, { URLSearchParams, TextEncoder, DOMException });
const { createContinueWatchingWarmup } = load('lib/media/continue-watching-warmup.ts');

async function navigate(emptyProvider) {
    const requests = [];
    const queries = createStreamQueries('navigation-session', new QueryClient(), async url => {
        requests.push(url);
        if (url.startsWith('/api/streams/addons')) return Response.json({ revision: 'fixture', addons: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
        const addon = new URL(url, 'https://app.test').searchParams.get('addonId');
        return Response.json({ streams: emptyProvider === 'all' || addon === 'b' && emptyProvider ? [] : [{ url: `https://video.test/${addon}` }] });
    });
    const owner = createContinueWatchingWarmup(queries.speculate, () => Date.now(), true);
    const resume = { id: 'ttshow', type: 'series', mediaSourceId: 'ttshow:1:2', seasonNumber: 1, episodeNumber: 2 };
    const show = { id: resume.id, type: 'series', name: 'The Rookie', videos: [{ id: resume.mediaSourceId, season: 1, episode: 2, title: 'Episode two' }] };
    const pageHost = hooks(), routeHost = hooks();
    try {
        owner.warm(resume, true);
        await tick(); await tick();
        const directPlay = owner.claim(resume);
        await directPlay.promise;
        const before = requests.filter(url => url.startsWith('/api/streams/addon?')).length;
        assert.equal(before, 2, 'Continue Watching discovers each provider once');
        owner.dispose(); await tick();

        // Use the real route-aware episode projection and the real page effect,
        // rather than manufacturing a matching store key at the test boundary.
        const { EpisodeStreamsRouteAware } = load('components/episode-streams-route-aware.tsx', {
            react: routeHost.react, 'react/jsx-runtime': routeHost.jsx,
            'next/navigation': { useParams: () => ({ season: '1', episode: '2' }) },
            '@/components/media-actions': { MediaActions: 'media-actions' },
            '@/components/ui/button': { Button: 'button' },
            '@/contexts/account-context': { useAccountAccess: () => ({ authenticated: true }) },
        });
        const page = routeHost.render(EpisodeStreamsRouteAware, { show, prefetchedVideos: show.videos }); routeHost.flush();
        const { MediaActions } = load('components/media-actions.tsx', {
            react: pageHost.react, 'react/jsx-runtime': pageHost.jsx,
            '@/components/stream-query-provider': { useStreamQueries: () => queries },
            '@/contexts/account-context': { useAccountAccess: () => ({ authenticated: true }) },
            '@/contexts/MediaPlayerContext': { usePlaybackActions: () => ({}) },
            '@/app/actions': { fetchPlaybackProgress: async () => null },
            '@/components/ui/empty': Object.fromEntries(['Empty', 'EmptyDescription', 'EmptyHeader', 'EmptyMedia', 'EmptyTitle'].map(key => [key, key])),
            '@/components/ui/loading-placeholder': { LoadingPlaceholder: 'placeholder' },
            '@/components/motion-primitives/activity-text-shimmer': { ActivityTextShimmer: 'shimmer' },
            '@/components/ui/skeleton': { Skeleton: 'skeleton' },
            '@/components/arc/search-field/search-field': { SearchField: 'search' },
            '@/components/arc/chip-group/chip-group': { ChipGroup: 'chips' },
            './media-actions.module.css': {},
            '@/components/stream-summary': { StreamSummary: 'summary' },
            '@/components/stream-actions-menu': { StreamActionsMenu: 'stream-actions-menu' },
            '@/components/ui/button': { Button: 'button' },
            '@/components/sign-in-for-streams': { SignInForStreams: 'sign-in' },
        });
        pageHost.render(MediaActions, page.props.children.props); pageHost.flush();
        await tick(); await tick();
        const after = requests.filter(url => url.startsWith('/api/streams/addon?')).length;
        assert.equal(after, before, `Opening the same episode must not refetch fresh ${emptyProvider ? 'empty' : 'nonempty'} provider results`);
    } finally { routeHost.unmount(); pageHost.unmount(); owner.dispose(); queries.clear(); }
}
(async () => {
    await navigate(false);
    await navigate(true);
    await navigate('all');
    console.log('PASS: actual Continue Watching → route-aware episode page → MediaActions flow reuses fresh nonempty and empty stream results');
})().catch(error => { console.error(error); process.exitCode = 1; });
