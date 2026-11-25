"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cookieRequiresHttps } from "@/lib/cookie-policy";
import { getAuthData } from "@/lib/server/auth";
import { createSession, readSession, publicUser, SESSION_COOKIE, SESSION_SECONDS, STREMIO_LINK_COOKIE, sealStremioLink, readStremioLink, type SessionUser } from "@/lib/server/session";
import type {
  StremioAuthData,
  StremioAddon,
} from "@/types/stremio";

const STREMIO_API = "https://api.strem.io/api";
const ADDON_COLLECTION_CACHE_TTL_MS = 30_000;
let addonCollectionGeneration = 0;

let addonCollectionCache:
  | {
      authKey: string;
      expiresAt: number;
      addons: StremioAddon[];
    }
  | null = null;
let addonCollectionRequest:
  | {
      authKey: string;
      promise: Promise<StremioAddon[]>;
    }
  | null = null;

// ─── Cookie Helpers ──────────────────────────────────────────────

async function setAuthCookie(data: StremioAuthData) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, await createSession(data.authKey, data.user), {
    path: "/",
    maxAge: SESSION_SECONDS,
    sameSite: "lax",
    secure: cookieRequiresHttps(),
    httpOnly: true,
  });
}

// ─── Authentication ──────────────────────────────────────────────

/** Official Stremio device linking supplies the provider-button flow without
 * inventing a third-party OAuth endpoint or exposing an authKey to JavaScript. */
export async function startStremioSignIn() {
  try {
    const response = await fetch("https://link.stremio.com/api/create?type=Create", {
      cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Pairing unavailable");
    const data = await response.json();
    const code = data.result?.code;
    if (typeof code !== "string" || !/^[a-zA-Z0-9_-]{4,128}$/.test(code)) throw new Error("Invalid pairing response");
    const attempt = crypto.randomUUID();
    (await cookies()).set(STREMIO_LINK_COOKIE, await sealStremioLink(code, attempt), {
      path: "/", maxAge: 300, httpOnly: true, sameSite: "lax", secure: cookieRequiresHttps(),
    });
    return { success: true as const, attempt, link: `https://link.stremio.com/${encodeURIComponent(code)}`, expiresAt: Date.now() + 300_000 };
  } catch {
    return { success: false as const, error: "Couldn’t open Stremio. Try again or use your email and password." };
  }
}

export async function finishStremioSignIn(attempt: string) {
  const jar = await cookies();
  const code = await readStremioLink(jar.get(STREMIO_LINK_COOKIE)?.value, attempt);
  if (!code) return { status: "expired" as const };
  try {
    const response = await fetch(`https://link.stremio.com/api/read?type=Read&code=${encodeURIComponent(code)}`, {
      cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { status: "pending" as const };
    const data = await response.json();
    const authKey = data.result?.authKey;
    // The official service returns error 101 until an account approves the link.
    if (typeof authKey !== "string" || !authKey || authKey.length > 1024) return { status: "pending" as const };
    const userResponse = await fetch(`${STREMIO_API}/getUser`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "GetUser", authKey }),
      cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(8000),
    });
    if (!userResponse.ok) return { status: "pending" as const };
    const userData = await userResponse.json();
    const user = userData.result?.user ?? userData.result;
    await setAuthCookie({ authKey, user, timestamp: Date.now() });
    jar.delete(STREMIO_LINK_COOKIE);
    return { status: "signed-in" as const };
  } catch { return { status: "pending" as const }; }
}

export async function authenticateUser(
  email: string,
  password: string
): Promise<boolean> {
  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || email.length > 320 || !password || password.length > 4096) return false;
  try {
    const response = await fetch(`${STREMIO_API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, facebook: false }),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error("Stremio login HTTP error:", response.status);
      return false;
    }

    const data = await response.json();

    if (data.result?.authKey && data.result?.user) {
      const authData: StremioAuthData = {
        authKey: data.result.authKey,
        user: data.result.user,
        timestamp: Date.now(),
      };
      await setAuthCookie(authData);
      return true;
    }

    console.error("Stremio rejected sign-in.");
    return false;
  } catch (error) {
    console.error("Authentication failed:", error);
    return false;
  }
}

export async function endSession() {
  const cookieStore = await cookies();

  try {
    const session = await readSession(cookieStore.get(SESSION_COOKIE)?.value);
    if (session) {
      await fetch(`${STREMIO_API}/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authKey: session.authKey }),
        cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }
  } catch {
    // Ignore cleanup errors
  }

  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(STREMIO_LINK_COOKIE);
  addonCollectionCache = null;
  addonCollectionRequest = null;
}

export async function logout() {
  await endSession();
  redirect("/");
}

export async function getUser(): Promise<SessionUser | null> {
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  return session ? publicUser(session.user) : null;
}

export async function isAuthenticated(): Promise<boolean> {
  const user = await getUser();
  return !!user;
}

// ─── Addon Collection ────────────────────────────────────────────

export async function getInstalledAddons(throwOnError = false): Promise<StremioAddon[]> {
  try {
    const { authKey } = await getAuthData();
    const now = Date.now();

    if (
      addonCollectionCache?.authKey === authKey &&
      addonCollectionCache.expiresAt > now
    ) {
      return addonCollectionCache.addons;
    }

    if (addonCollectionRequest?.authKey === authKey) {
      return await addonCollectionRequest.promise;
    }

    const generation = addonCollectionGeneration;
    const promise = (async () => {
      const response = await fetch(`${STREMIO_API}/addonCollectionGet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "AddonCollectionGet", authKey, update: true }),
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        throw new Error(`Add-on collection unavailable (${response.status})`);
      }

      const data = await response.json();
      const addons = data.result?.addons;
      if (!Array.isArray(addons)) throw new Error("Invalid add-on collection response");
      if (generation === addonCollectionGeneration) addonCollectionCache = {
        authKey,
        expiresAt: Date.now() + ADDON_COLLECTION_CACHE_TTL_MS,
        addons,
      };
      return addons;
    })();

    const request = { authKey, promise };
    addonCollectionRequest = request;

    try {
      return await promise;
    } finally {
      if (addonCollectionRequest === request) {
        addonCollectionRequest = null;
      }
    }
  } catch (error) {
    if (throwOnError) throw error;
    // Public title recommendations can ask for catalogs before sign-in.
    // No installed add-ons is the expected guest result, not a server error.
    if (error instanceof Error && error.message === "Not authenticated") return [];
    console.error("Failed to fetch installed addons:", error);
    return [];
  }
}

export async function invalidateAddonCollection() {
  addonCollectionGeneration += 1;
  addonCollectionCache = null;
  addonCollectionRequest = null;
}

// Server Action to clear invalid auth data
export async function clearAuthData() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  addonCollectionCache = null;
  addonCollectionRequest = null;
}
