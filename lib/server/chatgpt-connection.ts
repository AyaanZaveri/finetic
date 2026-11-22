import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { CompactEncrypt, compactDecrypt, createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { isLocalDesktopServer, localSettingsDirectory, sessionKey } from "./session";

const issuer = "https://auth.openai.com";
export const CHATGPT_RESOURCE = "https://api.openai.com/v1";
const callbackPath = "/auth/callback";
const planScopes = ["resource.invoke", "chatgpt.tokens.use.direct"];
const requestedScopes = ["openid", "profile", "email", "offline_access", ...planScopes].join(" ");
const jwks = createRemoteJWKSet(new URL("/.well-known/jwks.json", issuer), { timeoutDuration: 10_000 });
const terminalRefreshErrors = new Set(["invalid_grant", "invalid_refresh_token", "token_expired",
    "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"]);
const modelCatalog = z.object({
    models: z.array(z.object({ slug: z.string(), display_name: z.string(), visibility: z.string() })),
});
const registrationSchema = z.object({
    clientId: z.string(),
    subject: z.string(),
    email: z.string().optional(),
    tokens: z.object({
        sessionId: z.uuid(),
        accessToken: z.string().min(1),
        refreshToken: z.string().min(1).optional(),
        idToken: z.string().min(1),
        scopes: z.array(z.string()),
        expiresAt: z.number(),
    }).optional(),
});
type Registration = z.infer<typeof registrationSchema>;
const tokenResponse = z.object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    id_token: z.string().min(1).optional(),
    token_type: z.string().regex(/^bearer$/i),
    expires_in: z.number().positive().finite(),
    scope: z.string().optional(),
});

export class ChatGPTConnectionError extends Error {
    readonly status: number;

    constructor(message: string, status = 400) {
        super(message);
        this.status = status;
    }
}

type Attempt = {
    id: string;
    status: "pending" | "complete" | "failed";
    error?: string;
    cancel: () => void;
};
const processState = globalThis as typeof globalThis & {
    navigatorChatGPT?: {
        attempts: Map<string, Attempt>;
        queue: Promise<unknown>;
    };
};
const state = processState.navigatorChatGPT ??= { attempts: new Map(), queue: Promise.resolve() };

// One packaged server owns its loopback port, even when multiple profiles run.
function serialized<T>(work: () => Promise<T>): Promise<T> {
    const result = state.queue.then(work);
    state.queue = result.catch(() => {});
    return result;
}

export function chatGPTAvailable(request: Request) {
    const port = process.env.PORT;
    return isLocalDesktopServer() && !!port && /^\d+$/.test(port)
        && request.headers.get("host") === `127.0.0.1:${port}`;
}

export function requireChatGPTOrigin(request: Request) {
    if (!chatGPTAvailable(request)) throw new ChatGPTConnectionError("ChatGPT sign-in is available in Navigator Desktop.", 403);
    if (request.headers.get("origin") !== `http://127.0.0.1:${process.env.PORT}`) {
        throw new ChatGPTConnectionError("Open Navigator Desktop to use this connection.", 403);
    }
}

async function connectionDirectory() {
    const directory = join(await localSettingsDirectory(true), "chatgpt", process.env.PORT!);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
}

async function atomicWrite(path: string, value: string) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, value, { flag: "wx", mode: 0o600 });
        await rename(temporary, path);
    } finally {
        await rm(temporary, { force: true });
    }
}

async function hostId() {
    const path = join(await connectionDirectory(), "host-id");
    try {
        return z.string().regex(/^urn:uuid:[a-f0-9-]{36}$/).parse(await readFile(path, "utf8"));
    } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT") throw error;
        const id = `urn:uuid:${randomUUID()}`;
        await atomicWrite(path, id);
        return id;
    }
}

function recordName(userId: string) {
    return createHash("sha256").update(userId).digest("hex");
}

async function readRegistration(userId: string): Promise<Registration | null> {
    const name = recordName(userId);
    const path = join(await connectionDirectory(), `${name}.jwe`);
    try {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.size > 128_000) throw new Error("Invalid connection file.");
        const { plaintext, protectedHeader } = await compactDecrypt(await readFile(path, "utf8"), await sessionKey(), {
            keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"],
        });
        if (protectedHeader.kid !== `navigator-chatgpt:${name}`) throw new Error("Invalid connection owner.");
        return registrationSchema.parse(JSON.parse(Buffer.from(plaintext).toString("utf8")));
    } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return null;
        throw new ChatGPTConnectionError("Navigator could not read the saved ChatGPT connection.", 500);
    }
}

async function writeRegistration(userId: string, registration: Registration) {
    const name = recordName(userId);
    const data = await new CompactEncrypt(Buffer.from(JSON.stringify(registration)))
        .setProtectedHeader({ alg: "dir", enc: "A256GCM", kid: `navigator-chatgpt:${name}` })
        .encrypt(await sessionKey());
    await atomicWrite(join(await connectionDirectory(), `${name}.jwe`), data);
}

async function oauthToken(params: Record<string, string>) {
    const response = await fetch(`${issuer}/api/accounts/oauth/token`, {
        method: "POST",
        body: new URLSearchParams({ ...params, resource: CHATGPT_RESOURCE }),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
    });
    const data: unknown = await response.json();
    return response.ok ? { tokens: tokenResponse.parse(data) }
        : { error: z.object({ error: z.string() }).safeParse(data).data?.error };
}

function makeTokens(tokens: z.infer<typeof tokenResponse>, idToken: string, sessionId: string = randomUUID(), previousScopes: string[] = []) {
    return {
        sessionId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken,
        scopes: tokens.scope?.split(/\s+/).filter(Boolean) ?? previousScopes,
        expiresAt: Date.now() + tokens.expires_in * 1000,
    };
}

function hasPlan(tokens: Registration["tokens"]) {
    return planScopes.every(scope => tokens?.scopes.includes(scope));
}

export async function chatGPTStatus(userId: string, attemptId: string | null) {
    const registration = await readRegistration(userId);
    const attempt = state.attempts.get(userId);
    return {
        available: true,
        connection: registration && {
            email: registration.email,
            signedIn: !!registration.tokens,
            planEnabled: hasPlan(registration.tokens),
        },
        attempt: attemptId ? attempt?.id === attemptId
            ? { status: attempt.status, error: attempt.error }
            : { status: "failed", error: "This sign-in has expired. Try again." }
            : undefined,
    };
}

export function startChatGPTSignIn(userId: string) {
    return serialized(async () => {
        state.attempts.get(userId)?.cancel();
        const registration = await readRegistration(userId);
        const extAgentHostId = await hostId();
        const stateValue = randomBytes(32).toString("base64url");
        const verifier = randomBytes(32).toString("base64url");
        const nonce = randomBytes(32).toString("base64url");
        const attempt: Attempt = { id: randomUUID(), status: "pending", cancel: () => finish("Sign-in canceled.") };
        let claimed = false;
        const timeout = setTimeout(() => finish("This sign-in has expired. Try again."), 5 * 60_000);
        timeout.unref();

        function finish(error?: string) {
            if (attempt.status !== "pending") return;
            clearTimeout(timeout);
            attempt.status = error ? "failed" : "complete";
            attempt.error = error;
            listener.close();
            setTimeout(() => {
                if (state.attempts.get(userId) === attempt) state.attempts.delete(userId);
            }, 60_000).unref();
        }

        const listener = createServer(async (request, response) => {
            response.setHeader("Cache-Control", "no-store");
            response.setHeader("Content-Type", "text/plain; charset=utf-8");
            response.setHeader("Referrer-Policy", "no-referrer");
            response.setHeader("X-Content-Type-Options", "nosniff");
            const send = (status: number, message: string) => {
                response.writeHead(status).end(message);
            };
            const callback = new URL(callbackUri);
            if (request.method !== "GET" || request.headers.host !== callback.host || !request.url?.startsWith(callbackPath + "?")) {
                return send(404, "Not found.");
            }
            const params = new URLSearchParams(request.url.slice(callbackPath.length + 1));
            const returnedState = Buffer.from(params.get("state") ?? "");
            const expectedState = Buffer.from(stateValue);
            if (claimed || attempt.status !== "pending" || returnedState.length !== expectedState.length
                || !timingSafeEqual(returnedState, expectedState)) return send(400, "Invalid sign-in attempt.");
            claimed = true;
            const denied = params.has("error");
            try {
                if (denied) throw new ChatGPTConnectionError("OpenAI did not authorize this sign-in.");
                const returnedClient = params.get("client_id");
                const clientId = registration?.clientId ?? returnedClient;
                const code = params.get("code");
                if (!code || !clientId || !/^oaiapp_[a-zA-Z0-9_-]+$/.test(clientId)
                    || (returnedClient && returnedClient !== clientId)) {
                    throw new ChatGPTConnectionError("OpenAI returned an incomplete sign-in. Try again.");
                }
                const { tokens } = await oauthToken({
                    grant_type: "authorization_code", client_id: clientId, code,
                    code_verifier: verifier, redirect_uri: callbackUri,
                });
                if (!tokens?.id_token) throw new ChatGPTConnectionError("OpenAI could not complete sign-in. Try again.");
                const { payload } = await jwtVerify(tokens.id_token, jwks, {
                    issuer, audience: clientId, requiredClaims: ["exp", "sub", "nonce"],
                });
                if (payload.nonce !== nonce || !payload.sub || (registration && registration.subject !== payload.sub)) {
                    throw new ChatGPTConnectionError("OpenAI returned a different account. Try again with the original account.");
                }
                const subject = payload.sub;
                const savedTokens = makeTokens(tokens, tokens.id_token);
                if (hasPlan(savedTokens) && !savedTokens.refreshToken) {
                    throw new ChatGPTConnectionError("OpenAI did not return a renewable connection. Try signing in again.");
                }
                await serialized(async () => {
                    if (attempt.status !== "pending") throw new ChatGPTConnectionError("This sign-in has ended. Try again.");
                    clearTimeout(timeout);
                    await writeRegistration(userId, {
                        clientId, subject, email: typeof payload.email === "string" ? payload.email : undefined,
                        tokens: savedTokens,
                    });
                    finish();
                });
                send(200, "ChatGPT sign-in complete. You can close this tab and return to Navigator.");
            } catch (error) {
                finish(error instanceof ChatGPTConnectionError ? error.message : "Navigator could not verify the ChatGPT sign-in. Try again.");
                send(400, "ChatGPT sign-in could not be completed. Return to Navigator to try again.");
            }
        });
        listener.requestTimeout = 15_000;
        listener.keepAliveTimeout = 1_000;
        try {
            await new Promise<void>((resolve, reject) => {
                listener.once("error", reject);
                listener.listen(0, "127.0.0.1", () => resolve());
            });
        } catch {
            finish("Navigator could not start the local sign-in listener.");
            throw new ChatGPTConnectionError(attempt.error!, 500);
        }
        const address = listener.address();
        if (!address || typeof address === "string") {
            finish("Navigator could not start the local sign-in listener.");
            throw new ChatGPTConnectionError(attempt.error!, 500);
        }
        const callbackUri = `http://127.0.0.1:${address.port}${callbackPath}`;
        state.attempts.set(userId, attempt);
        const url = new URL("/api/accounts/authorize", issuer);
        url.search = new URLSearchParams({
            client_id: registration?.clientId ?? "dynamic_agent_client",
            ...(registration ? { ...(registration.email ? { login_hint: registration.email } : {}),
                ...(registration.tokens && !hasPlan(registration.tokens) ? { prompt: "consent" } : {}) }
                : { agent_name_hint: "Navigator" }),
            ext_agent_host_id: extAgentHostId, response_type: "code", redirect_uri: callbackUri,
            resource: CHATGPT_RESOURCE, scope: requestedScopes, state: stateValue, nonce,
            code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        }).toString();
        return { attemptId: attempt.id, url: url.href };
    });
}

export function cancelChatGPTSignIn(userId: string, attemptId: string) {
    return serialized(async () => {
        const attempt = state.attempts.get(userId);
        if (attempt?.id === attemptId) attempt.cancel();
    });
}

async function revokeChatGPTSession(registration: Registration) {
    const token = registration.tokens?.refreshToken;
    if (!token) return true;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const metadata = await fetch(`${issuer}/.well-known/openid-configuration`, {
                redirect: "error", cache: "no-store", signal: AbortSignal.timeout(3_000),
            });
            if (metadata.ok) {
                const endpoint = new URL(z.object({ revocation_endpoint: z.url() }).parse(await metadata.json()).revocation_endpoint);
                if (endpoint.origin !== issuer || endpoint.username || endpoint.password) return false;
                const response = await fetch(endpoint, {
                    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(4_000),
                    body: new URLSearchParams({ token, token_type_hint: "refresh_token", client_id: registration.clientId }),
                });
                if (response.status === 200) return true;
                if (response.status < 500) return false;
            } else if (metadata.status < 500) return false;
        } catch { /* Retry a transient connection failure once. */ }
        if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 300));
    }
    return false;
}

export function signOutChatGPT(userId: string, forget: boolean) {
    return serialized(async () => {
        state.attempts.get(userId)?.cancel();
        const registration = await readRegistration(userId);
        if (!registration) return true;
        const revoked = await revokeChatGPTSession(registration);
        if (forget) await rm(join(await connectionDirectory(), `${recordName(userId)}.jwe`), { force: true });
        else await writeRegistration(userId, { ...registration, tokens: undefined });
        return revoked;
    });
}

export function chatGPTCredential(userId: string, expectedSessionId?: string) {
    return serialized(async () => {
        const registration = await readRegistration(userId);
        const tokens = registration?.tokens;
        if (!registration || !tokens) throw new ChatGPTConnectionError("Sign in to ChatGPT in Settings to use your plan.", 401);
        if (expectedSessionId && tokens.sessionId !== expectedSessionId) {
            throw new ChatGPTConnectionError("The ChatGPT connection changed. Send your message again.", 409);
        }
        if (!hasPlan(tokens)) throw new ChatGPTConnectionError("Enable ChatGPT plan usage in Settings to continue.", 403);
        if (tokens.expiresAt > Date.now() + 60_000) return tokens;
        if (!tokens.refreshToken) throw new ChatGPTConnectionError("Reconnect ChatGPT in Settings to continue.", 401);
        const result = await oauthToken({
            grant_type: "refresh_token", client_id: registration.clientId, refresh_token: tokens.refreshToken,
        }).catch(() => {
            throw new ChatGPTConnectionError("ChatGPT could not renew your connection. Try again shortly.", 503);
        });
        if (!result.tokens?.refresh_token) {
            if (result.error && terminalRefreshErrors.has(result.error)) {
                await writeRegistration(userId, { ...registration, tokens: undefined });
                throw new ChatGPTConnectionError("Your ChatGPT connection has expired. Reconnect in Settings.", 401);
            }
            throw new ChatGPTConnectionError("ChatGPT could not renew your connection. Try again shortly.", 503);
        }
        const updated = makeTokens(result.tokens, tokens.idToken, tokens.sessionId, tokens.scopes);
        await writeRegistration(userId, { ...registration, tokens: updated });
        if (!hasPlan(updated)) throw new ChatGPTConnectionError("Enable ChatGPT plan usage in Settings to continue.", 403);
        return updated;
    });
}

export async function listChatGPTModels(token: string) {
    const response = await fetch(`${CHATGPT_RESOURCE}/models`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    }).catch(() => { throw new ChatGPTConnectionError("Could not load ChatGPT models. Try again shortly.", 503); });
    if (!response.ok) throw new ChatGPTConnectionError(chatGPTServiceMessage(response.status), response.status);
    try {
        const { models } = modelCatalog.parse(await response.json());
        return models.filter(model => model.visibility === "list" && model.slug && model.display_name)
            .map(model => ({ id: model.slug, name: model.display_name }));
    } catch {
        throw new ChatGPTConnectionError("ChatGPT returned an invalid model list.", 502);
    }
}

export function chatGPTServiceMessage(status?: number, errorCode?: string) {
    if (status === 429 || errorCode === "subscription_sharing_usage_limit_exceeded") return "ChatGPT usage limit reached. Review your limits in ChatGPT usage settings.";
    if (status === 401 || errorCode === "subscription_sharing_invalid_user") return "ChatGPT rejected this connection. Reconnect in Settings.";
    if (status === 403 || errorCode === "subscription_sharing_user_not_eligible") return "ChatGPT plan access is unavailable for this account or workspace.";
    if (status === 503 || errorCode === "subscription_sharing_usage_unavailable") return "ChatGPT plan usage is temporarily unavailable. Try again shortly.";
    if (errorCode === "subscription_sharing_unsupported_capability") return "This model cannot complete that request with your ChatGPT plan. Try another model.";
    return "ChatGPT could not complete the request. Try again or choose another model in Settings.";
}
