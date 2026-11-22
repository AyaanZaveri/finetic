const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createHash } = require("node:crypto");
const { load } = require("./test-support/react-hooks.cjs");

async function main() {
    const home = await fs.mkdtemp(join(tmpdir(), "navigator-chatgpt-"));
    const jose = await import("jose");
    const { privateKey, publicKey } = await jose.generateKeyPair("RS256");
    const jwks = jose.createLocalJWKSet({ keys: [await jose.exportJWK(publicKey)] });
    const endpoint = "https://api.openai.com/v1";
    const issuer = "https://auth.openai.com";
    const clientId = "oaiapp_fixture";
    const user = "test-user";
    let authorization;
    let exchanges = 0;
    let refreshes = 0;
    let revoked = false;
    let lastChatRequest;
    const globals = {
        URL, URLSearchParams, Response, Headers, TextDecoderStream, TextEncoder, TransformStream,
        process: { platform: "linux", env: { XDG_CONFIG_HOME: home, PORT: "37371", HOSTNAME: "127.0.0.1", NAVIGATOR_DESKTOP: "1" } },
        async fetch(url, options) {
            assert.equal(options.redirect, "error");
            if (String(url) === issuer + "/.well-known/openid-configuration") {
                return Response.json({ revocation_endpoint: issuer + "/revoke" });
            }
            if (String(url) === issuer + "/revoke") {
                assert.equal(options.body.get("token"), "renewed-refresh");
                revoked = true;
                return new Response();
            }
            if (String(url) === endpoint + "/models") {
                assert.equal(options.headers.Authorization, "Bearer renewed-access");
                return Response.json({ models: [
                    { slug: "hidden", visibility: "hide" },
                    { slug: "gpt-6.2-sol", display_name: "GPT 6.2", visibility: "list" },
                ] });
            }
            if (String(url) === endpoint + "/responses") {
                lastChatRequest = JSON.parse(options.body);
                assert.equal(new Headers(options.headers).get("authorization"), "Bearer renewed-access");
                return new Response('data: {"type":"response.completed","response":{"id":"response-fixture"}}\n\n');
            }
            assert.equal(String(url), issuer + "/api/accounts/oauth/token");
            assert.equal(options.body.get("client_id"), clientId);
            assert.equal(options.body.get("resource"), endpoint);
            const scope = "openid chatgpt.tokens.use.direct offline_access";
            if (options.body.get("grant_type") === "refresh_token") {
                refreshes++;
                assert.equal(options.body.get("refresh_token"), "first-refresh");
                return Response.json({ token_type: "Bearer", access_token: "renewed-access", refresh_token: "renewed-refresh", expires_in: 3600 });
            }
            exchanges++;
            assert.equal(options.body.get("redirect_uri"), authorization.searchParams.get("redirect_uri"));
            assert.equal(createHash("sha256").update(options.body.get("code_verifier")).digest("base64url"),
                authorization.searchParams.get("code_challenge"));
            const idToken = await new jose.SignJWT({ nonce: authorization.searchParams.get("nonce") })
                .setProtectedHeader({ alg: "RS256" }).setIssuer(issuer).setAudience(clientId)
                .setSubject("chatgpt-subject").setIssuedAt().setExpirationTime("1h").sign(privateKey);
            return Response.json({ token_type: "Bearer", access_token: "first-access", refresh_token: "first-refresh",
                expires_in: 1, scope, id_token: idToken });
        },
    };
    const deps = {
        "server-only": {}, "jose": { ...jose, createRemoteJWKSet: () => jwks },
        "node:child_process": { execFile: (_, [url], __, callback) => { authorization = new URL(url); callback(null); } },
        "@/lib/models-dev": { OPENAI_DEFAULT_BASE_URL: endpoint },
    };
    try {
        const auth = load("lib/server/chatgpt-auth.ts", deps, globals);
        await auth.startChatGPTSignIn(user);
        assert.equal(authorization.searchParams.get("client_id"), "dynamic_agent_client");
        const callback = new URL(authorization.searchParams.get("redirect_uri"));
        assert.equal(callback.hostname, "127.0.0.1");
        callback.search = new URLSearchParams({ client_id: clientId, code: "fixture", state: "wrong" });
        assert.equal((await fetch(callback)).status, 404);
        assert.equal(exchanges, 0);
        callback.searchParams.set("state", authorization.searchParams.get("state"));
        assert.match(await (await fetch(callback)).text(), /complete/);
        assert.equal(exchanges, 1);

        // Load from a fresh module runtime, as on a subsequent desktop launch.
        const restored = load("lib/server/chatgpt-auth.ts", deps, globals);
        const status = await restored.chatGPTStatus(user);
        assert.equal(status.active, clientId);
        assert.equal(status.enabled, true);
        assert.doesNotMatch(JSON.stringify(status), /access|refresh|chatgpt-subject/);
        assert.equal((await restored.chatGPTStatus("different-user")).enabled, false);
        const credentials = await Promise.all([restored.chatGPTCredentials(user), restored.chatGPTCredentials(user)]);
        assert.equal(credentials[0].accessToken, "renewed-access");
        assert.equal(credentials[1].accessToken, "renewed-access");
        assert.equal(refreshes, 1);
        const directory = join(home, "Navigator Desktop", "chatgpt");
        const [file] = await fs.readdir(directory);
        if (process.platform !== "win32") assert.equal((await fs.stat(join(directory, file))).mode & 0o777, 0o600);

        const route = load("app/api/openai/chatgpt/route.ts", {
            ...deps, "@/lib/server/chatgpt-auth": restored, "@/lib/server/auth": { getAuthData: async () => ({ user: { _id: user } }) },
        }, globals);
        const origin = "http://127.0.0.1:37371";
        const request = originHeader => new Request(origin + "/api/openai/chatgpt", {
            method: "POST", headers: { host: "127.0.0.1:37371", origin: originHeader },
            body: JSON.stringify({ action: "models", clientId }),
        });
        assert.equal((await route.POST(request("https://other.example"))).status, 403);
        assert.deepEqual(await (await route.POST(request(origin))).json(), { models: [{ id: "gpt-6.2-sol", name: "GPT 6.2" }] });

        const modelModule = load("lib/server/chatgpt-model.ts", {
            ...deps, "eventsource-parser/stream": await import("eventsource-parser/stream"),
            "@ai-sdk/openai": { createOpenAI: ({ apiKey, fetch }) => ({ responses: () => {
                const send = (stream, options) => fetch(endpoint + "/responses", {
                    headers: { Authorization: `Bearer ${apiKey}` },
                    body: JSON.stringify({ stream, store: options.providerOptions.openai.store, temperature: 1,
                        tools: [{ type: "function", name: "lookup" }], previous_response_id: "must-omit" }),
                });
                return { doGenerate: options => send(false, options), doStream: options => send(true, options) };
            } }) },
        }, globals);
        const model = modelModule.createChatGPTModel("gpt-6.2-sol", "renewed-access");
        assert.deepEqual(await (await model.doGenerate({})).json(), { id: "response-fixture" });
        assert.match(await (await model.doStream({})).text(), /response.completed/);
        assert.deepEqual(lastChatRequest, { stream: true, store: false, tools: [
            { type: "namespace", name: "navigator", description: "Navigator media tools", tools: [{ type: "function", name: "lookup" }] },
        ] });

        assert.equal((await restored.updateChatGPT(user, { signOut: true })).revocationConfirmed, true);
        assert.equal(revoked, true);
        await assert.rejects(restored.chatGPTCredentials(user), /Connect an eligible/);
        await restored.startChatGPTSignIn(user, clientId);
        assert.equal(authorization.searchParams.get("client_id"), clientId);
        const declined = new URL(authorization.searchParams.get("redirect_uri"));
        declined.search = new URLSearchParams({ state: authorization.searchParams.get("state"), error: "access_denied" });
        await (await fetch(declined)).text();
        assert.match((await restored.chatGPTStatus(user)).error, /declined/);
        assert.equal(exchanges, 1);
        console.log("PASS: ChatGPT PKCE callback, signed identity, restart persistence, refresh rotation, origin checks, model catalog, Responses transport, and sign-out.");
    } finally {
        await fs.rm(home, { recursive: true, force: true });
    }
}

main().catch(error => { console.error(error); process.exit(1); });
