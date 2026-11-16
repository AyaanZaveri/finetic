const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
let unavailable = false;
const calls = [];
const { load } = require('./test-support/react-hooks.cjs');
const serverCache = load('lib/server/metadata-cache.ts', { 'server-only': {} }, { Buffer });
const projections = load('lib/media/metadata.ts');
const context = { exports: {}, console, AbortSignal,
    fetch: async () => ({ ok: true, json: async () => ({ meta: { videos: [{ id: 'tt1442437:8:16', name: 'Addon episode name', season: 8, episode: 16 }] } }) }),
    require(name) {
        if (name === '@/lib/server/metadata-cache') return serverCache;
        if (name === '@/lib/server/metadata-identity') return { metadataIdentity: async () => ({ scope: 'fixture', revision: unavailable ? 'fallback' : 'healthy' }) };
        if (name === '@/lib/media/metadata') return projections;
        if (name === '@/lib/series-route') return require('./test-support/react-hooks.cjs').load('lib/series-route.ts');
        if (name === "@/lib/server/outbound-fetch") return { outboundFetch: (...args) => context.fetch(...args) };
        if (name === './auth' || name === '@/lib/server/auth') return { getAuthData: async () => ({}), getInstalledAddons: async () => [{ manifest: { resources: ['meta'] }, transportUrl: 'https://addon.test/manifest.json' }] };
        if (name === '@/lib/tmdb-discovery') return { getTMDBEpisode: async (...args) => {
            calls.push(args);
            if (unavailable) throw new Error('Metadata unavailable');
            return { name: 'Basketball', thumbnail: 'still.jpg' };
        } };
        if (name === '@/lib/tmdb-artwork') return { getTMDBArtwork: async () => undefined };
        if (name === '@/lib/artwork') return { publicArtworkUrl: () => undefined };
        return {};
    },
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/actions/tv-shows.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, context);
(async () => {
    const episode = await context.exports.fetchEpisodeDetails('tt1442437', 8, 16);
    assert.equal(episode.title, 'Basketball');
    assert.equal(episode.id, 'tt1442437:8:16', 'Canonical title lookup preserves the original add-on episode identifier');
    assert.deepEqual(calls[0].slice(0, 3), ['tt1442437', 8, 16]);
    unavailable = true;
    const fallback = await context.exports.fetchEpisodeDetails('tt1442437', 8, 16);
    assert.equal(fallback.title, 'Addon episode name');
    console.log('PASS: canonical episode lookup preserves source IDs and falls back to installed add-on metadata.');
})().catch(error => { console.error(error); process.exitCode = 1; });
