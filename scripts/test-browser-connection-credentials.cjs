const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');

async function main() {
    const store = new Map(), jar = new Map(), writes = [];
    const localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
    const window = new EventTarget();
    const globals = { localStorage, window, Event };
    const browser = load('lib/browser-connection-credentials.ts', {}, globals);
    const env = { NODE_ENV: 'production', NAVIGATOR_DESKTOP: '1', HOSTNAME: '127.0.0.1', TMDB_API_READ_ACCESS_TOKEN: 'never-export-tmdb', TINYFISH_API_KEY: 'never-export-tinyfish', MDBLIST_API_KEY: 'never-export-mdblist' };
    const policy = load('lib/cookie-policy.ts', {}, { process: { env } });
    const cookieStore = {
        get: name => jar.has(name) ? { value: jar.get(name) } : undefined,
        set: (name, value, options) => { jar.set(name, value); writes.push({ name, value, options }); },
        delete: name => jar.delete(name),
    };
    const dependencies = { 'server-only': {}, '@/lib/server/auth': { getAuthData: async () => ({ user: { _id: 'fixture' } }) }, 'next/headers': { cookies: async () => cookieStore } };
    const tmdb = load('lib/tmdb-credentials.ts', dependencies, { process: { env } });
    const tinyfish = load('lib/tinyfish-credentials.ts', dependencies, { process: { env } });
    const mdblist = load('lib/mdblist-credentials.ts', dependencies, { process: { env } });
    let signedIn = true;
    const { syncBrowserConnectionCredentials: sync } = load('app/actions/browser-connection-credentials.ts', {
        ...dependencies, '@/app/actions/auth': { getUser: async () => signedIn ? { _id: 'fixture' } : null },
        '@/lib/cookie-policy': policy, '@/lib/tmdb-credentials': tmdb, '@/lib/tinyfish-credentials': tinyfish, '@/lib/mdblist-credentials': mdblist,
    });
    let result = await sync({});
    assert.equal(result.success, true);
    assert.equal(result.tmdbToken, undefined);
    assert.equal(result.tinyfishApiKey, undefined, 'Shared server keys must never be copied into browser storage');
    assert.equal(result.mdblistApiKey, undefined);
    assert.equal(result.changed, false);
    jar.set(tmdb.TMDB_TOKEN_COOKIE, 'legacy-tmdb');
    jar.set(tinyfish.TINYFISH_KEY_COOKIE, 'legacy-tinyfish');
    jar.set(mdblist.MDBLIST_KEY_COOKIE, 'legacy-mdblist');
    result = await sync({});
    assert.equal(result.tmdbToken, 'legacy-tmdb');
    assert.equal(result.tinyfishApiKey, 'legacy-tinyfish');
    assert.equal(result.mdblistApiKey, 'legacy-mdblist');
    assert.equal(result.changed, false, 'Migration reads only existing personal cookies');
    result = await sync({ tmdbToken: 'browser-tmdb', tinyfishApiKey: 'browser-tinyfish', mdblistApiKey: 'browser-mdblist' });
    assert.equal(result.changed, true);
    assert.equal(await tmdb.getTMDBToken(), 'browser-tmdb');
    assert.equal((await tinyfish.getTinyfishConfig()).apiKey, 'browser-tinyfish', 'Server lookups use browser-restored credentials');
    assert.equal(await mdblist.getMDBListKey(), 'browser-mdblist');
    assert.ok(writes.every(write => write.options.httpOnly && write.options.sameSite === 'lax' && !write.options.secure));
    assert.equal((await sync({ tmdbToken: 'browser-tmdb', tinyfishApiKey: 'browser-tinyfish' })).changed, false);
    const before = writes.length;
    assert.equal((await sync({ tmdbToken: 'bad\r\nheader' })).success, false);
    assert.equal(writes.length, before);
    signedIn = false;
    assert.equal((await sync({ tmdbToken: 'forbidden' })).success, false);
    assert.equal(jar.get(tmdb.TMDB_TOKEN_COOKIE), 'browser-tmdb');
    signedIn = true;

    function mountField(service) {
        const host = hooks();
        const { useConnectionCredential } = load('components/settings/use-connection-credential.ts', {
            react: host.react, '@/lib/browser-connection-credentials': browser,
        }, globals);
        const render = () => host.render(useConnectionCredential, service);
        render(); host.flush();
        return { host, render };
    }
    browser.saveConnectionCredential('tmdb', 'saved-tmdb');
    let field = mountField('tmdb');
    assert.equal(field.render().value, 'saved-tmdb', 'Input restores the saved key');
    field.render().setValue('replacement-draft');
    assert.equal(browser.readConnectionCredential('tmdb'), 'saved-tmdb', 'Unvalidated drafts must not replace the saved key');
    browser.saveConnectionCredential('tinyfish', 'different-service');
    assert.equal(field.render().value, 'replacement-draft', 'Saving another service must not discard an unsaved draft');
    field.render().persist('verified-tmdb');
    field.host.unmount(); field = mountField('tmdb');
    assert.equal(field.render().value, 'verified-tmdb', 'Saved value survives a component/page reload');
    field.render().persist(''); field.host.unmount(); field = mountField('tmdb');
    assert.equal(field.render().value, '');
    assert.equal(browser.readConnectionCredential('tmdb'), '', 'Explicit removal remains distinct from a missing key');
    field.host.unmount();

    let refreshes = 0;
    const router = { refresh: () => refreshes++ };
    function mountSync(action = sync) {
        const host = hooks();
        const { BrowserConnectionSync } = load('components/browser-connection-sync.tsx', {
            react: host.react, 'next/navigation': { usePathname: () => '/', useRouter: () => router },
            '@/app/actions/browser-connection-credentials': { syncBrowserConnectionCredentials: action },
            '@/lib/browser-connection-credentials': browser,
        }, globals);
        host.render(BrowserConnectionSync); host.flush();
        return host;
    }
    const tick = () => new Promise(resolve => setImmediate(resolve));
    store.clear();
    jar.set(tmdb.TMDB_TOKEN_COOKIE, 'migrate-tmdb'); jar.set(tinyfish.TINYFISH_KEY_COOKIE, 'migrate-tinyfish');
    jar.set(mdblist.MDBLIST_KEY_COOKIE, 'migrate-mdblist');
    let host = mountSync(); await tick(); host.unmount();
    assert.equal(browser.readConnectionCredential('tmdb'), 'migrate-tmdb');
    assert.equal(browser.readConnectionCredential('tinyfish'), 'migrate-tinyfish');
    assert.equal(browser.readConnectionCredential('mdblist'), 'migrate-mdblist');
    assert.equal(refreshes, 0);
    jar.clear(); host = mountSync(); await tick(); host.unmount();
    assert.equal(await tmdb.getTMDBToken(), 'migrate-tmdb');
    assert.equal(await mdblist.getMDBListKey(), 'migrate-mdblist');
    assert.equal(refreshes, 1, 'Restoring cookies refreshes server-rendered metadata');
    let finish;
    host = mountSync(() => new Promise(resolve => { finish = resolve; }));
    browser.saveConnectionCredential('tmdb', 'newer-save');
    finish({ success: true, tmdbToken: 'stale-response', changed: false }); await tick(); host.unmount();
    assert.equal(browser.readConnectionCredential('tmdb'), 'newer-save');
    browser.saveConnectionCredential('tmdb', ''); browser.saveConnectionCredential('tinyfish', '');
    browser.saveConnectionCredential('mdblist', '');
    host = mountSync(); await tick(); host.unmount();
    assert.equal(jar.has(tmdb.TMDB_TOKEN_COOKIE), false);
    assert.equal(jar.has(tinyfish.TINYFISH_KEY_COOKIE), false);
    assert.equal(jar.has(mdblist.MDBLIST_KEY_COOKIE), false);
    assert.ok(![...store.values()].some(value => value.startsWith('never-export')));
    console.log('PASS: browser credential persistence, field reloads, personal-cookie migration, server restoration, removal, draft preservation and no environment-key exposure.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
