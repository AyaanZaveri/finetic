import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SPARKLE_VERSION = "2.10.1";
export const SPARKLE_SHA256 = "1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27";
const binaryHash = "9c78b2046e7637efeb8ca505d63170bc1557651925dbbfd45ac236845732b05a";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export async function fetchSparkle() {
    if (process.platform !== "darwin") throw new Error("Sparkle packaging requires macOS");
    const directory = join(root, `desktop/vendor/sparkle-${SPARKLE_VERSION}`);
    // Re-extract the verified archive, including tools and nested helpers. A
    // cached main binary alone cannot authenticate the rest of the SDK.
    const cached = await readFile(join(directory, "archive.tar.xz")).catch(() => null);
    const bytes = process.env.NAVIGATOR_SPARKLE_ARCHIVE ? await readFile(process.env.NAVIGATOR_SPARKLE_ARCHIVE) : cached || await (async () => {
        const response = await fetch(`https://github.com/sparkle-project/Sparkle/releases/download/${SPARKLE_VERSION}/Sparkle-${SPARKLE_VERSION}.tar.xz`, { signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw new Error(`Sparkle download failed: HTTP ${response.status}`);
        return Buffer.from(await response.arrayBuffer());
    })();
    if (digest(bytes) !== SPARKLE_SHA256) throw new Error("Sparkle archive checksum mismatch");
    const temp = await mkdtemp(join(tmpdir(), "navigator-sparkle-"));
    try {
        const archive = join(temp, "archive.tar.xz");
        await writeFile(archive, bytes);
        await exec("tar", ["-xf", archive, "-C", temp, "./Sparkle.framework", "./bin/generate_keys", "./bin/sign_update", "./bin/BinaryDelta", "./LICENSE"]);
        if (digest(await readFile(join(temp, "Sparkle.framework/Versions/B/Sparkle"))) !== binaryHash) throw new Error("Sparkle framework checksum mismatch");
        await rm(directory, { recursive: true, force: true });
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "archive.tar.xz"), bytes);
        for (const name of ["Sparkle.framework", "bin", "LICENSE"]) await cp(join(temp, name), join(directory, name), { recursive: true, dereference: false, verbatimSymlinks: true });
    } finally { await rm(temp, { recursive: true, force: true }); }
    return directory;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    fetchSparkle().then(path => console.log(`Verified Sparkle ${SPARKLE_VERSION}: ${path}`)).catch(error => { console.error(error); process.exitCode = 1; });
}
