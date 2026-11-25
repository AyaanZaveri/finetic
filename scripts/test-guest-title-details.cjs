const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');

async function main() {
    let authenticated = false, addonReads = 0, addonFetches = 0;
    const lookups = [];
    const title = { id: 'tmdb:1423191', type: 'movie', name: 'Resident Evil', description: 'Full synopsis', poster: '/poster', background: '/backdrop', cast: ['Actor'] };
    const metadataCache = load('lib/server/metadata-cache.ts', { 'server-only': {} }, { Buffer });
    const dependencies = {
        '@/lib/server/metadata-cache': metadataCache,
        '@/lib/server/metadata-identity': { metadataIdentity: async () => ({ scope: authenticated ? 'fixture' : 'anonymous', revision: 'fixture' }) },
        '@/lib/server/auth': { getAuthData: async () => { if (!authenticated) throw new Error('Not authenticated'); return { authKey: 'fixture' }; } },
        '@/lib/server/outbound-fetch': { outboundFetch: async () => { addonFetches++; throw new Error('No guest add-on requests'); } },
        '@/lib/artwork': { publicArtworkUrl: () => undefined },
        '@/lib/server/catalog-cache': {}, '@/lib/server/media-artwork': {},
        '@/lib/tmdb-artwork': {}, '@/lib/media/playback-details': {}, '@/lib/media-description': {}, '@/lib/stremio-watched': {}, './tv-shows': {},
        './auth': { getInstalledAddons: async () => { addonReads++; return []; } },
        '@/lib/tmdb-discovery': { tmdbMediaItem: async (id, type) => { lookups.push({ id, type }); return { ...title, type }; } },
    };
    const media = load('app/actions/media.ts', dependencies, { console: { error() {}, warn() {} } });
    const encoded = await media.fetchMediaDetails('tmdb%3A1423191', 'movie');
    assert.equal(encoded?.name, 'Resident Evil', 'Next route-encoded IDs must reach public TMDB metadata');
    assert.equal(lookups[0].id, 'tmdb:1423191');
    assert.equal(addonReads, 0, 'A public TMDB title never needs installed add-ons');
    assert.equal(addonFetches, 0);
    assert.equal((await media.fetchMediaDetails('tmdb:1423191', 'movie')).description, 'Full synopsis');
    assert.equal(await media.fetchMediaDetails('tmdb%3A1423191', 'movie', undefined, { playback: true }), null, 'Playback metadata stays authenticated');

    const series = load('app/actions/tv-shows.ts', {
        ...dependencies,
        '@/lib/tmdb-discovery': {
            ...dependencies['@/lib/tmdb-discovery'],
            getTMDBSeasons: async id => { assert.equal(id, 'tmdb:20'); return [{ number: 1, episodeCount: 2 }]; },
            getTMDBEpisodes: async id => { assert.equal(id, 'tmdb:20'); return [{ id: 'tmdb:20:1:1', title: 'Pilot', season: 1, episode: 1 }]; },
            getTMDBEpisode: async id => { assert.equal(id, 'tmdb:20'); return { name: 'Pilot' }; },
        },
    }, { console: { error() {} } });
    assert.equal((await series.fetchTVShowDetails('tmdb%3A20')).type, 'series');
    assert.equal((await series.fetchSeasons('tmdb%3A20'))[0].episodeCount, 2);
    assert.equal((await series.fetchEpisodes('tmdb%3A20', 1))[0].title, 'Pilot');
    assert.equal((await series.fetchEpisodeDetails('tmdb%3A20', 1, 1)).title, 'Pilot');
    assert.equal(addonReads, 0);

    const h = hooks();
    let personalReads = 0;
    const ui = load('components/media-actions.tsx', {
        react: h.react, 'react/jsx-runtime': h.jsx,
        '@/contexts/account-context': { useAccountAccess: () => ({ authenticated: false }) },
        '@/components/ui/button': { Button: 'button' },
        '@/components/sign-in-for-streams': { SignInForStreams: 'sign-in-for-streams' },
        '@/contexts/MediaPlayerContext': { usePlaybackActions: () => ({}) },
        '@/components/playback-page-provider': { usePlaybackPage: () => null },
        '@/app/actions': { fetchPlaybackProgress: async () => { personalReads++; } },
        '@/lib/media/fetch-playback-streams': { createPlaybackStreamRequest: () => { personalReads++; throw Error('Guest stream lookup'); } },
        '@/lib/media/playback-context': {}, '@/lib/media/playback-details': {},
        '@/components/ui/empty': {}, '@/components/ui/loading-placeholder': {}, '@/components/ui/skeleton': {},
        '@/components/motion-primitives/activity-text-shimmer': { ActivityTextShimmer: 'shimmer' },
        'lucide-react': {}, '@/components/arc/search-field/search-field': {}, '@/components/arc/chip-group/chip-group': {},
        './media-actions.module.css': {}, '@/components/stream-summary': {},
    });
    assert.equal(h.render(ui.MediaActions, { media: title }).type, 'sign-in-for-streams');
    h.flush();
    assert.equal(personalReads, 0, 'The guest prompt replaces streams and never loads private progress');
    h.unmount();
    const promptHooks = hooks();
    let opened = 0;
    const prompt = load('components/sign-in-for-streams.tsx', {
        react: promptHooks.react, 'react/jsx-runtime': promptHooks.jsx, 'lucide-react': {},
        '@/contexts/account-context': { useAccountAccess: () => ({ requestSignIn: () => opened++ }) },
        '@/components/ui/button': { Button: 'button' },
        '@/components/ui/empty': Object.fromEntries(['Empty', 'EmptyDescription', 'EmptyHeader', 'EmptyTitle'].map(name => [name, name])),
    });
    const tree = promptHooks.render(prompt.SignInForStreams);
    tree.props.children[1].props.onClick();
    assert.equal(opened, 1, 'The stream prompt opens the existing sign-in dialog on the current title');

    let addonFailure = new Error('Not authenticated'), addonErrors = 0;
    const authActions = load('app/actions/auth.ts', {
        'next/headers': {}, 'next/navigation': {}, '@/lib/cookie-policy': {}, '@/lib/server/session': {},
        '@/lib/server/auth': { getAuthData: async () => { throw addonFailure; } },
    }, { Error, console: { error: () => addonErrors++ } });
    assert.equal((await authActions.getInstalledAddons()).length, 0);
    assert.equal(addonErrors, 0, 'Guest recommendations must not log a normal signed-out state as an application error');
    addonFailure = new Error('Unexpected account lookup failure');
    await authActions.getInstalledAddons();
    assert.equal(addonErrors, 1, 'Unexpected add-on failures are still reported');
    console.log('PASS: encoded guest movie/show/episode IDs load complete metadata, stream areas open sign-in without private reads, and playback metadata stays protected.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
