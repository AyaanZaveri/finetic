const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { mkdtemp, readFile, readdir, rm, stat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } = require('jose');
const { streamText, tool } = require('ai');
const { z } = require('zod');
const { load } = require('./test-support/react-hooks.cjs');

const origin = 'http://127.0.0.1:37371';
const issuer = 'https://auth.openai.com';
const clientId = 'oaiapp_fixture';
const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const identity = 'fixture-openai-user';
const userId = 'fixture-navigator-user';
const modelId = 'gpt-6.2-sol';
const base = 'https://api.openai.com/v1';

async function main() {
    const directory = await mkdtemp(join(tmpdir(), 'navigator-chatgpt-'));
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwks = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'fixture', alg: 'RS256' }] });
    const dependencies = {
        'server-only': {},
        './session': {
            isLocalDesktopServer: () => true,
            localSettingsDirectory: async () => directory,
            sessionKey: async () => new Uint8Array(32).fill(7),
        },
        jose: { ...require('jose'), createRemoteJWKSet: () => jwks },
    };
    const globals = { Buffer, AbortSignal, Response, URL, URLSearchParams, process: { env: { PORT: '37371' } } };
    let authUrl;
    let refreshes = 0;
    let exchanges = 0;
    let revoked = 0;
    let useWrongNonce = false;
    let authorizedScopes = scopes;
    const requests = [];
    let events = [
        { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_1' } },
        { type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', delta: '{"name":"Navigator"}' },
        { type: 'response.completed', response: {} },
    ];
    const upstream = async (url, options) => {
        assert.equal(options.redirect, 'error');
        assert.equal(options.cache, 'no-store');
        switch (String(url)) {
        case issuer + '/api/accounts/oauth/token': {
            const params = options.body;
            assert.equal(params.get('client_id'), clientId);
            assert.equal(params.get('resource'), base);
            if (params.get('grant_type') === 'refresh_token') {
                assert.equal(params.get('refresh_token'), 'fixture-refresh-token');
                refreshes++;
                return Response.json({ access_token: 'rotated-access-token', refresh_token: 'rotated-refresh-token',
                    token_type: 'Bearer', expires_in: 3600 });
            }
            exchanges++;
            assert.equal(params.get('grant_type'), 'authorization_code');
            assert.equal(params.get('redirect_uri'), authUrl.searchParams.get('redirect_uri'));
            assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'), authUrl.searchParams.get('code_challenge'));
            const idToken = await new SignJWT({ email: 'fixture@example.test',
                nonce: useWrongNonce ? 'wrong' : authUrl.searchParams.get('nonce') })
                .setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).setIssuer(issuer).setSubject(identity)
                .setAudience(clientId).setExpirationTime('5m').sign(privateKey);
            return Response.json({ access_token: 'fixture-access-token', refresh_token: 'fixture-refresh-token',
                token_type: 'Bearer', expires_in: 30, id_token: idToken, scope: authorizedScopes });
        }
        case issuer + '/.well-known/openid-configuration':
            return Response.json({ revocation_endpoint: issuer + '/api/accounts/oauth/revoke' });
        case issuer + '/api/accounts/oauth/revoke':
            assert.equal(options.body.get('token'), 'rotated-refresh-token');
            assert.equal(options.body.get('client_id'), clientId);
            revoked++;
            return new Response(null);
        case base + '/models':
            assert.equal(options.headers.Authorization, 'Bearer rotated-access-token');
            return Response.json({ models: [
                { slug: modelId, display_name: 'GPT-6.2 Sol', visibility: 'list' },
                { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' },
                { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' },
            ] });
        case base + '/responses':
            assert.equal(options.headers.get('Authorization'), 'Bearer rotated-access-token');
            requests.push(JSON.parse(options.body));
            return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
                headers: { 'Content-Type': 'text/event-stream' },
            });
        default:
            throw Error(`Unexpected request to ${url}`);
        }
    };
    const freshConnection = () => load('lib/server/chatgpt-connection.ts', dependencies, { ...globals, fetch: upstream });
    let connection = freshConnection();
    let attemptId;
    async function start() {
        const next = await connection.startChatGPTSignIn(userId);
        attemptId = next.attemptId;
        authUrl = new URL(next.url);
        assert.equal(authUrl.origin, issuer);
        assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
        assert.equal(authUrl.searchParams.get('scope'), scopes);
        assert.match(authUrl.searchParams.get('ext_agent_host_id'), /^urn:uuid:/);
        assert.match(authUrl.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
        return authUrl.searchParams;
    }
    function callback(state, client = clientId, extra = {}) {
        const callback = new URL(authUrl.searchParams.get('redirect_uri'));
        callback.search = new URLSearchParams({ state, code: 'fixture-authorization-code',
            ...(client ? { client_id: client } : {}), ...extra }).toString();
        return fetch(callback);
    }
    try {
        const route = load('app/api/openai/chatgpt/route.ts', {
            '@/lib/server/chatgpt-connection': connection,
            '@/lib/server/auth': { getAuthData: async () => ({ user: { _id: userId } }) },
        }, globals);
        const status = await route.GET(new Request(origin, { headers: { Host: 'example.test' } }));
        assert.equal(status.headers.get('cache-control'), 'no-store');
        assert.equal((await status.json()).available, false);
        const rejectedOrigin = await route.POST(new Request(origin, {
            method: 'POST', headers: { Host: '127.0.0.1:37371', Origin: 'https://other.test' },
            body: JSON.stringify({ action: 'start' }),
        }));
        assert.equal(rejectedOrigin.status, 403);

        let params = await start();
        const hostId = params.get('ext_agent_host_id');
        assert.equal(params.get('client_id'), 'dynamic_agent_client');
        assert.equal(params.get('agent_name_hint'), 'Navigator');
        assert.equal((await callback('wrong-state')).status, 400);
        assert.equal(exchanges, 0);
        useWrongNonce = true;
        assert.equal((await callback(params.get('state'))).status, 400);
        assert.equal((await connection.chatGPTStatus(userId, attemptId)).connection, null);
        useWrongNonce = false;

        params = await start();
        assert.equal(params.get('ext_agent_host_id'), hostId);
        authorizedScopes = 'openid profile email offline_access';
        assert.equal((await callback(params.get('state'))).status, 200);
        assert.equal((await connection.chatGPTStatus(userId, attemptId)).connection.planEnabled, false);
        await assert.rejects(connection.chatGPTCredential(userId), /Enable ChatGPT plan usage/);
        authorizedScopes = scopes;

        params = await start();
        assert.equal(params.get('client_id'), clientId);
        assert.equal(params.get('agent_name_hint'), null);
        assert.equal(params.get('prompt'), 'consent');
        assert.equal((await callback(params.get('state'), null)).status, 200);
        assert.equal((await connection.chatGPTStatus(userId, attemptId)).attempt.status, 'complete');
        assert.equal((await connection.chatGPTStatus('another-user', null)).connection, null);
        const store = join(directory, 'chatgpt', '37371');
        const encrypted = (await readdir(store)).find(name => name.endsWith('.jwe'));
        assert.doesNotMatch(await readFile(join(store, encrypted), 'utf8'), /fixture-refresh-token|fixture@example/);
        if (process.platform !== 'win32') assert.equal((await stat(join(store, encrypted))).mode & 0o777, 0o600);

        // Reload the implementation with an empty in-memory state.
        connection = freshConnection();
        const [first, second] = await Promise.all([connection.chatGPTCredential(userId), connection.chatGPTCredential(userId)]);
        assert.equal(refreshes, 1);
        assert.equal(first.accessToken, 'rotated-access-token');
        assert.equal(second.accessToken, first.accessToken);
        await assert.rejects(connection.chatGPTCredential(userId, randomUUID()), /connection changed/);
        const models = await connection.listChatGPTModels(first.accessToken);
        assert.deepEqual(JSON.parse(JSON.stringify(models)), [
            { id: modelId, name: 'GPT-6.2 Sol' }, { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
        ]);

        const { createChatGPTModel } = load('lib/server/chatgpt-model.ts', { ...dependencies, './chatgpt-connection': connection },
            { ...globals, fetch: upstream, Headers, TransformStream });
        await assert.rejects(createChatGPTModel(userId, 'hidden'), /Choose an available ChatGPT model/);
        const model = await createChatGPTModel(userId, '');
        const stream = streamText({ model, prompt: 'Hello', instructions: 'Use the supplied tools.', maxOutputTokens: 200,
            onError() {}, tools: { findTitle: tool({ description: 'Find a movie', inputSchema: z.object({ title: z.string() }) }) } });
        assert.equal(await stream.text, '{"name":"Navigator"}');
        assert.equal(await stream.finishReason, 'stop');
        assert.equal(requests[0].store, false);
        assert.equal(requests[0].stream, true);
        assert.equal(requests[0].model, modelId);
        assert.equal(requests[0].max_output_tokens, undefined);
        assert.equal(requests[0].previous_response_id, undefined);
        assert.equal(requests[0].input[0].role, 'developer');
        assert.equal(requests[0].tools[0].type, 'namespace');
        assert.equal(requests[0].tools[0].tools[0].name, 'findTitle');

        const { generateNavigatorObject } = load('lib/navigator-structured-output.ts', {}, globals);
        const result = await generateNavigatorObject({ model, task: 'fixture',
            prompt: 'Name the app', schema: z.object({ name: z.string() }) });
        assert.equal(result.output.name, 'Navigator');
        assert.equal(requests[1].stream, true);
        assert.equal(requests[1].text.format.type, 'json_schema');

        events = [{ type: 'response.failed', sequence_number: 1, response: {
            error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'fixture-limit-details' },
        } }];
        await assert.rejects(generateNavigatorObject({ model, task: 'fixture',
            prompt: 'Name the app', schema: z.object({ name: z.string() }) }), /ChatGPT usage limit reached/);
        events = [];
        await assert.rejects(generateNavigatorObject({ model, task: 'fixture',
            prompt: 'Name the app', schema: z.object({ name: z.string() }) }), /before it completed/);

        assert.equal(await connection.signOutChatGPT(userId, false), true);
        assert.equal(revoked, 1);
        await assert.rejects(connection.chatGPTCredential(userId), /Sign in to ChatGPT/);
        const reconnect = await start();
        assert.equal(reconnect.get('client_id'), clientId);
        assert.equal(reconnect.get('ext_agent_host_id'), hostId);
        assert.equal((await callback(reconnect.get('state'), null, { error: 'access_denied' })).status, 400);
        assert.equal((await connection.chatGPTStatus(userId, attemptId)).connection.signedIn, false);
        assert.equal(await connection.signOutChatGPT(userId, true), true);
        assert.equal((await connection.chatGPTStatus(userId, null)).connection, null);
    } finally {
        if (attemptId) await connection.cancelChatGPTSignIn(userId, attemptId);
        await rm(directory, { force: true, recursive: true });
    }
}

main().then(() => console.log('PASS: ChatGPT OAuth, origin and account checks, persisted rotation, model catalog, streaming and revocation'))
    .catch(error => { console.error(error); process.exitCode = 1; });
