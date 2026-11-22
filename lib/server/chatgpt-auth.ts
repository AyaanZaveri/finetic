import "server-only";

import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { OPENAI_DEFAULT_BASE_URL } from "@/lib/models-dev";

const issuer = "https://auth.openai.com";
const jwks = createRemoteJWKSet(new URL("/.well-known/jwks.json", issuer));
const callbackPath = "/auth/callback";
const planScope = "chatgpt.tokens.use.direct";
const scopes = `openid profile email offline_access resource.invoke ${planScope}`;
const random = () => randomBytes(32).toString("base64url");

type Tokens = { accessToken: string; refreshToken: string; expiresAt: number; scope: string; idToken?: string };
type Account = { clientId: string; subject: string; label: string; tokens?: Tokens; model?: string };
type Profile = { hostId: string; active?: string; enabled: boolean; accounts: Account[] };
type Attempt = { close: () => void; status: "pending" | "failed" | "done"; message?: string };
type TokenResponse = { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number; scope?: string; token_type?: string; error?: string };

const runtime = globalThis as typeof globalThis & {
    navigatorChatGPT?: { queues: Map<string, Promise<unknown>>; attempts: Map<string, Attempt> };
};
const { queues, attempts } = runtime.navigatorChatGPT ??= { queues: new Map(), attempts: new Map() };

export class ChatGPTAuthError extends Error {
    readonly status: number;

    constructor(message: string, status = 409) {
        super(message);
        this.status = status;
    }
}

export function localChatGPTAvailable(req: Request) {
    const port = process.env.PORT;
    return process.env.NAVIGATOR_DESKTOP === "1" && process.env.HOSTNAME === "127.0.0.1"
        && !!port && req.headers.get("host") === `127.0.0.1:${port}`
        && (!req.headers.has("origin") || req.headers.get("origin") === `http://127.0.0.1:${port}`);
}

function profilePath(user: string) {
    const base = process.platform === "win32" ? process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
        : process.platform === "darwin" ? join(homedir(), "Library", "Application Support")
            : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
    const directory = join(base, "Navigator Desktop", "chatgpt");
    return { directory, path: join(directory, `${createHash("sha256").update(user).digest("hex")}.json`) };
}

async function readProfile(user: string): Promise<Profile | undefined> {
    try {
        return JSON.parse(await readFile(profilePath(user).path, "utf8")) as Profile;
    } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return undefined;
        throw error;
    }
}

async function saveProfile(user: string, profile: Profile) {
    const { directory, path } = profilePath(user);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, JSON.stringify(profile), { mode: 0o600, flag: "wx" });
        await rename(temporary, path);
    } finally {
        await rm(temporary, { force: true });
    }
}

async function serialize<T>(user: string, operation: () => Promise<T>) {
    const next = (queues.get(user) ?? Promise.resolve()).catch(() => undefined).then(operation);
    queues.set(user, next);
    try { return await next; }
    finally { if (queues.get(user) === next) queues.delete(user); }
}

function activeAccount(profile?: Profile) {
    return profile?.accounts.find(account => account.clientId === profile.active);
}

const hasPlan = (tokens?: Tokens) => !!tokens?.scope.split(/\s+/).includes(planScope);

async function exchange(parameters: Record<string, string>) {
    const response = await fetch(`${issuer}/api/accounts/oauth/token`, {
        method: "POST",
        body: new URLSearchParams({ ...parameters, resource: OPENAI_DEFAULT_BASE_URL }),
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({})) as TokenResponse;
    return { ok: response.ok, body };
}

function tokenSet(body: TokenResponse, previous?: Tokens): Tokens | undefined {
    if (body.token_type?.toLowerCase() !== "bearer" || !body.access_token || !body.refresh_token
        || typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || !(body.expires_in > 0)) return undefined;
    return {
        accessToken: body.access_token, refreshToken: body.refresh_token,
        expiresAt: Date.now() + body.expires_in * 1000, scope: body.scope ?? previous?.scope ?? "",
        idToken: previous?.idToken,
    };
}

function openBrowser(url: string) {
    const [command, ...args] = process.platform === "darwin" ? ["/usr/bin/open", url]
        : process.platform === "win32" ? [join(process.env.SystemRoot || "C:\\Windows", "explorer.exe"), url]
            : ["xdg-open", url];
    return new Promise<void>((resolve, reject) => {
        execFile(command, args, { windowsHide: true, timeout: 15_000 }, error => {
            // Explorer can exit with code 1 after handing the URL to the browser.
            if (!error || (process.platform === "win32" && error.code === 1)) resolve();
            else reject(new ChatGPTAuthError("Couldn’t open the system browser. Try signing in again."));
        });
    });
}

export async function startChatGPTSignIn(user: string, clientId?: string) {
    await serialize(user, async () => {
        const profile = await readProfile(user) ?? { hostId: `urn:uuid:${randomUUID()}`, enabled: false, accounts: [] };
        const saved = profile.accounts.find(account => account.clientId === clientId);
        if (clientId && !saved) throw new ChatGPTAuthError("This ChatGPT registration is unavailable.");
        await saveProfile(user, profile);

        const state = random(), nonce = random(), verifier = random();
        const finish = (status: "failed" | "done", message?: string) => {
            attempt.status = status;
            attempt.message = message;
            attempt.close();
        };
        const server = createServer(async (request, response) => {
            let url: URL;
            try { url = new URL(request.url || "/", redirectUri); }
            catch { response.writeHead(400).end(); return; }
            if (request.method !== "GET" || url.pathname !== callbackPath ||
                request.headers.host !== new URL(redirectUri).host ||
                url.searchParams.getAll("state").length !== 1 || url.searchParams.get("state") !== state) {
                response.writeHead(404).end();
                return;
            }
            if (attempt.status !== "pending" || accepted) {
                response.writeHead(409).end();
                return;
            }
            accepted = true;
            let completed = false;
            try {
                await serialize(user, async () => {
                    if (attempts.get(user) !== attempt || attempt.status !== "pending") throw new ChatGPTAuthError("Sign-in expired.");
                    if (url.searchParams.has("error")) throw new ChatGPTAuthError("ChatGPT sign-in was declined or canceled.");
                    const returnedClient = url.searchParams.get("client_id");
                    const issuedClient = saved?.clientId ?? returnedClient;
                    const code = url.searchParams.get("code");
                    if (!code || !issuedClient || !/^oaiapp_[\w-]+$/.test(issuedClient)
                        || (returnedClient && returnedClient !== issuedClient)) throw new ChatGPTAuthError("ChatGPT returned an incomplete sign-in.");
                    const { ok, body } = await exchange({
                        grant_type: "authorization_code", client_id: issuedClient, code,
                        code_verifier: verifier, redirect_uri: redirectUri,
                    });
                    if (!ok || !body.id_token) throw new ChatGPTAuthError("ChatGPT couldn’t complete sign-in. Try again.");
                    const { payload } = await jwtVerify(body.id_token, jwks, {
                        issuer, audience: issuedClient, requiredClaims: ["sub", "exp", "iat", "nonce"], clockTolerance: 5,
                    });
                    if (payload.nonce !== nonce || !payload.sub || (saved && saved.subject !== payload.sub)) {
                        throw new ChatGPTAuthError("ChatGPT returned a different identity. Try signing in again.");
                    }
                    const tokens = tokenSet(body);
                    if (!tokens && body.scope?.split(/\s+/).includes(planScope)) {
                        throw new ChatGPTAuthError("ChatGPT returned an incomplete renewable session.");
                    }
                    if (tokens) tokens.idToken = body.id_token;
                    const current = await readProfile(user) ?? profile;
                    const existing = current.accounts.find(account => account.clientId === issuedClient);
                    if (existing && existing.subject !== payload.sub) throw new ChatGPTAuthError("ChatGPT returned a different identity.");
                    if (attempt.status !== "pending") throw new ChatGPTAuthError("Sign-in expired.");
                    const label = typeof payload.email === "string" && payload.email_verified === true ? payload.email : "ChatGPT account";
                    const account = { clientId: issuedClient, subject: payload.sub, label, tokens, model: existing?.model };
                    if (existing) current.accounts[current.accounts.indexOf(existing)] = account;
                    else current.accounts.push(account);
                    current.active = issuedClient;
                    current.enabled = true;
                    await saveProfile(user, current);
                    completed = true;
                    finish("done");
                });
            } catch (error) {
                finish("failed", error instanceof ChatGPTAuthError ? error.message : "ChatGPT sign-in couldn’t be verified. Try again.");
            }
            response.writeHead(200, {
                "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
            }).end(completed ? "ChatGPT sign-in complete. Return to Navigator." : "ChatGPT sign-in failed. Return to Navigator to retry.");
        });
        let accepted = false;
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();
        if (!address || typeof address === "string") {
            server.close();
            throw new ChatGPTAuthError("Couldn’t start the ChatGPT sign-in listener.");
        }
        const redirectUri = `http://127.0.0.1:${address.port}${callbackPath}`;
        const attempt: Attempt = { status: "pending", close: () => { clearTimeout(timeout); server.close(); } };
        attempts.get(user)?.close();
        attempts.set(user, attempt);
        const timeout = setTimeout(() => finish("failed", "ChatGPT sign-in timed out. Try again."), 5 * 60_000);
        timeout.unref();
        server.requestTimeout = 20_000;
        server.headersTimeout = 10_000;

        const url = new URL("/api/accounts/authorize", issuer);
        url.search = new URLSearchParams({
            client_id: saved?.clientId ?? "dynamic_agent_client",
            ...(!saved ? { agent_name_hint: "Navigator" } : {}),
            ...(saved && !hasPlan(saved.tokens) ? { prompt: "consent" } : {}),
            ext_agent_host_id: profile.hostId, response_type: "code", redirect_uri: redirectUri,
            scope: scopes, resource: OPENAI_DEFAULT_BASE_URL, state, nonce, code_challenge_method: "S256",
            code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        }).toString();
        try { await openBrowser(url.toString()); }
        catch (error) {
            finish("failed", "Couldn’t open the system browser. Try signing in again.");
            throw error;
        }
    });
}

export async function chatGPTStatus(user: string) {
    const profile = await readProfile(user);
    const account = activeAccount(profile);
    const attempt = attempts.get(user);
    return {
        available: true, enabled: profile?.enabled ?? false, active: account?.clientId,
        model: account?.model, pending: attempt?.status === "pending",
        error: attempt?.status === "failed" ? attempt.message : undefined,
        accounts: profile?.accounts.map(({ clientId, label, tokens }) => ({ clientId, label, connected: hasPlan(tokens) })) ?? [],
    };
}

export async function updateChatGPT(user: string, update: { enabled?: boolean; active?: string; model?: string; modelAccount?: string; signOut?: boolean }) {
    return serialize(user, async () => {
        const profile = await readProfile(user);
        if (!profile) throw new ChatGPTAuthError("Sign in with ChatGPT first.");
        if (update.active !== undefined) {
            if (!profile.accounts.some(account => account.clientId === update.active)) throw new ChatGPTAuthError("ChatGPT account not found.");
            profile.active = update.active;
            profile.enabled = true;
        }
        if (update.enabled !== undefined) profile.enabled = update.enabled;
        const account = activeAccount(profile);
        if (update.model !== undefined) {
            if (!account || account.clientId !== update.modelAccount || !profile.enabled || !hasPlan(account.tokens)) {
                throw new ChatGPTAuthError("The selected ChatGPT account changed.");
            }
            account.model = update.model;
        }
        let revocationConfirmed = true;
        if (update.signOut && account) {
            const tokens = account.tokens;
            delete account.tokens;
            await saveProfile(user, profile);
            if (tokens) revocationConfirmed = await revoke(account.clientId, tokens.refreshToken);
        } else {
            await saveProfile(user, profile);
        }
        return { ...await chatGPTStatus(user), revocationConfirmed };
    });
}

async function revoke(clientId: string, token: string) {
    try {
        const discovery = await fetch(`${issuer}/.well-known/openid-configuration`, {
            cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000),
        });
        const endpoint = new URL((await discovery.json()).revocation_endpoint);
        if (!discovery.ok || endpoint.origin !== issuer) return false;
        const response = await fetch(endpoint, {
            method: "POST", body: new URLSearchParams({ client_id: clientId, token, token_type_hint: "refresh_token" }),
            cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000),
        });
        await response.body?.cancel();
        return response.ok;
    } catch { return false; }
}

export async function chatGPTCredentials(user: string) {
    return serialize(user, async () => {
        const profile = await readProfile(user);
        if (!profile?.enabled) return null;
        const account = activeAccount(profile);
        if (!account?.tokens || !hasPlan(account.tokens)) throw new ChatGPTAuthError("Connect an eligible ChatGPT plan in Settings.");
        if (account.tokens.expiresAt < Date.now() + 60_000) {
            const { ok, body } = await exchange({
                grant_type: "refresh_token", client_id: account.clientId, refresh_token: account.tokens.refreshToken,
            });
            if (!ok) {
                if (["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired",
                    "refresh_token_invalidated", "refresh_token_reused"].includes(body.error ?? "")) {
                    delete account.tokens;
                    await saveProfile(user, profile);
                    throw new ChatGPTAuthError("Your ChatGPT session expired. Sign in again in Settings.");
                }
                throw new ChatGPTAuthError("ChatGPT couldn’t renew your session. Try again shortly.", 502);
            }
            const replacement = tokenSet(body, account.tokens);
            if (!replacement) throw new ChatGPTAuthError("ChatGPT returned an incomplete session renewal. Reconnect in Settings.", 502);
            account.tokens = replacement;
            await saveProfile(user, profile);
            if (!hasPlan(account.tokens)) throw new ChatGPTAuthError("Sign in with ChatGPT again in Settings.");
        }
        return { accessToken: account.tokens.accessToken, model: account.model, clientId: account.clientId };
    });
}
