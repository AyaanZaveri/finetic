const assert = require('node:assert/strict');
const React = require('react');
const { load, hooks } = require('./test-support/react-hooks.cjs');

function all(node) {
    if (!node || typeof node !== 'object') return [];
    return [node, ...[node.props?.children].flat(Infinity).flatMap(all)];
}

async function main() {
    let personalToken, sharedToken = 'private-shared-token', desktop = '0', credentialSignedIn = false;
    const env = { get TMDB_API_READ_ACCESS_TOKEN() { return sharedToken; }, get NAVIGATOR_DESKTOP() { return desktop; } };
    const credentials = load('lib/tmdb-credentials.ts', {
        'server-only': {}, 'next/headers': { cookies: async () => ({ get: () => personalToken ? { value: personalToken } : undefined }) },
        '@/lib/server/auth': { getAuthData: async () => { if (!credentialSignedIn) throw new Error('Not authenticated'); return {}; } },
    }, { process: { env } });
    assert.equal(await credentials.getTMDBToken(), sharedToken, 'Guests can use the hosted token without a Stremio session');
    personalToken = 'expired-personal-token';
    assert.equal(await credentials.getTMDBToken(), sharedToken, 'A stale personal cookie must not break shared guest discovery');
    credentialSignedIn = true;
    assert.equal(await credentials.getTMDBToken(), personalToken, 'Signed-in personal credentials retain precedence');
    desktop = '1'; personalToken = undefined;
    assert.equal(await credentials.getTMDBToken(), undefined, 'Desktop never picks up the hosted environment token');

    const requests = [];
    let fail = false, partial = false;
    const discovery = load('lib/tmdb-discovery.ts', {
        'server-only': {}, '@/lib/tmdb-credentials': { getTMDBToken: async () => sharedToken },
    }, { process: { env: { TMDB_WATCH_REGION: 'ca' } }, URLSearchParams, Number, Error,
        fetch: async (input, init) => {
            const url = new URL(input);
            requests.push(url);
            assert.equal(init.headers.Authorization, 'Bearer private-shared-token');
            assert.ok(!url.href.includes(sharedToken));
            const series = url.pathname.includes('/tv');
            if (fail || (partial && series)) return new Response(null, { status: 503 });
            return Response.json({ results: [
                { id: 12, title: 'Example', name: 'Example TV', adult: false, poster_path: '/poster.jpg' },
                { id: 13, title: 'Adult', adult: true }, { id: -1, title: 'Invalid' },
            ] });
        },
    });
    const result = await discovery.getTMDBHomeSections();
    assert.equal(result.region, 'CA');
    assert.equal(result.sections.length, 6);
    assert.ok(result.sections.every(section => section.mediaItems.length === 1));
    assert.equal(result.sections[1].mediaItems[0].type, 'series');
    assert.equal(result.sections[0].mediaItems[0].id, 'tmdb:12');
    assert.ok(!JSON.stringify(result).includes(sharedToken));
    for (const url of requests.filter(url => url.pathname.includes('/discover/'))) {
        assert.equal(url.searchParams.get('with_watch_providers'), '8');
        assert.equal(url.searchParams.get('watch_region'), 'CA');
        assert.equal(url.searchParams.get('sort_by'), 'popularity.desc');
        assert.equal(url.searchParams.get('include_adult'), 'false');
    }
    partial = true;
    assert.equal((await discovery.getTMDBHomeSections()).sections.length, 3, 'A failed feed does not hide successful feeds');
    fail = true;
    await assert.rejects(discovery.getTMDBHomeSections(), /unavailable/);
    fail = false; partial = false; requests.length = 0;
    const { GET: retryFeed } = load('app/api/discovery/home/route.ts', {
        '@/lib/tmdb-discovery': discovery,
    }, { URL, Response });
    assert.equal((await retryFeed(new Request('https://app.test/api/discovery/home?feed=unknown'))).status, 404);
    assert.equal(requests.length, 0, 'Unknown feed IDs never start upstream requests');
    const retried = await retryFeed(new Request('https://app.test/api/discovery/home?feed=tmdb-trending-movies'));
    assert.equal(retried.status, 200); assert.equal(requests.length, 1, 'Retry fetches only the failed feed');
    assert.equal((await retried.json()).status, 'ready');

    let signedIn = false, resumeCalls = 0, addonCalls = 0;
    const components = Object.fromEntries([
        ['@/app/components/auth-error-handler', 'AuthErrorHandler'],
        ['@/components/home-catalog-sections-lazy', 'HomeCatalogSectionsLazy'],
        ['@/components/home-continue-watching', 'ContinueWatchingSection'],
        ['@/components/media-section', 'MediaSection'], ['@/components/ui/loading-placeholder', 'LoadingPlaceholder'],
        ['@/components/ui/skeleton', 'Skeleton'], ['@/components/home-gradient-background', 'HomeGradientBackground'],
        ['@/components/ui/button', 'Button'],
    ].map(([path, name]) => [path, { [name]: name }]));
    const { default: Home } = load('app/(main)/page.tsx', {
        ...components, react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
        '@/components/ui/empty': Object.fromEntries(['Empty', 'EmptyHeader', 'EmptyDescription', 'EmptyTitle'].map(name => [name, name])),
        '@/components/home-palette-provider': { HomeInitialPalette: 'palette', HomePaletteProvider: 'palette-provider' },
        '@/app/actions/auth': {
            getUser: async () => signedIn ? { _id: 'account' } : null,
            getInstalledAddons: async () => { addonCalls++; return []; },
        },
        '@/app/actions/media': { fetchResumeItems: async () => { resumeCalls++; return []; } },
        '@/lib/tmdb-discovery': { getTMDBHomeRows: () => ({ region: result.region, rows: result.sections.map(section => ({ key: section.key, sectionName: section.sectionName, result: Promise.resolve({ status: 'ready', section }) })) }) },
    }, { URLSearchParams });
    const guest = await Home();
    assert.equal(resumeCalls, 0); assert.equal(addonCalls, 0);
    assert.ok(!all(guest).some(node => node.type === 'ContinueWatchingSection'));
    const publicSections = all(guest).find(node => node.type?.name === 'DiscoverySections');
    assert.ok(publicSections);
    assert.ok(all(await publicSections.type()).some(node => node.type === 'HomeCatalogSectionsLazy'));
    signedIn = true;
    const account = await Home();
    assert.equal(resumeCalls, 0, 'Home does not block on the client-cached resume request'); assert.equal(addonCalls, 1);
    assert.ok(all(account).some(node => node.type === 'ContinueWatchingSection'));

    const h = hooks();
    let authenticated = false, signIns = 0;
    const commands = [];
    const actions = load('contexts/MediaPlayerContext.tsx', {
        react: h.react,
        jotai: { useSetAtom: atom => value => commands.push([atom, value]) },
        '@/lib/atoms': { playMediaAtom: 'play', isPlayerVisibleAtom: 'visible' },
        '@/contexts/account-context': { useAccountAccess: () => ({ authenticated, requestSignIn: () => signIns++ }) },
    });
    let controls = h.render(actions.usePlaybackActions);
    controls.playMedia({ id: 'tmdb:12', type: 'movie' }); controls.setIsPlayerVisible(true);
    assert.equal(commands.length, 0, 'Guest playback never opens a player or begins a stream request');
    assert.equal(signIns, 2);
    authenticated = true;
    controls = h.render(actions.usePlaybackActions);
    controls.playMedia({ id: 'tmdb:12', type: 'movie' });
    assert.equal(commands[0][0], 'play');

    const historyHooks = hooks();
    let historyCalls = 0;
    const history = load('contexts/watch-history-context.tsx', {
        react: historyHooks.react, 'react/jsx-runtime': historyHooks.jsx,
        '@/app/actions/watch-history': { fetchWatchedItems: async () => { historyCalls++; return {}; } },
    }, { window: new EventTarget() });
    const provider = historyHooks.render(history.WatchHistoryProvider, { enabled: false, children: null });
    provider.props.value.subscribe({ id: 'tmdb:12', type: 'movie' });
    historyHooks.flush();
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(historyCalls, 0, 'Guest poster cards never load personal watch history');
    historyHooks.unmount();

    const publicDependencies = {
        '@/lib/server/auth': { getAuthData: async () => { throw new Error('Not authenticated'); } },
        '@/lib/tmdb-discovery': {
            searchTMDBMedia: async () => ({ results: result.sections[0].mediaItems }),
            getTMDBEpisodes: async () => [{ id: 'tmdb:12:1:1', title: 'Pilot', season: 1, episode: 1 }],
        },
        '@/lib/tmdb-artwork': { getTMDBArtwork: async () => 'https://image.tmdb.org/t/p/w500/poster.jpg' },
        'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
        '@/app/actions/media': { fetchCatalogItems: async () => { throw new Error('Guest add-on access is forbidden'); } },
    };
    const routeGlobals = { URL, URLSearchParams, Request, Response };
    const suggestions = load('app/api/search/suggestions/route.ts', publicDependencies, routeGlobals);
    assert.equal((await suggestions.GET(new Request('https://navigator.example/api/search/suggestions?q=example'))).status, 200);
    const episodes = load('app/api/series/episodes/route.ts', publicDependencies, routeGlobals);
    assert.equal((await episodes.GET(new Request('https://navigator.example/api/series/episodes?id=tmdb:12&season=1'))).status, 200);
    const catalogs = load('app/api/home/catalogs/route.ts', publicDependencies, routeGlobals);
    assert.equal((await catalogs.POST(new Request('https://navigator.example/api/home/catalogs', { method: 'POST' }))).status, 401);

    console.log('PASS: guest home skips personal data, hosted/personal TMDB credentials remain server-only, six regional feeds tolerate partial failures, TMDB read routes are public, and playback/watch-history/add-on catalogs are gated.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
