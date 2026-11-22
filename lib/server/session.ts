import "server-only";

import { EncryptJWT, jwtDecrypt } from "jose";
import type { StremioUser } from "@/types/stremio";

export const SESSION_COOKIE = "stremio-auth";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const STREMIO_LINK_COOKIE = "navigator-stremio-link";
export type SessionUser = Pick<StremioUser, "_id" | "email" | "avatar">;
export type Session = { authKey: string; user: SessionUser; issuedAt: number };

export function isLocalDesktopServer() {
    return process.env.NAVIGATOR_DESKTOP === "1" && process.env.HOSTNAME === "127.0.0.1";
}

export async function localSettingsDirectory(desktop: boolean) {
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const base = process.platform === "win32" ? process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
        : process.platform === "darwin" ? join(homedir(), "Library", "Application Support")
            : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
    return join(base, desktop ? "Navigator Desktop" : "Navigator Development");
}

let localKey: Promise<Uint8Array> | undefined;

/** Hosted replicas share an explicit secret; local apps keep theirs outside the bundle/repo. */
export async function sessionKey(): Promise<Uint8Array> {
    const configured = process.env.NAVIGATOR_SESSION_SECRET?.trim();
    if (configured) {
        if (!/^[a-f\d]{64}$/i.test(configured)) throw new Error("NAVIGATOR_SESSION_SECRET must contain 64 hexadecimal characters.");
        return Uint8Array.from(configured.match(/../g)!, byte => parseInt(byte, 16));
    }
    const desktop = isLocalDesktopServer();
    if (process.env.NODE_ENV === "production" && !desktop) {
        throw new Error("Set NAVIGATOR_SESSION_SECRET before accepting hosted sign-ins.");
    }
    return localKey ??= (async () => {
        const fs = await import("node:fs/promises");
        const { join } = await import("node:path");
        const directory = await localSettingsDirectory(desktop);
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const path = join(directory, "session.key");
        const key = crypto.getRandomValues(new Uint8Array(32));
        try { await fs.writeFile(path, key, { flag: "wx", mode: 0o600 }); }
        catch (error) { if ((error as { code?: string }).code !== "EEXIST") throw error; }
        // A concurrent Next worker may still be finishing its exclusive creation.
        for (let attempt = 0; attempt < 4; attempt++) {
            const stat = await fs.lstat(path);
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid local session key file.");
            const saved = await fs.readFile(path);
            if (saved.length === 32) return new Uint8Array(saved);
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error("Invalid local session key length.");
    })();
}

export function publicUser(user: StremioUser): SessionUser {
    return { _id: user._id, email: user.email, ...(typeof user.avatar === "string" ? { avatar: user.avatar } : {}) };
}

export async function createSession(authKey: string, user: StremioUser): Promise<string> {
    if (typeof authKey !== "string" || !authKey || authKey.length > 1024
        || typeof user?._id !== "string" || !user._id || typeof user.email !== "string") throw new Error("Invalid authentication response.");
    return new EncryptJWT({ authKey, user: publicUser(user) })
        .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "JWT" })
        .setIssuer("navigator").setAudience("navigator-session").setSubject(user._id)
        .setIssuedAt().setExpirationTime(`${SESSION_SECONDS}s`).encrypt(await sessionKey());
}

export async function readSession(value: string | undefined): Promise<Session | null> {
    // Legacy JSON cookies never establish a session and are deliberately not migrated by trust.
    if (!value || value.length > 4096 || value.split(".").length !== 5) return null;
    const key = await sessionKey();
    try {
        const { payload } = await jwtDecrypt(value, key, {
            issuer: "navigator", audience: "navigator-session", keyManagementAlgorithms: ["dir"],
            contentEncryptionAlgorithms: ["A256GCM"], requiredClaims: ["exp", "iat", "sub"], maxTokenAge: `${SESSION_SECONDS}s`,
        });
        const user = payload.user as SessionUser | undefined;
        if (typeof payload.authKey !== "string" || !payload.authKey || payload.authKey.length > 1024
            || !user || typeof user._id !== "string" || !user._id || user._id !== payload.sub
            || typeof user.email !== "string" || typeof payload.iat !== "number") return null;
        return { authKey: payload.authKey, user: publicUser(user), issuedAt: payload.iat * 1000 };
    } catch { return null; }
}

/** Pairing state is short-lived, encrypted, and bound to this browser. It is
 * never accepted as a Navigator session or returned as a Stremio credential. */
export async function sealStremioLink(code: string, attempt: string): Promise<string> {
    return new EncryptJWT({ code })
        .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "JWT" })
        .setIssuer("navigator").setAudience("navigator-stremio-link").setSubject(attempt)
        .setIssuedAt().setExpirationTime("5m").encrypt(await sessionKey());
}

export async function readStremioLink(value: string | undefined, attempt: string): Promise<string | null> {
    if (!value || value.length > 4096 || typeof attempt !== "string" || attempt.length > 64) return null;
    try {
        const { payload } = await jwtDecrypt(value, await sessionKey(), {
            issuer: "navigator", audience: "navigator-stremio-link", subject: attempt,
            keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"],
            requiredClaims: ["exp", "iat", "sub"], maxTokenAge: "5m",
        });
        return typeof payload.code === "string" && /^[a-zA-Z0-9_-]{4,128}$/.test(payload.code) ? payload.code : null;
    } catch { return null; }
}
