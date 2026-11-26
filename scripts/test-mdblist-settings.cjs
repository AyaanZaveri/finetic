const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');

async function main() {
    const env = { NODE_ENV: 'production', NAVIGATOR_DESKTOP: '1', HOSTNAME: '127.0.0.1' };
    const jar = new Map(), writes = [], reads = [], invalidations = [];
    let authenticated = true, status = 200, body = { user: 'fixture' };
    const store = {
        get: name => jar.has(name) ? { value: jar.get(name) } : undefined,
        set: (name, value, options) => { jar.set(name, value); writes.push(options); },
        delete: name => jar.delete(name),
    };
    const deps = {
        'server-only': {},
        'next/headers': { cookies: async () => store },
        'next/cache': { revalidatePath: (...args) => invalidations.push(args) },
        '@/app/actions/auth': { getUser: async () => authenticated ? { _id: 'fixture' } : null },
        '@/lib/server/auth': { getAuthData: async () => { if (!authenticated) throw Error('Signed out'); return { user: { _id: 'fixture' } }; } },
    };
    const credentials = load('lib/mdblist-credentials.ts', deps, { process: { env } });
    const actions = load('app/actions/mdblist-settings.ts', {
        ...deps,
        '@/lib/mdblist-credentials': credentials,
        '@/lib/cookie-policy': load('lib/cookie-policy.ts', {}, { process: { env } }),
    }, {
        URLSearchParams, AbortSignal,
        fetch: async (input, init) => {
            const url = new URL(input);
            assert.equal(url.origin, 'https://api.mdblist.com');
            assert.equal(url.pathname, '/user');
            assert.equal(init.redirect, 'manual');
            assert.equal(init.cache, 'no-store');
            assert.ok(init.signal);
            reads.push(url.searchParams.get('apikey'));
            return Response.json(body, { status });
        },
    });
    assert.equal((await actions.getMDBListSettings()).configured, false);
    env.MDBLIST_API_KEY = 'shared-fixture';
    assert.equal((await actions.getMDBListSettings()).configured, true);
    assert.equal((await actions.getMDBListSettings()).personal, false);
    for (const key of ['', 'bad\nkey', 'x'.repeat(2049)]) assert.equal((await actions.saveMDBListKey(key)).success, false);
    assert.equal(reads.length, 0);
    const saved = await actions.saveMDBListKey(' personal-fixture ');
    assert.equal(saved.success, true);
    assert.equal(reads[0], 'personal-fixture');
    assert.equal(await credentials.getMDBListKey(), 'personal-fixture');
    assert.ok(writes[0].httpOnly && writes[0].sameSite === 'lax' && !writes[0].secure);
    assert.ok(!JSON.stringify(saved).includes('personal-fixture'));
    assert.ok(!JSON.stringify(await actions.getMDBListSettings()).includes('personal-fixture'));
    status = 401;
    assert.equal((await actions.saveMDBListKey('bad-key')).success, false);
    assert.equal(await credentials.getMDBListKey(), 'personal-fixture');
    status = 200; body = { error: 'Rejected' };
    assert.equal((await actions.saveMDBListKey('bad-key')).success, false);
    authenticated = false;
    assert.equal(await credentials.getMDBListKey(), 'shared-fixture', 'Guests never consume an account’s saved key');
    assert.equal((await actions.removeMDBListKey()).success, false);
    assert.equal((await actions.saveMDBListKey('forbidden')).success, false);
    await assert.rejects(actions.getMDBListSettings(), /Sign in/);
    authenticated = true;
    const removed = await actions.removeMDBListKey();
    assert.equal(removed.success, true);
    assert.equal(removed.personal, false);
    assert.equal(await credentials.getMDBListKey(), 'shared-fixture');
    assert.equal(invalidations.length, 2);
    console.log('PASS: MDBList key verification, secure storage, shared fallback, authenticated mutation and failed replacement preservation.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
