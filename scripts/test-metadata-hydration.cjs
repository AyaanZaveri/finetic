const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');
const { QueryClient, hydrate } = require('@tanstack/react-query');
const schema = load('lib/media/metadata.ts');
const revision = 'd'.repeat(64), at = Date.now() - 100_000;
(async () => {
    const module = load('components/metadata-hydration.tsx', {
        '@/components/playback-page-provider': {},
        'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
        '@/lib/server/metadata-identity': { metadataIdentity: async () => ({ scope: 'account:session', revision }) },
        '@/lib/server/metadata-cache': { serverMetadataCache: { fetchedAt: () => at } },
    });
    const view = await module.MetadataHydration({ media: { id: 'tmdb:42', imdbId: 'tt123', type: 'series', name: 'Show',
        logo: '/logo.png', addonTransportUrl: 'https://addon.test/PRIVATE', videos: [{ id: 'private-season' }] },
        episode: { id: 'tt123:1:3', season: 1, episode: 3, title: 'A real episode', released: '2020-01-01' }, children: null });
    const state = view.props.state;
    assert.ok(state.queries.every(query => query.queryKey[0] === 'metadata'));
    assert.ok(!JSON.stringify(state).includes('PRIVATE')); assert.ok(!JSON.stringify(state).includes('private-season'));
    const record = state.queries.find(query => query.queryKey[3] === 'title');
    assert.equal(record.state.dataUpdatedAt, at); assert.equal(record.state.data.fetchedAt, at);
    assert.equal(record.queryKey[5], 'tt123', 'Server pages seed the same canonical title identity');
    const client = new QueryClient(); hydrate(client, state);
    const newer = schema.titleEnvelope({ id: 'tt123', type: 'series', name: 'Newer' }, Date.now());
    const key = record.queryKey; client.setQueryData(key, newer);
    hydrate(client, state); assert.equal(client.getQueryData(key).data.name, 'Newer'); client.clear();

    let signedIn = false, reads = 0, token = 'private-token', mdbKey, addons = [{ transportUrl: 'https://addon.test/secret', manifest: { id: 'one' } }];
    const identity = load('lib/server/metadata-identity.ts', {
        'server-only': {}, react: { cache: callback => callback },
        './auth': { getAuthData: async () => { if (!signedIn) throw Error('guest'); return { user: { _id: 'user' }, issuedAt: 1 }; } },
        '@/app/actions/auth': { getInstalledAddons: async () => { reads++; return addons; } },
        '@/lib/tmdb-credentials': { getTMDBToken: async () => token },
        '@/lib/mdblist-credentials': { getMDBListKey: async () => mdbKey },
        './metadata-cache': load('lib/server/metadata-cache.ts', { 'server-only': {} }, { Buffer }),
    });
    const guest = await identity.metadataIdentity(); assert.equal(reads, 0, 'Guest cache identity does not read installed add-ons');
    signedIn = true; const first = await identity.metadataIdentity(); assert.notEqual(first.revision, guest.revision);
    token = 'replacement-token'; const second = await identity.metadataIdentity(); assert.notEqual(first.revision, second.revision);
    mdbKey = 'private-mdblist-key'; const withRatings = await identity.metadataIdentity();
    assert.notEqual(second.revision, withRatings.revision, 'Changing the MDBList key invalidates title metadata');
    assert.ok(!JSON.stringify(withRatings).includes(mdbKey));
    addons = [...addons, { transportUrl: 'https://other.test/config', manifest: { id: 'two' } }];
    const third = await identity.metadataIdentity(); addons.reverse(); assert.notEqual(third.revision, (await identity.metadataIdentity()).revision);
    assert.ok(!JSON.stringify(first).includes('private-token')); assert.ok(!JSON.stringify(first).includes('secret'));
    console.log('Metadata-only hydration, original timestamps, canonical seeds, newer browser data, guest isolation and opaque configuration revisions passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
