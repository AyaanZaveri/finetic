import { collectThirdPartyNotices } from "./collect-third-party-notices.mjs";
import { spawn } from "node:child_process";
import { cp, mkdir, access, writeFile, chmod } from "node:fs/promises";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchNodeRuntime } from "./desktop-runtime.mjs";
import { writeInstallManifest } from "./windows-install-manifest.mjs";
import { packageWindows } from "./package-windows.mjs";
import { readFile } from "node:fs/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = join(root, "desktop");
const manifest = join(desktop, "Cargo.toml");
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
function run(program, args, env = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(program, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
        child.on("error", reject);
        child.on("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${program} exited ${code ?? signal}`)));
    });
}
async function exists(path) { try { await access(path); return true; } catch { return false; } }
const command = process.argv[2];
const extra = process.argv.slice(3).filter((arg) => arg !== "--");

try {
    if (command === "dev") {
        // The user owns the Next development server. This starts the native shell only.
        await run("cargo", ["run", "--manifest-path", manifest, "--", "--url", process.env.NAVIGATOR_DESKTOP_URL || "http://localhost:3000", ...extra]);
    } else if (command === "check") {
        await run("cargo", ["fmt", "--manifest-path", manifest, "--all", "--", "--check"]);
        await run("cargo", ["test", "--manifest-path", manifest, "--locked"]);
    } else if (command === "package") {
        // Explicit packaging command, never run as a side effect of next dev/build.
        const nativeName = process.platform === "win32" ? "navigator-desktop.exe" : "navigator-desktop";
        const windows = process.platform === "win32" ? await import("./build-windows-native.mjs") : null;
        const native = windows ? windows.windowsNativeExecutable : join(desktop, "target", "release", nativeName);
        const standalone = join(root, ".next", "standalone");
        if (!extra.includes("--skip-build")) {
            await run(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "build"], { NAVIGATOR_DESKTOP: "1" });
            if (windows) await windows.buildWindowsNative();
            else await run("cargo", ["build", "--manifest-path", manifest, "--release", "--locked"]);
        }
        if (!await exists(native) || !await exists(join(standalone, "server.js"))) throw new Error("Build the native shell and Next standalone output before packaging with --skip-build.");
        const output = join(root, "dist", `desktop-${process.platform}-${process.arch}`);
        const mac = process.platform === "darwin";
        const bundle = mac ? join(output, "Navigator.app", "Contents") : output;
        const bin = mac ? join(bundle, "MacOS") : output;
        const resources = join(bundle, mac ? "Resources" : "resources");
        if (await exists(output)) throw new Error(`Output already exists: ${output}. Move or remove it before packaging again.`);
        await mkdir(bin, { recursive: true });
        await mkdir(join(resources, "runtime"), { recursive: true });
        await cp(native, join(bin, nativeName));
        await cp(standalone, join(resources, "server"), {
            recursive: true, dereference: true,
            // Keep local credentials, runtime caches, and build output out of the package.
            filter: (source) => !basename(source).startsWith(".env")
                && source !== join(standalone, "dist")
                && source !== join(standalone, "build")
                && source !== join(standalone, ".next", "cache"),
        });
        if (await exists(join(root, "public"))) await cp(join(root, "public"), join(resources, "server", "public"), { recursive: true });
        await cp(join(root, ".next", "static"), join(resources, "server", ".next", "static"), { recursive: true });
        await fetchNodeRuntime(join(resources, "runtime"));
        const os = mac ? "macos" : process.platform === "win32" ? "windows" : "linux";
        const arch = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch;
        const vendor = process.env.NAVIGATOR_LIBS_DIR || join(desktop, "vendor", `${os}-${arch}`);
        if (await exists(vendor)) await cp(vendor, join(resources, "lib"), { recursive: true, dereference: true });
        else if (process.platform !== "linux") throw new Error(`A portable libmpv bundle is required at ${vendor}. Use npm run desktop:fetch-libs first.`);
        await cp(join(desktop, "licenses"), join(resources, "licenses"), { recursive: true });
        await cp(join(desktop, "THIRD-PARTY.md"), join(resources, "THIRD-PARTY.md"));
        await cp(join(root, "LICENSE"), join(resources, "licenses", "Navigator-GPL-3.0.txt"));
        await cp(join(root, "LICENSE"), join(resources, "LICENSE"));
        await cp(join(root, "THIRD-PARTY.md"), join(resources, "NAVIGATOR-THIRD-PARTY.md"));
        await cp(join(root, "licenses"), join(resources, "licenses"), { recursive: true });
        await collectThirdPartyNotices(join(root, "node_modules"), join(resources, "licenses", "npm"));
        if (mac) {
            const { embedAether, installPrebuiltAether } = await import("./package-aether.mjs");
            if (process.env.NAVIGATOR_AETHER_CONTENTS) {
                await installPrebuiltAether(process.env.NAVIGATOR_AETHER_CONTENTS, bundle, resources);
            } else {
                await embedAether(bundle, resources);
            }
            const { fetchSparkle } = await import("./fetch-sparkle.mjs");
            const sparkle = await fetchSparkle();
            await mkdir(join(bundle, "Frameworks"), { recursive: true });
            await cp(join(sparkle, "Sparkle.framework"), join(bundle, "Frameworks", "Sparkle.framework"), {
                recursive: true, dereference: false, verbatimSymlinks: true,
            });
            await cp(join(sparkle, "LICENSE"), join(resources, "licenses", "Sparkle.txt"));
            const updateKey = (await readFile(join(desktop, "macos", "update-public-key.txt"), "utf8")).trim();
            if (!/^[A-Za-z0-9+/]{43}=$/.test(updateKey)) throw new Error("Invalid macOS update public key");
            await run("sh", [join(root, "scripts", "generate-macos-icon.sh")]);
            await cp(join(root, "build", "icon.icns"), join(resources, "Navigator.icns"));
            await writeFile(join(bundle, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>app.navigator.desktop</string>
<key>CFBundleName</key><string>Navigator</string>
<key>CFBundleExecutable</key><string>navigator-desktop</string>
<key>CFBundleIconFile</key><string>Navigator.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>NSHighResolutionCapable</key><true/>
<key>LSMinimumSystemVersion</key><string>13.5</string>
<key>SUFeedURL</key><string>https://raw.githubusercontent.com/AyaanZaveri/navigator/main/updates/macos.xml</string>
<key>SUPublicEDKey</key><string>${updateKey}</string>
<key>SUEnableAutomaticChecks</key><true/>
<key>SUAutomaticallyUpdate</key><false/>
<key>SUAllowsAutomaticUpdates</key><false/>
<key>SUSendProfileInfo</key><false/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/><key>NSAllowsArbitraryLoadsInWebContent</key><true/></dict>
</dict></plist>`);
            await chmod(join(bin, nativeName), 0o755);
            // Development bundle. Developer ID signing/notarization is a separate release step.
            // Leave Sparkle's signed nested helpers intact; sign only our app.
            await run("codesign", ["--force", "--sign", "-", join(output, "Navigator.app")]);
            await run("codesign", ["--verify", "--deep", "--strict", join(output, "Navigator.app")]);
            const archive = join(root, "dist", `Navigator-${version}-macos-arm64.zip`);
            if (process.arch !== "arm64") throw new Error("The macOS release currently targets Apple Silicon");
            if (await exists(archive)) throw new Error(`Output already exists: ${archive}`);
            await run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", join(output, "Navigator.app"), archive]);
            const deltas = [];
            if (process.env.NAVIGATOR_PREVIOUS_MACOS_ARCHIVE) {
                const { createMacOSDelta } = await import('./macos-delta.mjs');
                const delta = await createMacOSDelta(archive, process.env.NAVIGATOR_PREVIOUS_MACOS_ARCHIVE, version, sparkle);
                if (delta) deltas.push(delta);
            }
            if (process.env.NAVIGATOR_RELEASE_TAG) {
                const { signMacOSArchive } = await import("./macos-update-feed.mjs");
                const feed = join(root, "dist", `Navigator-${version}-macos-arm64-appcast.xml`);
                await signMacOSArchive(archive, version, process.env.NAVIGATOR_RELEASE_TAG, feed, deltas);
                console.log(`Signed macOS appcast: ${feed}`);
            }
            console.log(`macOS update archive: ${archive}`);
        }
        if (process.platform === "win32") {
            const { fetchWinSparkle } = await import("./fetch-winsparkle.mjs");
            const winsparkle = await fetchWinSparkle();
            await cp(join(winsparkle, "WinSparkle.dll"), join(resources, "lib", "WinSparkle.dll"));
            await cp(winsparkle, join(resources, "licenses", "WinSparkle"), { recursive: true, filter: source => !source.endsWith(".dll") });
            await cp(join(desktop, "windows", "prepare.cjs"), join(resources, "prepare.cjs"));
            await cp(join(desktop, "windows", "background-update.cjs"), join(resources, "background-update.cjs"));
            await cp(join(desktop, "windows", "update-public-key.txt"), join(resources, "update-public-key.txt"));
            await writeInstallManifest(resources);
            const artifacts = await packageWindows(output, version);
            if (artifacts.appcast) console.log(`Signed Windows appcast: ${artifacts.appcast}`);
            console.log(`Windows installer: ${artifacts.installer}\nPortable ZIP: ${artifacts.portable}`);
        }
        console.log(`Packaged desktop app: ${output}`);
    } else {
        throw new Error("Usage: node scripts/desktop.mjs dev|check|package [--skip-build]");
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
