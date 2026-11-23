const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, globals) {
    const context = { exports: {}, ...globals };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
        fileName: file,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, context);
    return context.exports;
}

async function run() {
    const env = { NODE_ENV: "production", NAVIGATOR_DESKTOP: "1", HOSTNAME: "127.0.0.1", TMDB_API_READ_ACCESS_TOKEN: "hosted-fallback" };
    const jar = new Map();
    const writes = [];
    const requests = [];
    const invalidated = [];
    let signedIn = true;
    let responseStatus = 200;
    let offline = false;
    const store = {
        get: (name) => jar.has(name) ? { value: jar.get(name) } : undefined,
        set: (name, value, options) => { jar.set(name, value); writes.push({ name, value, options }); },
        delete: (name) => jar.delete(name),
    };
    const globals = {
        process: { env }, AbortSignal,
        require(name) {
            if (name === "server-only") return {};
            if (name === "@/lib/server/auth") return { getAuthData: async () => { if (!signedIn) throw new Error("Not authenticated"); return { user: { _id: "fixture" } }; } };
            if (name === "next/headers") return { cookies: async () => store };
            if (name === "next/cache") return { revalidatePath: (...args) => invalidated.push(args) };
            if (name === '@/app/actions/auth' || name === '@/lib/server/auth') return { getUser: async () => signedIn ? { _id: "fixture" } : null };
            if (name === "@/lib/tmdb-credentials") return credentials;
            if (name === "@/lib/server/metadata-provider") return provider;
            if (name === "@/lib/cookie-policy") return policy;
            throw new Error(`Unexpected import: ${name}`);
        },
        async fetch(url, options) {
            requests.push({ url, options });
            if (offline) throw new Error("Offline");
            return { ok: responseStatus === 200, status: responseStatus, json: async () => ({ success: responseStatus === 200 }) };
        },
    };
    const policy = load("lib/cookie-policy.ts", globals);
    const credentials = load("lib/tmdb-credentials.ts", globals);
    const provider = load("lib/server/metadata-provider.ts", globals);
    const settings = load("app/actions/artwork-settings.ts", globals);
    assert.equal(await credentials.getTMDBToken(), undefined, "Desktop artwork must not depend on .env");
    assert.equal((await settings.getArtworkSettings()).configured, false);
    assert.equal((await settings.getArtworkSettings()).provider, "auto");
    assert.equal((await settings.saveMetadataProvider("tmdb")).success, false);
    assert.equal((await settings.saveMetadataProvider("invalid")).success, false);
    for (const bad of ["", " \n ", "bad\r\nheader", "x".repeat(2049)]) {
        assert.equal((await settings.saveArtworkToken(bad)).success, false);
    }
    assert.equal(requests.length, 0, "Invalid values must not reach TMDB");
    const saved = await settings.saveArtworkToken("  fixture-read-token  ");
    assert.equal(saved.success, true);
    assert.equal(requests[0].url, "https://api.themoviedb.org/3/authentication");
    assert.equal(requests[0].options.headers.Authorization, "Bearer fixture-read-token");
    assert.equal(requests[0].options.cache, "no-store");
    assert.equal(writes[0].options.httpOnly, true);
    assert.equal(writes[0].options.secure, false, "The native HTTP cookie must persist in WebKit");
    assert.equal(writes[0].options.sameSite, "lax");
    assert.equal(writes[0].options.path, "/");
    assert.ok(writes[0].options.maxAge >= 365 * 24 * 60 * 60);
    assert.equal(await credentials.getTMDBToken(), "fixture-read-token");
    assert.equal((await settings.saveMetadataProvider("cinemeta")).success, true);
    assert.equal((await settings.getArtworkSettings()).provider, "cinemeta");
    assert.equal(await credentials.getTMDBToken(), "fixture-read-token", "Changing the preferred provider keeps the connection");
    assert.equal((await settings.saveMetadataProvider("tmdb")).success, true);
    assert.equal((await settings.getArtworkSettings()).personal, true);
    assert.ok(!JSON.stringify(await settings.getArtworkSettings()).includes("fixture-read-token"), "Saved credentials are never returned to the client");
    responseStatus = 401;
    assert.equal((await settings.saveArtworkToken("rejected-token")).success, false);
    assert.equal(await credentials.getTMDBToken(), "fixture-read-token", "A rejected replacement must keep the existing connection");
    offline = true;
    assert.equal((await settings.saveArtworkToken("offline-token")).success, false);
    assert.equal(await credentials.getTMDBToken(), "fixture-read-token");
    offline = false;
    assert.equal((await settings.removeArtworkToken()).success, true);
    assert.equal(await credentials.getTMDBToken(), undefined);
    assert.ok(invalidated.some(([path, kind]) => path === "/" && kind === "layout"));
    delete env.NAVIGATOR_DESKTOP;
    assert.equal(await credentials.getTMDBToken(), "hosted-fallback", "Hosted sites retain existing server configuration");
    responseStatus = 200;
    assert.equal((await settings.saveArtworkToken("personal-web-token")).success, true);
    assert.equal(writes.at(-1).options.secure, true);
    assert.equal(await credentials.getTMDBToken(), "personal-web-token", "Personal credentials take precedence over shared credentials");
    signedIn = false;
    const requestCount = requests.length;
    const writeCount = writes.length;
    await assert.rejects(settings.getArtworkSettings(), /Sign in/);
    assert.equal((await settings.saveArtworkToken("unauthenticated")).success, false);
    assert.equal((await settings.removeArtworkToken()).success, false);
    assert.equal((await settings.saveMetadataProvider("auto")).success, false);
    assert.equal(requests.length, requestCount);
    assert.equal(writes.length, writeCount);
    assert.equal(await credentials.getTMDBToken(), "hosted-fallback", "Guests use the hosted key even when a previous account's token remains saved");
    console.log("Artwork credential validation, persistence, privacy, removal, and hosted fallback tests passed.");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
