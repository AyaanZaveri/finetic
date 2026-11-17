import { spawn } from "node:child_process";
import { writeFile, readFile, copyFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = (program, args, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(program, args, { stdio: "inherit", env });
  child.on("error", reject);
  child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${program} exited ${code}`)));
});
// GitHub runs steps in PowerShell 7. Its PSModulePath points at modules that
// Windows PowerShell 5.1 cannot load (including the signature-verification
// module). Let Windows PowerShell construct its own default module path.
export function windowsPowerShellEnvironment(environment) {
  const result = { ...environment };
  for (const key of Object.keys(result)) if (key.toLowerCase() === "psmodulepath") delete result[key];
  return result;
}
const powershell = (script, env) => run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(`$ErrorActionPreference = 'Stop'\n${script}`, "utf16le").toString("base64")], windowsPowerShellEnvironment({ ...process.env, ...env }));

// Write entry names explicitly: Windows PowerShell's legacy .NET compatibility
// mode can otherwise write backslash-separated ZIP paths.
export async function createWindowsZip(directory, destination) {
  await powershell(`Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$directory = [IO.Path]::GetFullPath($env:NAVIGATOR_PACKAGE_DIR)
$archive = [IO.Compression.ZipFile]::Open($env:NAVIGATOR_PACKAGE_ZIP, [IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -LiteralPath $directory -Recurse -Force -File | ForEach-Object {
    $entry = $_.FullName.Substring($directory.Length + 1).Replace('\\', '/')
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entry, [IO.Compression.CompressionLevel]::Optimal)
  }
} finally { $archive.Dispose() }`, {
    NAVIGATOR_PACKAGE_DIR: directory, NAVIGATOR_PACKAGE_ZIP: destination,
  });
}

export async function packageWindows(output, version) {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("The Windows release must be packaged on Windows x64");
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Windows packaging requires a numeric major.minor.patch version");
  const stem = join(dirname(output), `Navigator-${version}-windows-x64`);
  for (const path of [`${stem}-portable.zip`, `${stem}-setup.exe`]) {
    if (await access(path).then(() => true, () => false)) throw new Error(`Output already exists: ${path}`);
  }
  await copyFile(join(root, "assets/icons/windows/Navigator.ico"), join(output, "Navigator.ico"));
  await writeFile(join(output, "WINDOWS-README.txt"), `Navigator ${version} — Windows x64 release\r\n\r\nExtract the entire ZIP before opening navigator-desktop.exe.\r\nWindows 11 and Microsoft Edge WebView2 Evergreen Runtime are required.\r\nUse the setup.exe installer to install/repair a missing runtime automatically.\r\nSign-in and settings live in %LOCALAPPDATA%\\Navigator Desktop.\r\nStartup timings are in startup.jsonl in that folder.\r\nThis build is unsigned; Windows code signing is not yet configured. Installed copies support signed in-app updates; portable copies do not auto-install updates.\r\n`);
  const { releaseManifest, prepareDelta } = await import('./windows-delta.mjs');
  await releaseManifest(output, version);
  await createWindowsZip(output, `${stem}-portable.zip`);
  const bootstrapper = join(dirname(output), "MicrosoftEdgeWebview2Setup.exe");
  const response = await fetch("https://go.microsoft.com/fwlink/p/?LinkId=2124703", { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`WebView2 bootstrapper download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 10 * 1024 * 1024 || bytes.subarray(0, 2).toString() !== "MZ") throw new Error("Invalid WebView2 bootstrapper");
  await writeFile(bootstrapper, bytes);
  await powershell(`$signature = Get-AuthenticodeSignature -LiteralPath $env:NAVIGATOR_BOOTSTRAPPER
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'CN=Microsoft Corporation(?:,|$)') { throw 'WebView2 bootstrapper must have a valid Microsoft signature' }`, { NAVIGATOR_BOOTSTRAPPER: bootstrapper });
  await run(process.env.NAVIGATOR_MAKENSIS || "makensis.exe", [
    `/DAPP_VERSION=${version}`, `/DPACKAGE_DIR=${output}`, `/DOUTPUT_FILE=${stem}-setup.exe`,
    `/DBOOTSTRAPPER=${bootstrapper}`, `/DAPP_ICON=${join(output, "Navigator.ico")}`,
    join(root, "desktop/windows/installer.nsi"),
  ]);
  const deltas = [];
  if (process.env.NAVIGATOR_PREVIOUS_WINDOWS_DIR) {
    const deltaDir = `${stem}-delta-work`;
    const manifest = await prepareDelta(resolve(process.env.NAVIGATOR_PREVIOUS_WINDOWS_DIR), output, deltaDir, version);
    const filename = `Navigator-${version}-windows-x64-from-${manifest.from}-delta.exe`;
    const path = join(dirname(output), filename);
    await run(process.env.NAVIGATOR_MAKENSIS || 'makensis.exe', [
      `/DAPP_VERSION=${version}`, `/DPACKAGE_DIR=${output}`, `/DOUTPUT_FILE=${path}`,
      `/DBOOTSTRAPPER=${bootstrapper}`, `/DAPP_ICON=${join(output, 'Navigator.ico')}`,
      `/DDELTA_DIR=${deltaDir}`, `/DDELTA_SCRIPT=${join(root, 'desktop/windows/delta.cjs')}`,
      join(root, 'desktop/windows/installer.nsi'),
    ]);
    const bytes = await readFile(path);
    if (bytes.length < (await readFile(`${stem}-setup.exe`)).length * 0.9) deltas.push({from:manifest.from,filename,bytes});
    else await (await import('node:fs/promises')).rm(path);
  }
  let appcast, backgroundFeed;
  const signingKey = process.env.NAVIGATOR_UPDATE_SIGNING_KEY;
  const releaseTag = process.env.NAVIGATOR_RELEASE_TAG;
  if (signingKey || releaseTag) {
    if (!signingKey || !releaseTag) throw new Error("Both NAVIGATOR_UPDATE_SIGNING_KEY and NAVIGATOR_RELEASE_TAG are required to sign the Windows update feed");
    const { makeWindowsFeed, makeWindowsBackgroundFeed } = await import("./windows-update-feed.mjs");
    appcast = `${stem}-appcast.xml`;
    const options = { version, tag: releaseTag,
      filename: `Navigator-${version}-windows-x64-setup.exe`, bytes: await readFile(`${stem}-setup.exe`),
      privateKey: await readFile(signingKey), publicKey: await readFile(join(root, "desktop/windows/update-public-key.txt"), "utf8") };
    await writeFile(appcast, makeWindowsFeed(options));
    backgroundFeed = `${stem}-appcast.json`;
    await writeFile(backgroundFeed, makeWindowsBackgroundFeed(options, deltas));
  }
  return { appcast, backgroundFeed, deltas: deltas.map(delta=>delta.filename), installer: `${stem}-setup.exe`, portable: `${stem}-portable.zip` };
}
