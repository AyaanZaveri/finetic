import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { windowsPowerShellEnvironment } from "./package-windows.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const WINSPARKLE_VERSION = "0.9.4";
export const WINSPARKLE_SHA256 = "6037df37fc263bd1650a1c4949681a9d40ffe991d01f35892a406cb5d103c976";
export const WINSPARKLE_DLL_SHA256 = "9b43b1c16ee39fb9a91b5bd75138767898779510e0836be2919250607cdbe8ab";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export async function fetchWinSparkle() {
    if (process.platform !== "win32" || process.arch !== "x64") throw new Error("WinSparkle packaging requires Windows x64");
    const directory = join(root, "desktop/vendor/winsparkle");
    const dll = join(directory, "WinSparkle.dll");
    if (await readFile(dll).then(bytes => digest(bytes) === WINSPARKLE_DLL_SHA256, () => false)) return directory;
    const bytes = process.env.NAVIGATOR_WINSPARKLE_ARCHIVE
        ? await readFile(process.env.NAVIGATOR_WINSPARKLE_ARCHIVE)
        : await (async () => {
            const response = await fetch(`https://github.com/vslavik/winsparkle/releases/download/v${WINSPARKLE_VERSION}/WinSparkle-${WINSPARKLE_VERSION}.zip`, { signal: AbortSignal.timeout(120000) });
            if (!response.ok) throw new Error(`WinSparkle download failed: HTTP ${response.status}`);
            return Buffer.from(await response.arrayBuffer());
        })();
    if (digest(bytes) !== WINSPARKLE_SHA256) throw new Error("WinSparkle archive checksum mismatch");
    const temp = await mkdtemp(join(tmpdir(), "navigator-winsparkle-"));
    try {
        await writeFile(join(temp, "archive.zip"), bytes);
        await new Promise((resolve, reject) => {
            const script = "$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath $env:NAV_ARCHIVE -DestinationPath $env:NAV_EXTRACT -Force";
            const env = windowsPowerShellEnvironment({ ...process.env, NAV_ARCHIVE: join(temp, "archive.zip"), NAV_EXTRACT: join(temp, "extracted") });
            const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "inherit", env });
            child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error("WinSparkle extraction failed")));
        });
        const source = join(temp, "extracted", `WinSparkle-${WINSPARKLE_VERSION}`);
        const content = await readFile(join(source, "x64/Release/WinSparkle.dll"));
        if (digest(content) !== WINSPARKLE_DLL_SHA256) throw new Error("WinSparkle DLL checksum mismatch");
        await mkdir(directory, { recursive: true });
        await writeFile(dll, content);
        for (const name of ["COPYING", "COPYING.expat"]) await cp(join(source, name), join(directory, name));
    } finally { await rm(temp, { recursive: true, force: true }); }
    return directory;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    fetchWinSparkle().then(path => console.log(`Verified WinSparkle ${WINSPARKLE_VERSION}: ${path}`)).catch(error => { console.error(error); process.exitCode = 1; });
}
