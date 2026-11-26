// Build the optional macOS 15+ engine independently of the macOS 13.5 shell.
// Keep AetherEngine's FFmpeg frameworks dynamic and separate from libmpv.
import { execFileSync } from "node:child_process";
import { access, cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const packagePath = join(root, "desktop", "macos", "aether");
const libraryName = "libNavigatorAetherBridge.dylib";
const env = { ...process.env, MACOSX_DEPLOYMENT_TARGET: "15.0" };
const tool = (name, args, inherit = false) => execFileSync(name, args, {
  env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
});
const exists = async path => { try { await access(path); return true; } catch { return false; } };

async function verifyAetherFrameworks(frameworks) {
  const library = join(frameworks, libraryName);
  const dynamicFrameworks = (await readdir(frameworks)).filter(name => name.startsWith("Aether") && name.endsWith(".framework"));
  if (!dynamicFrameworks.includes("AetherLibavcodec.framework")) throw new Error("Missing AetherEngine dynamic FFmpeg framework");
  const files = [library, ...dynamicFrameworks.map(name => join(frameworks, name, name.slice(0, -".framework".length)))];
  for (const file of files) {
    for (const dependency of tool("otool", ["-L", file]).split("\n").slice(1)) {
      const match = dependency.trim().match(/^@rpath\/(\S+)/);
      if (match && !await exists(join(frameworks, match[1]))) throw new Error(`Unresolved AetherEngine dependency: ${match[1]}`);
    }
  }
  const symbols = new Set(tool("nm", ["-gUj", library]).split("\n"));
  for (const name of ["navigator_aether_create", "navigator_aether_command", "navigator_aether_destroy"]) {
    if (!symbols.has(`_${name}`)) throw new Error(`Missing Aether bridge C entry point: ${name}`);
  }
  tool("codesign", ["--verify", "--strict", library], true);

  for (const name of dynamicFrameworks) {
    tool("codesign", ["--verify", "--strict", join(frameworks, name)], true);
  }
}

export async function installPrebuiltAether(source, bundle, resources) {
  // CI verifies the transport checksum and current source commit before this
  // copy. Keep framework symlinks intact and verify signatures again locally.
  const sourceFrameworks = join(source, "Frameworks");
  const sourceResources = join(source, "Resources");
  await verifyAetherFrameworks(sourceFrameworks);
  if (!await exists(join(sourceResources, "licenses", "AetherEngine", "SOURCE.txt"))) {
    throw new Error("Missing AetherEngine source and license manifest");
  }
  const frameworks = join(bundle, "Frameworks");
  await cp(sourceFrameworks, frameworks, { recursive: true, verbatimSymlinks: true });
  await cp(sourceResources, resources, { recursive: true, verbatimSymlinks: true });
  await verifyAetherFrameworks(frameworks);
}

export async function embedAether(bundle, resources, { configuration = "release" } = {}) {
  const argumentsForBuild = ["build", "--package-path", packagePath, "-c", configuration, "--product", "NavigatorAetherBridge"];
  tool("swift", argumentsForBuild, true);
  const bin = tool("swift", ["build", "--package-path", packagePath, "-c", configuration, "--show-bin-path"]).trim();
  const frameworks = join(bundle, "Frameworks");
  await mkdir(frameworks, { recursive: true });
  await mkdir(resources, { recursive: true });

  const library = join(frameworks, libraryName);
  await cp(join(bin, libraryName), library);
  const names = await readdir(bin);
  const dynamicFrameworks = names.filter(name => name.startsWith("Aether") && name.endsWith(".framework"));
  if (!dynamicFrameworks.includes("AetherLibavcodec.framework")) throw new Error("AetherEngine's dynamic FFmpeg frameworks were not built");
  for (const name of dynamicFrameworks) {
    const target = join(frameworks, name);
    await cp(join(bin, name), target, { recursive: true, verbatimSymlinks: true });
    tool("chmod", ["-R", "u+w", target]);
    tool("codesign", ["--force", "--sign", "-", target], true);
  }
  for (const name of names.filter(name => name.endsWith(".bundle"))) {
    await cp(join(bin, name), join(resources, name), { recursive: true, verbatimSymlinks: true });
  }
  tool("chmod", ["u+w", library]);
  // A dylib's @loader_path is Contents/Frameworks. This must work on another
  // Mac with no SwiftPM checkout or build-directory rpath.
  if (!tool("otool", ["-l", library]).includes("path @loader_path (")) {
    tool("install_name_tool", ["-add_rpath", "@loader_path", library]);
  }
  tool("codesign", ["--force", "--sign", "-", library], true);
  await verifyAetherFrameworks(frameworks);

  // Preserve the exact upstream license/source notices with the package.
  const licenses = join(resources, "licenses", "AetherEngine");
  await mkdir(licenses, { recursive: true });
  const checkout = name => join(packagePath, ".build", "checkouts", name);
  const lock = JSON.parse(await readFile(join(packagePath, "Package.resolved"), "utf8"));
  for (const name of ["AetherEngine", "FFmpegBuild", "LibDovi"]) {
    const source = checkout(name);
    const destination = join(licenses, name);
    await mkdir(destination, { recursive: true });
    for (const filename of (await readdir(source)).filter(file => /^(LICENSE|COPYING|NOTICE)/i.test(file))) {
      await cp(join(source, filename), join(destination, filename), { recursive: true });
    }
    if (!await exists(join(destination, "LICENSE")) && !await exists(join(destination, "LICENSES"))) {
      throw new Error(`Missing license for ${name}`);
    }
  }
  const shader = join(checkout("AetherEngine"), "Sources", "AetherEngine", "Video", "Metal", "LineArtShaderSource.swift");
  if (await exists(shader)) await cp(shader, join(licenses, "Anime4K-acknowledgement.swift"));
  await writeFile(join(licenses, "SOURCE.txt"), lock.pins.map(pin => `${pin.identity}: ${pin.location}/tree/${pin.state.revision}`).join("\n") + "\n");
  return library;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  if (!output) throw new Error("Usage: node scripts/package-aether.mjs <Contents> [debug|release]");
  await embedAether(output, join(output, "Resources"), { configuration: process.argv[3] || "release" });
}
