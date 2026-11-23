const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');

function fixture({ platform = 'windows', configured = false, token, path = '/', error = false, session = new Map(), blockedStorage = false, authenticated = true } = {}) {
    const host = hooks(), notifications = [], dismissed = [], routes = [], listeners = new Map();
    let checks = 0, resolve;
    const request = new Promise(done => { resolve = done; });
    let signIns = 0;
    const toast = (title, options) => notifications.push({ title, ...options });
    toast.dismiss = id => dismissed.push(id);
    const { DesktopTmdbSetupPrompt } = load('components/desktop-tmdb-setup-prompt.tsx', {
        react: host.react,
        'next/navigation': { usePathname: () => path, useRouter: () => router },
        sonner: { toast },
        '@/lib/desktop/bridge': { desktopBridge: () => platform ? { platform } : undefined },
        '@/contexts/account-context': { useAccountAccess: () => ({ authenticated, requestSignIn: () => signIns++ }) },
        '@/app/actions/artwork-settings': { getDiscoveryAvailability: async () => { checks++; await request; if (error) throw Error('offline'); return configured; } },
        '@/lib/browser-connection-credentials': { CONNECTION_CREDENTIALS_EVENT: 'credentials', readConnectionCredential: () => token },
    }, {
        window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
        localStorage: { getItem: key => { if (blockedStorage) throw Error(); return session.get(key); }, setItem: (key, value) => { if (blockedStorage) throw Error(); session.set(key, value); } },
    });
    const router = { push: route => routes.push(route) };
    return { host, notifications, dismissed, routes, listeners, session,
        get checks() { return checks; }, get signIns() { return signIns; },
        render() { host.render(DesktopTmdbSetupPrompt); host.flush(); },
        async settle() { resolve(); await new Promise(done => setImmediate(done)); },
        save() { token = 'saved-token'; listeners.get('credentials')?.(); },
    };
}

(async () => {
    for (const platform of ['windows', 'macos', 'linux']) {
        const f = fixture({ platform }); f.render(); await f.settle();
        assert.equal(f.notifications.length, 1);
        assert.equal(f.notifications[0].action.label, 'Configure TMDB');
        f.notifications[0].action.onClick();
        assert.deepEqual(f.routes, ['/settings/connections#tmdb']);
        f.host.replay(); await f.settle();
        assert.equal(f.notifications.length, 1, 'StrictMode and subsequent renders must not repeat the toast');
        f.save(); assert.ok(f.dismissed.includes('navigator-tmdb-intro-v1'));
        f.host.unmount(); assert.equal(f.listeners.size, 0);
    }
    for (const options of [{ platform: undefined }, { platform: 'android' }, { platform: 'ios' }, { configured: true }, { token: 'saved' }, { path: '/settings/connections' }, { error: true }]) {
        // null represents a browser; undefined is the fixture's default platform.
        const f = fixture(options.platform === undefined && 'platform' in options ? { platform: null } : options);
        f.render(); await f.settle(); assert.equal(f.notifications.length, 0);
    }
    const guest = fixture({ authenticated: false }); guest.render(); await guest.settle();
    assert.equal(guest.notifications[0].action.label, 'Sign in to configure');
    guest.notifications[0].action.onClick(); assert.equal(guest.signIns, 1);
    const stale = fixture(); stale.render(); stale.host.unmount(); await stale.settle(); assert.equal(stale.notifications.length, 0);
    const restored = fixture(); restored.render(); restored.save(); await restored.settle(); assert.equal(restored.notifications.length, 0, 'Late browser-key restoration suppresses the prompt');
    const session = new Map(); const first = fixture({ session }); first.render(); await first.settle(); first.host.unmount();
    const remount = fixture({ session }); remount.render(); await remount.settle(); assert.equal(remount.notifications.length, 0, 'The intro stays dismissed on later launches');
    const blocked = fixture({ blockedStorage: true }); blocked.render(); await blocked.settle(); blocked.host.replay(); await blocked.settle(); assert.equal(blocked.notifications.length, 1);
    console.log('PASS: desktop-only TMDB onboarding, settings action, saved/server credentials, launch dedupe, restoration races, failures and cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
