const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');

async function main() {
    const globals = { URL, AbortSignal, Response, Error, process };
    const transport = load('lib/server/outbound-fetch.ts', {
        'server-only': {}, 'ipaddr.js': require('ipaddr.js'),
    }, globals);
    const manifest = {
        id: 'example.addon', name: 'Example addon', version: '1.0.0', description: 'Test addon',
        resources: ['stream', { name: 'meta', types: ['movie'] }], types: ['movie'], catalogs: [],
    };
    let payload = manifest;
    let failFetch = false;
    let requests = 0;
    const installer = load('lib/addon-install.ts', {
        'server-only': {}, zod: require('zod'),
        '@/lib/server/outbound-fetch': {
            outboundUrl: transport.outboundUrl,
            outboundFetch: async (url, _init, policy) => {
                requests++;
                assert.equal(url, 'https://example.com/config/manifest.json?option=1');
                assert.equal(policy.maxBytes, 512 * 1024);
                assert.equal(policy.timeoutMs, 15_000);
                if (failFetch) throw new Error('private transport details');
                return Response.json(payload);
            },
        },
    }, globals);
    const link = 'https://example.com/config/manifest.json?option=1';
    assert.equal(installer.addonInstallUrl('  stremio://example.com/config/manifest.json?option=1  '), link);
    for (const invalid of [null, '', 'https://example.com/configure', 'javascript:alert(1)',
        'http://127.0.0.1/manifest.json', 'http://169.254.169.254/manifest.json',
        'https://user:secret@example.com/manifest.json', 'http://localhost/manifest.json']) {
        assert.throws(() => installer.addonInstallUrl(invalid));
    }
    assert.equal(requests, 0, 'Invalid destinations never reach the network');
    const addon = await installer.loadAddonForInstall(link);
    assert.equal(addon.transportName, 'http');
    assert.equal(addon.transportUrl, link);
    assert.equal(addon.manifest.id, manifest.id);
    assert.deepEqual(Object.keys(addon.flags), [], 'Addons cannot set protected/official account flags');
    payload = { ...manifest, resources: [null] };
    await assert.rejects(installer.loadAddonForInstall(link), /valid add-on manifest/);
    payload = { ...manifest, behaviorHints: { configurationRequired: 'yes' } };
    await assert.rejects(installer.loadAddonForInstall(link), /valid add-on manifest/);
    payload = { ...manifest, behaviorHints: { configurationRequired: true } };
    assert.equal((await installer.loadAddonForInstall(link)).manifest.behaviorHints.configurationRequired, true);
    failFetch = true;
    await assert.rejects(installer.loadAddonForInstall(link), /Couldn’t load this add-on/);

    let authenticated = true;
    let required = false;
    let writes = 0;
    let invalidations = 0;
    let installed = [];
    const actions = load('app/actions/addons.ts', {
        'next/cache': { revalidatePath() {} },
        '@/lib/server/auth': { getAuthData: async () => {
            if (!authenticated) throw new Error('Not authenticated');
            return { authKey: 'fixture-key' };
        } },
        '@/app/actions/auth': { invalidateAddonCollection: async () => { invalidations++; } },
        '@/lib/addon-management': {
            addonLinks: () => ({ configureUrl: 'https://example.com/configure' }),
            readAddonCollection: async () => installed,
            addInstalledAddon: async () => { writes++; },
        },
        '@/lib/addon-install': { loadAddonForInstall: async () => ({ ...addon, manifest: {
            ...addon.manifest, behaviorHints: { configurationRequired: required },
        } }) },
        '@/lib/addons': { toAddonListItem: value => ({ id: `${value.manifest.id}:0`, name: value.manifest.name }) },
    }, globals);
    authenticated = false;
    assert.match((await actions.previewAddon(link)).error, /Not authenticated/);
    assert.match((await actions.installAddon(link, 'example.addon:0')).error, /Not authenticated/);
    assert.equal(writes, 0);
    authenticated = true;
    installed = [addon];
    assert.match((await actions.previewAddon(link)).error, /already installed/);
    installed = [];
    required = true;
    assert.equal((await actions.previewAddon(link)).configurationRequired, true);
    assert.match((await actions.installAddon(link, 'example.addon:0')).error, /Configure/);
    required = false;
    assert.match((await actions.installAddon(link, 'different:0')).error, /changed/);
    assert.equal(writes, 0, 'Unreviewed or unconfigured addons never write');
    assert.equal((await actions.installAddon(link, 'example.addon:0')).error, null);
    assert.equal(writes, 1);
    assert.equal(invalidations, 1);
    console.log('PASS: addon link validation, manifest validation, bounded fetch, authentication, configuration, and install actions');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
