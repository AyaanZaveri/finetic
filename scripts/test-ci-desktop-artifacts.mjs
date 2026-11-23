import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { releaseVersion, clearGeneratedAssets, verifyServer } from "./ci-desktop-artifacts.mjs";

const directory = await mkdtemp(join(tmpdir(), "navigator-ci-artifacts-"));
try {
    await mkdir(join(directory, "desktop"));
    await writeFile(join(directory, "package.json"), JSON.stringify({ version: "1.2.3" }));
    const lock = { version: "1.2.3", packages: { "": { version: "1.2.3" } } };
    await writeFile(join(directory, "package-lock.json"), JSON.stringify(lock));
    await writeFile(join(directory, "desktop/Cargo.toml"), '[package]\nname = "navigator-desktop"\nversion = "1.2.3"\n');
    await writeFile(join(directory, "desktop/Cargo.lock"), '[[package]]\nname = "navigator-desktop"\nversion = "1.2.3"\n');
    assert.equal(await releaseVersion(directory), "1.2.3");
    lock.packages[""].version = "1.2.2";
    await writeFile(join(directory, "package-lock.json"), JSON.stringify(lock));
    await assert.rejects(releaseVersion(directory), /metadata must match/);
    delete lock.packages[""];
    await writeFile(join(directory, "package-lock.json"), JSON.stringify(lock));
    await assert.rejects(releaseVersion(directory), /metadata must match/);

    for (const path of [".next", "dist", "build", "public"]) {
        await mkdir(join(directory, path));
        await writeFile(join(directory, path, "asset"), "keep source assets");
    }
    await clearGeneratedAssets(directory);
    for (const path of [".next", "dist", "build"]) await assert.rejects(access(join(directory, path)));
    assert.equal(await readFile(join(directory, "public/asset"), "utf8"), "keep source assets");

    await mkdir(join(directory, ".next/static"), { recursive: true });
    await writeFile(join(directory, "server.js"), "fixture");
    await writeFile(join(directory, ".next/static/app.js"), "fixture");
    await writeFile(join(directory, ".next/BUILD_ID"), "fixture-id\n");
    assert.equal(await verifyServer(directory, "1.2.3"), "fixture-id");
    await assert.rejects(verifyServer(directory, "1.2.4"), /version does not match/);
    await writeFile(join(directory, ".env.local"), "fixture");
    await assert.rejects(verifyServer(directory, "1.2.3"), /environment files/);
    await rm(join(directory, ".env.local"));
    await mkdir(join(directory, ".next/cache"));
    await assert.rejects(verifyServer(directory, "1.2.3"), /runtime cache/);
    await rm(join(directory, ".next/cache"), { recursive: true });
    await mkdir(join(directory, "dist/update-base"), { recursive: true });
    await assert.rejects(verifyServer(directory, "1.2.3"), /nested build output/);
    await rm(join(directory, "dist"), { recursive: true });
    await rm(join(directory, ".next/static/app.js"));
    await assert.rejects(verifyServer(directory, "1.2.3"), /static assets are missing/);
    console.log("CI package metadata, clean assets and private-file checks passed.");
} finally {
    await rm(directory, { recursive: true, force: true });
}
