const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load } = require('./test-support/react-hooks.cjs');

async function main() {
    const jose = await import('jose');
    const secret = 'a1'.repeat(32);
    const env = { NODE_ENV: 'production', NAVIGATOR_SESSION_SECRET: secret };
    const globals = { process: { env }, crypto: require('node:crypto').webcrypto, Uint8Array, TextEncoder, TextDecoder,
        Request, Response, Headers, URL, AbortController, AbortSignal, TransformStream, ReadableStream, Error, Date,
        console: { log() {}, error() {} } };
    const session = load('lib/server/session.ts', { 'server-only': {}, jose }, globals);
    const user = { _id: 'user-1', email: 'fixture@example.invalid', trakt: { access_token: 'must-stay-private' } };
    const token = await session.createSession('private-stremio-key', user);
    assert.ok(!token.includes(user.email) && !token.includes('private-stremio-key'));
    assert.equal((await session.readSession(token)).user._id, user._id);
    assert.equal((await session.readSession(token)).user.trakt, undefined);
    for (const bad of [undefined, '{}', JSON.stringify({ authKey: 'forged', user }), token.slice(0, -8) + 'xxxxxxxx']) {
        assert.equal(await session.readSession(bad), null);
    }
    const wrongKey = load('lib/server/session.ts', { 'server-only': {}, jose }, { ...globals, process: { env: { ...env, NAVIGATOR_SESSION_SECRET: 'b2'.repeat(32) } } });
    assert.equal(await wrongKey.readSession(token), null);
    const expired = await new jose.EncryptJWT({ authKey: 'expired', user }).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
        .setIssuer('navigator').setAudience('navigator-session').setSubject(user._id).setIssuedAt(1).setExpirationTime(2)
        .encrypt(Buffer.from(secret, 'hex'));
    assert.equal(await session.readSession(expired), null);
    const missingKey = load('lib/server/session.ts', { 'server-only': {}, jose }, { ...globals, process: { env: { NODE_ENV: 'production' } } });
    await assert.rejects(missingKey.createSession('key', user), /NAVIGATOR_SESSION_SECRET/);

    const temp = fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'navigator-session-test-'));
    try {
        const localGlobals = { ...globals, process: { env: { NODE_ENV: 'development' }, platform: process.platform } };
        const localDependencies = { 'server-only': {}, jose, 'node:os': { homedir: () => temp } };
        const localA = load('lib/server/session.ts', localDependencies, localGlobals);
        const localB = load('lib/server/session.ts', localDependencies, localGlobals);
        const [localTokenA, localTokenB] = await Promise.all([localA.createSession('local-key-a', user), localB.createSession('local-key-b', user)]);
        assert.equal((await localB.readSession(localTokenA)).authKey, 'local-key-a');
        assert.equal((await localA.readSession(localTokenB)).authKey, 'local-key-b');
        const restarted = load('lib/server/session.ts', localDependencies, localGlobals);
        assert.equal((await restarted.readSession(localTokenA)).user._id, user._id, 'Local sessions survive a process restart');
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }

    let cookie = token;
    const written = [];
    const jar = { get: () => cookie ? { value: cookie } : undefined, set: (...args) => written.push(args), delete: () => { cookie = undefined; } };
    const auth = load('lib/server/auth.ts', { 'server-only': {}, 'next/headers': { cookies: async () => jar }, '@/lib/server/session': session }, globals);
    const actions = load('app/actions/auth.ts', {
        'next/headers': { cookies: async () => jar }, 'next/navigation': { redirect() {} },
        '@/lib/cookie-policy': { cookieRequiresHttps: () => true }, '@/lib/server/session': session, '@/lib/server/auth': auth,
    }, { ...globals, fetch: async () => Response.json({ result: { authKey: 'login-private-key', user } }) });
    assert.equal(actions.getAuthData, undefined, 'The bearer accessor must not be a public Server Action');
    const profile = await actions.getUser();
    assert.equal(profile.authKey, undefined); assert.equal(profile.trakt, undefined);
    const sessionRoute = load('app/api/auth/session/route.ts', { 'next/headers': { cookies: async () => jar }, '@/lib/server/session': session }, globals);
    const sessionResponse = await sessionRoute.GET();
    assert.equal(sessionResponse.headers.get('cache-control'), 'private, no-store');
    assert.ok(!(await sessionResponse.text()).includes('private-stremio-key'));
    cookie = '{}';
    await assert.rejects(auth.getAuthData(), /Not authenticated/);
    assert.equal(await actions.getUser(), null);
    assert.equal((await sessionRoute.GET()).status, 401);
    assert.equal(await actions.authenticateUser(user.email, 'password'), true);
    assert.equal(written[0][2].httpOnly, true); assert.equal(written[0][2].secure, true);
    cookie = written[0][1];
    assert.equal((await auth.getAuthData()).authKey, 'login-private-key');
    const proxy = load('proxy.ts', { 'next/server': { NextResponse: { next: () => ({ status: 200 }), redirect: url => ({ status: 307, url }) } }, '@/lib/server/session': session }, globals).proxy;
    const page = (pathname, value) => ({ nextUrl: new URL(pathname, 'https://navigator.example'), cookies: { get: () => value ? { value } : undefined } });
    for (const path of ['/settings', '/settings/connections', '/settings/playback', '/settings/about/private', '/addons', '/library/private', '/movie/tt123.json', '/series/tmdb:20/extra', '/person/not-an-id', '/person/7/private']) {
        const response = await proxy(page(path, '{}'));
        assert.equal(response.url.pathname, '/');
        assert.equal(response.url.searchParams.get('signIn'), '1');
    }
    for (const path of ['/', '/search', '/movie/tmdb:123', '/movie/tmdb%3A123', '/series/tmdb:20', '/series/tmdb%3A20/0/1', '/person/7', '/person/7/']) {
        assert.equal((await proxy(page(path))).status, 200, `${path} is public discovery`);
    }
    assert.equal((await proxy(page('/settings/about'))).status, 200, 'Version and desktop update controls are reachable before sign-in');
    assert.equal((await proxy(page('/settings', token))).status, 200);
    assert.equal((await proxy(page('/login', token))).url.pathname, '/');
    assert.equal((await proxy(page('/login'))).status, 200);

    let addresses = [{ address: '8.8.8.8', family: 4 }], requests = [], responses = [], agentOptions;
    const networkGlobals = { ...globals, fetch: async (url, options) => {
        requests.push({ url: String(url), options });
        return responses.shift() || Response.json({ ok: true });
    } };
    const transport = load('lib/server/outbound-fetch.ts', {
        'server-only': {}, 'ipaddr.js': require('ipaddr.js'),
        'undici': { Agent: class { constructor(options) { agentOptions = options; } } },
        'node:dns': { lookup: (_host, _options, callback) => callback(null, addresses) },
    }, networkGlobals);
    const forbidden = ['http://127.0.0.1', 'http://2130706433', 'http://0x7f000001', 'http://0177.0.0.1',
        'http://169.254.169.254', 'http://10.0.0.1', 'http://100.64.0.1', 'http://0.0.0.0', 'http://192.168.0.1',
        'http://[::1]', 'http://[::ffff:127.0.0.1]', 'http://[fe80::1]', 'http://[fc00::1]', 'http://localhost',
        'http://localhost.', 'http://metadata.google.internal', 'file:///etc/passwd', 'https://user:secret@example.com'];
    for (const url of forbidden) assert.throws(() => transport.outboundUrl(url), Error, url);
    await transport.outboundFetch('https://public.example.com');
    assert.equal(requests[0].options.redirect, 'manual');
    assert.ok(requests[0].options.dispatcher);
    const dns = options => new Promise((resolve, reject) => agentOptions.connect.lookup('public.example.com', options, (error, result) => error ? reject(error) : resolve(result)));
    assert.equal((await dns({ all: true }))[0].address, '8.8.8.8');
    addresses = [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }];
    await assert.rejects(dns({ all: true }), /private or reserved/);
    addresses = [{ address: '::ffff:10.0.0.1', family: 6 }];
    await assert.rejects(dns({ all: false }), /private or reserved/);
    addresses = [{ address: '8.8.8.8', family: 4 }];
    requests = []; responses = [new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/' } })];
    await assert.rejects(transport.outboundFetch('https://public.example.com'), /Private|reserved/); assert.equal(requests.length, 1);
    requests = []; responses = [new Response(null, { status: 302, headers: { Location: 'https://second.example.com' } }), Response.json({ ok: true })];
    await transport.outboundFetch('https://public.example.com', { headers: { Authorization: 'private', Cookie: 'secret', 'X-Public': 'keep' } });
    assert.equal(requests[1].options.headers.get('authorization'), null); assert.equal(requests[1].options.headers.get('cookie'), null);
    assert.equal(requests[1].options.headers.get('x-public'), 'keep');
    responses = [new Response(null, { status: 307, headers: { Location: 'https://second.example.com' } })];
    await assert.rejects(transport.providerFetch('https://public.example.com', { headers: { Authorization: 'private' } }), /redirect/);
    responses = [new Response('too large', { headers: { 'Content-Length': '1000' } })];
    await assert.rejects(transport.outboundFetch('https://public.example.com', {}, { maxBytes: 4 }), /too large/);
    responses = [new Response('chunked-large')];
    await assert.rejects((await transport.outboundFetch('https://public.example.com', {}, { maxBytes: 4 })).text(), /too large/);
    await assert.rejects(transport.outboundFetch('https://public.example.com', { signal: AbortSignal.abort() }));
    assert.throws(() => transport.outboundUrl('http://localhost:11434', { provider: true }));
    env.NAVIGATOR_DESKTOP = '1'; env.HOSTNAME = '127.0.0.1';
    assert.equal(transport.outboundUrl('http://localhost:11434', { provider: true }).hostname, 'localhost');
    assert.throws(() => transport.outboundUrl('http://localhost:11434'));
    assert.throws(() => transport.outboundUrl('http://169.254.169.254', { provider: true }));
    delete env.NAVIGATOR_DESKTOP; delete env.HOSTNAME;
    const worker = load('lib/server/outbound-fetch.ts', { 'server-only': {}, 'ipaddr.js': require('ipaddr.js') }, { ...networkGlobals, WebSocketPair: class {} });
    responses = [Response.json({ ok: true })];
    await worker.outboundFetch('https://public.example.com');
    assert.equal(requests.at(-1).options.dispatcher, undefined, 'Workers use the platform public-network transport');
    responses = [Response.json({ ok: true })];
    await worker.outboundFetch('https://another-addon.example.com/manifest.json');
    assert.equal(requests.at(-1).url, 'https://another-addon.example.com/manifest.json', 'Public addon hosts require no domain registry');
    await assert.rejects(worker.outboundFetch('http://127.0.0.1'), /Private|reserved/);
    responses = [new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/' } })];
    await assert.rejects(worker.outboundFetch('https://public.example.com'), /Private|reserved/);


    let selected;
    const ai = {}; for (const name of ['APICallError', 'NoObjectGeneratedError', 'RetryError']) ai[name] = { isInstance: () => false };
    const provider = settings => { selected = settings; throw new Error('STOP_AT_MODEL_SELECTION'); };
    const chatDependencies = {
        '@ai-sdk/google': {}, '@ai-sdk/openai': { createOpenAI: provider }, '@openrouter/ai-sdk-provider': {}, '@ai-sdk/groq': {}, '@ai-sdk/cerebras': {}, 'ai-sdk-ollama': {},
        '@ai-sdk/openai-compatible': { createOpenAICompatible: provider }, ai,
        '@/lib/navigator-chat': {}, '@/app/tools/scene-workflow': {}, '@/lib/navigator-model-settings': {}, '@/lib/opencode-go': {}, '@/lib/tmdb-discovery': {}, '@/app/tools': {},
        '@/lib/navigator-scene-context': { sceneRequestContext: () => ({}) },
        '@/lib/models-dev': load('lib/models-dev.ts', {}, { URL }), '@/lib/server/auth': auth, '@/lib/server/outbound-fetch': transport,
        '@/lib/server/default-ai-model': { resolveLatestSmallModel: async (provider, key) => {
            assert.equal(provider, 'openai');
            assert.equal(key, 'dummy-server-key');
            return 'gpt-6-luna';
        } },
    };
    env.OPENAI_API_KEY = 'dummy-server-key';
    const chat = load('app/api/chat/route.ts', chatDependencies, globals).POST;
    const chatRequest = payload => new Request('https://navigator.example/api/chat', { method: 'POST', body: JSON.stringify({ messages: [], ...payload }) });
    cookie = '{}'; assert.equal((await chat(chatRequest({}))).status, 401); assert.equal(selected, undefined);
    cookie = token;
    assert.equal((await chat(chatRequest({ openaiBaseUrl: 'https://attacker.example.com/v1' }))).status, 400);
    assert.equal(selected, undefined, 'A custom endpoint never receives an environment credential');
    await chat(chatRequest({ openaiBaseUrl: 'https://provider.example.com/v1', openaiApiKey: 'personal-key', openaiModel: 'custom-model' }));
    assert.equal(selected.apiKey, 'personal-key'); assert.equal(selected.fetch, transport.providerFetch);
    await chat(chatRequest({})); assert.equal(selected.apiKey, 'dummy-server-key'); assert.equal(selected.baseURL, undefined);

    const models = load('app/api/openai/models/route.ts', {
        'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
        '@/lib/models-dev': { OPENAI_DEFAULT_BASE_URL: 'https://api.openai.com/v1' },
        '@/lib/server/auth': auth, '@/lib/server/outbound-fetch': transport,
    }, globals).POST;
    cookie = '{}';
    const beforeModels = requests.length;
    assert.equal((await models(new Request('https://navigator.example/api/openai/models', { method: 'POST', body: JSON.stringify({ baseUrl: 'http://127.0.0.1/v1' }) }))).status, 401);
    assert.equal(requests.length, beforeModels);
    cookie = token;
    assert.equal((await models(new Request('https://navigator.example/api/openai/models', { method: 'POST', body: JSON.stringify({ baseUrl: 'http://127.0.0.1/v1' }) }))).status, 502);
    assert.equal(requests.length, beforeModels, 'Authenticated hosted model discovery still cannot reach loopback');

    let downloads = 0;
    const subtitles = load('app/actions/subtitles.ts', { './auth': { getInstalledAddons: async () => [] }, '@/lib/server/auth': auth,
        '@/lib/server/outbound-fetch': { outboundFetch: async () => { downloads++; return new Response('captions'); } } }, globals);
    cookie = '{}'; assert.equal((await subtitles.fetchSubtitleFileContent('https://public.example.com/captions')).success, false); assert.equal(downloads, 0);
    cookie = token; assert.equal((await subtitles.fetchSubtitleFileContent('https://public.example.com/captions')).content, 'captions');
    assert.ok(!fs.readFileSync('app/actions/utils.ts', 'utf8').includes('export async function getAuthData'));
    console.log('PASS: encrypted/expired/tampered sessions, profile-only auth, HttpOnly cookies, proxy gates, DNS pinning, private/IP-encoding blocks, redirects, byte limits, aborts, desktop loopback, Worker public destinations, provider-key isolation and subtitle authorization.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
