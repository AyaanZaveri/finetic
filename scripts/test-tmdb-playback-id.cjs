const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
let authenticated = true;
const { GET } = load('app/api/playback/id/route.ts', {
    '@/app/actions/auth': { getAuthData: async () => { if (!authenticated) throw Error('unauthorized'); } }, "@/lib/server/auth": { getAuthData: async () => { if (!authenticated) throw Error('unauthorized'); } },
    '@/lib/tmdb-discovery': { resolveTMDBPlaybackId: async (id, type) => { assert.equal(id, 'tmdb:123'); assert.equal(type, 'movie'); return 'tt123'; } },
}, { Error, URL, Response });
function utility(file) {
    const context = { exports: {}, require: name => utility(name.replace('@/', '') + '.ts') };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, context);
    return context.exports;
}
(async () => {
    assert.equal((await GET(new Request('http://app/api/playback/id?id=bad&type=movie'))).status, 400);
    authenticated = false;
    assert.equal((await GET(new Request('http://app/api/playback/id?id=tmdb:123&type=movie'))).status, 401);
    authenticated = true;
    assert.equal((await (await GET(new Request('http://app/api/playback/id?id=tmdb:123&type=movie'))).json()).id, 'tt123');
    const addonCalls = [];
    const streamRoute = load('app/api/streams/addon/route.ts', {
        '@/lib/server/outbound-fetch': { outboundFetch: 'fixture-fetch' },
        'next/server': { NextResponse: Response },
        '@/app/actions/auth': { getInstalledAddons: async () => [{ manifest: { id: 'test-addon', resources: ['stream'] }, transportUrl: 'https://addon.test/manifest.json' }] },
        '@/lib/tmdb-discovery': { resolveAddonMediaId: async id => { assert.equal(id, 'tmdb:123:8:16'); return 'tt123:8:16'; } },
    }, { URL, Response, fetch: async url => { addonCalls.push(url); return Response.json({ streams: [] }); } });
    assert.equal((await streamRoute.GET(new Request('http://app/api/streams/addon?mediaItemId=tmdb:123:8:16&type=series&addonId=test-addon'))).status, 200);
    assert.deepEqual(addonCalls, ['https://addon.test/stream/series/tt123:8:16.json'], 'Manual stream listings translate selected TMDB episode IDs too');
    const { resolvePlayback } = utility('lib/media/resolve-playback.ts');
    for (const manual of [false, true]) for (const type of ['movie', 'series']) {
        const seen = [];
        const media = await resolvePlayback({ id: 'tmdb:123', type, name: 'Example', ...(manual ? { streamUrl: 'https://video.test/manual.mp4' } : {}),
            ...(type === 'series' ? { seriesId: 'tmdb:123', mediaSourceId: 'tmdb:123:8:16', seasonNumber: 8, episodeNumber: 16 } : {}),
        }, { resolveId: async () => 'tt123', fetchStreams: async id => { seen.push(id); return [{ url: 'https://video.test/movie.mp4' }]; } }, () => {});
        assert.deepEqual(seen, manual ? [] : [type === 'movie' ? 'tt123' : 'tt123:8:16']);
        assert.equal(media.id, 'tt123', 'Progress uses the canonical title ID');
        if (type === 'series') assert.equal(media.mediaSourceId, 'tt123:8:16', 'Subtitles use the selected canonical episode');
    }
    console.log('PASS: authenticated selected-title ID mapping and canonical movie/episode playback IDs without search-result enrichment.');
})().catch(error => { console.error(error); process.exitCode = 1; });
