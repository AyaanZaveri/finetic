import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, stat, rm, mkdir, mkdtemp, symlink, readlink, copyFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { windowsPowerShellEnvironment } from "./package-windows.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function deltaArtifacts(version, mac, files) {
    const pattern = new RegExp(`^Navigator-${version.replaceAll('.', '[.]')}-${mac ? 'macos-arm64' : 'windows-x64'}-from-[0-9]+[.][0-9]+[.][0-9]+${mac ? '[.]delta' : '-delta[.]exe'}$`);
    return files.filter(file => pattern.test(file));
}

export async function releaseVersion(directory) {
    const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    const lock = JSON.parse(await readFile(join(directory, "package-lock.json"), "utf8"));
    const cargo = await readFile(join(directory, "desktop/Cargo.toml"), "utf8");
    const cargoLock = await readFile(join(directory, "desktop/Cargo.lock"), "utf8");
    const native = /\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
    const locked = /\[\[package\]\]\s*name = "navigator-desktop"\s*version = "([^"]+)"/.exec(cargoLock)?.[1];
    if (!/^\d+\.\d+\.\d+$/.test(pkg.version) || [lock.version, lock.packages?.[""]?.version, native, locked].some(value => value !== pkg.version)) {
        throw Error("App, npm lock and Cargo version metadata must match");
    }
    return pkg.version;
}

export async function clearGeneratedAssets(directory) {
    for (const path of [".next", "dist", "build"]) await rm(join(directory, path), { recursive: true, force: true });
}

export async function verifyServer(directory, version) {
    const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    if (pkg.version !== version) throw Error("Packaged frontend version does not match");
    await stat(join(directory, "server.js"));
    if (!(await readdir(join(directory, ".next/static"))).length) throw Error("Packaged static assets are missing");
    const buildId = (await readFile(join(directory, ".next/BUILD_ID"), "utf8")).trim();
    if (!buildId) throw Error("Packaged frontend Build ID is missing");
    async function inspect(path) {
        for (const entry of await readdir(path, { withFileTypes: true })) {
            if (entry.name.startsWith(".env") || (path === join(directory, ".next") && entry.name === "cache")) {
                throw Error("Packaged server contains environment files or runtime cache");
            }
            if (entry.isDirectory()) await inspect(join(path, entry.name));
        }
    }
    await inspect(directory);
    return buildId;
}

function verifyMacApp(app, version) {
    const plist = join(app, "Contents/Info.plist");
    for (const key of ["CFBundleShortVersionString", "CFBundleVersion"]) {
        const value = execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist], { encoding: "utf8" }).trim();
        if (value !== version) throw Error(`Packaged ${key} does not match`);
    }
    execFileSync("codesign", ["--verify", "--deep", "--strict", app]);
}

async function createMacDiskImage(archive, image, version) {
    const staging = await mkdtemp(join(dirname(image), "mac-image-"));
    const files = join(staging, "files");
    const mount = join(staging, "mount");
    let mounted = false;
    try {
        await mkdir(files);
        await mkdir(mount);
        execFileSync("ditto", ["-x", "-k", archive, files]);
        verifyMacApp(join(files, "Navigator.app"), version);
        await symlink("/Applications", join(files, "Applications"));
        execFileSync("hdiutil", ["create", "-quiet", "-format", "UDZO", "-volname", `Navigator ${version}`, "-srcfolder", files, image]);
        execFileSync("hdiutil", ["verify", "-quiet", image]);
        execFileSync("hdiutil", ["attach", "-quiet", "-readonly", "-nobrowse", "-mountpoint", mount, image]);
        mounted = true;
        verifyMacApp(join(mount, "Navigator.app"), version);
        if (await readlink(join(mount, "Applications")) !== "/Applications") throw Error("Disk image Applications shortcut is invalid");
    } finally {
        if (mounted) execFileSync("hdiutil", ["detach", "-quiet", mount]);
        await rm(staging, { recursive: true, force: true });
    }
}

async function collect() {
    const version = await releaseVersion(root);
    const mac = process.platform === "darwin";
    if (!(mac && process.arch === "arm64") && !(process.platform === "win32" && process.arch === "x64")) throw Error("Unsupported release architecture");
    const bundle = join(root, "dist", `desktop-${process.platform}-${process.arch}`);
    const resources = mac ? join(bundle, "Navigator.app/Contents/Resources") : join(bundle, "resources");
    const buildId = await verifyServer(join(resources, "server"), version);
    let nativeVersion;
    if (mac) {
        const archive = join(root, "dist", `Navigator-${version}-macos-arm64.zip`);
        const image = join(root, "dist", `Navigator-${version}-macos-arm64.dmg`);
        execFileSync("unzip", ["-tq", archive]);
        await createMacDiskImage(archive, image, version);
        nativeVersion = version;
    } else {
        const command = "$v = (Get-Item -LiteralPath $env:NAVIGATOR_VERIFY_EXE).VersionInfo; @{ ProductVersion=$v.ProductVersion; FileVersion=$v.FileVersion } | ConvertTo-Json -Compress";
        const info = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")], {
            encoding: "utf8", env: windowsPowerShellEnvironment({ ...process.env, NAVIGATOR_VERIFY_EXE: join(bundle, "navigator-desktop.exe") }),
        }));
        for (const key of ["ProductVersion", "FileVersion"]) {
            if (![version, `${version}.0`].includes(info[key])) throw Error(`Packaged Windows ${key} does not match`);
        }
        nativeVersion = info.ProductVersion;
    }
    const files = mac ? [`Navigator-${version}-macos-arm64.zip`, `Navigator-${version}-macos-arm64.dmg`]
        : [`Navigator-${version}-windows-x64-setup.exe`, `Navigator-${version}-windows-x64-portable.zip`];
    files.push(...deltaArtifacts(version, mac, await readdir(join(root, 'dist'))));
    const destination = join(root, "dist/artifacts");
    await mkdir(destination, { recursive: true });
    const hashes = [];
    for (const file of files) {
        const bytes = await readFile(join(root, "dist", file));
        if (!bytes.length) throw Error(`Empty artifact: ${file}`);
        hashes.push(`${createHash("sha256").update(bytes).digest("hex")}  ${file}`);
        await copyFile(join(root, "dist", file), join(destination, file));
    }
    const manifest = { version, nativeVersion, buildId, repository: process.env.GITHUB_REPOSITORY,
        commit: process.env.GITHUB_SHA, platform: process.platform, arch: process.arch,
        updateFeedSigned: false, appSigning: mac ? "ad hoc; not notarized" : "no Windows publisher signature" };
    await writeFile(join(destination, "build-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    const manifestBytes = await readFile(join(destination, "build-manifest.json"));
    hashes.push(`${createHash("sha256").update(manifestBytes).digest("hex")}  build-manifest.json`);
    await writeFile(join(destination, "SHA256SUMS"), hashes.join("\n") + "\n");
    console.log(`Verified ${process.platform} ${version}, frontend Build ID ${buildId}. Artifacts: ${destination}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.env.GITHUB_ACTIONS !== "true") throw Error("This helper is reserved for a clean GitHub Actions checkout");
    if (process.argv[2] === "prepare") {
        await releaseVersion(root);
        await clearGeneratedAssets(root);
    } else if (process.argv[2] === "collect") await collect();
    else throw Error("Usage: ci-desktop-artifacts.mjs prepare|collect");
}
