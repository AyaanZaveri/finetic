// Sign an immutable macOS ZIP with Navigator's dedicated login-Keychain key.
import { createPublicKey, verify } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fetchSparkle } from "./fetch-sparkle.mjs";
import { updateReleaseNotesXml } from "./update-release-notes.mjs";
const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const KEYCHAIN_ACCOUNT = "app.navigator.desktop.sparkle";
const xml = value => String(value).replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]);
export function makeMacOSFeed({ version, tag, filename, bytes, signature, publicKey, deltas = [] }) {
    if (!/^\d+\.\d+\.\d+$/.test(version) || tag !== `release-v${version}` || filename !== `Navigator-${version}-macos-arm64.zip`) throw new Error("Invalid macOS release metadata");
    const raw = Buffer.from(publicKey.trim(), "base64");
    if (raw.length !== 32) throw new Error("Invalid macOS update public key");
    const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]), format: "der", type: "spki" });
    if (!verify(null, bytes, key, Buffer.from(signature, "base64"))) throw new Error("macOS update signature does not match the public key shipped in Navigator");
    const seen = new Set();
    const deltaXml = deltas.map(delta => {
        if (!/^\d+\.\d+\.\d+$/.test(delta.from) || seen.has(delta.from) || delta.filename !== `Navigator-${version}-macos-arm64-from-${delta.from}.delta`
            || delta.bytes.length >= bytes.length || !verify(null, delta.bytes, key, Buffer.from(delta.signature, 'base64'))) throw Error('Invalid macOS delta metadata or signature');
        const target = version.split('.').map(BigInt), base = delta.from.split('.').map(BigInt);
        const first = target.findIndex((part, i) => part !== base[i]);
        if (first < 0 || target[first] <= base[first]) throw Error('Delta base must be older than the target');
        seen.add(delta.from);
        return `        <enclosure url="https://github.com/AyaanZaveri/navigator/releases/download/${xml(tag)}/${xml(delta.filename)}" sparkle:version="${xml(version)}" sparkle:deltaFrom="${xml(delta.from)}" sparkle:edSignature="${xml(delta.signature)}" length="${delta.bytes.length}" type="application/octet-stream" />`;
    }).join('\n');
    return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Navigator for macOS</title>
    <language>en</language>
    <item>
      <title>Navigator ${xml(version)}</title>
      <description>${updateReleaseNotesXml}</description>
      <sparkle:minimumSystemVersion>13.5</sparkle:minimumSystemVersion>
      <enclosure url="https://github.com/AyaanZaveri/navigator/releases/download/${xml(tag)}/${xml(filename)}"
        sparkle:version="${xml(version)}" sparkle:shortVersionString="${xml(version)}"
        sparkle:edSignature="${xml(signature)}" length="${bytes.length}" type="application/octet-stream" />
${deltaXml ? `      <sparkle:deltas>\n${deltaXml}\n      </sparkle:deltas>` : ''}
    </item>
  </channel>
</rss>
`;
}
export async function signMacOSArchive(archive, version, tag, output, deltaPaths = []) {
    const publicKey = (await readFile(join(root, "desktop/macos/update-public-key.txt"), "utf8")).trim();
    const { stdout: plist } = await exec("/usr/bin/unzip", ["-p", resolve(archive), "Navigator.app/Contents/Info.plist"]);
    for (const [name, value] of [["CFBundleVersion", version], ["CFBundleIdentifier", "app.navigator.desktop"], ["SUPublicEDKey", publicKey]]) {
        // A release archive must contain the advertised version and trust key.
        if (!plist.includes(`<key>${name}</key><string>${value}</string>`)) throw new Error(`Archive ${name} does not match release metadata`);
    }
    const sdk = await fetchSparkle();
    const { stdout } = await exec(join(sdk, "bin/sign_update"), ["--account", KEYCHAIN_ACCOUNT, "-p", resolve(archive)]);
    const deltas = [];
    for (const path of deltaPaths) {
        const filename = basename(path);
        const from = /-from-(\d+\.\d+\.\d+)\.delta$/.exec(filename)?.[1];
        const { stdout: signed } = await exec(join(sdk, 'bin/sign_update'), ['--account', KEYCHAIN_ACCOUNT, '-p', resolve(path)]);
        deltas.push({from, filename, bytes: await readFile(path), signature: signed.trim()});
    }
    const feed = makeMacOSFeed({ version, tag, filename: basename(archive), bytes: await readFile(archive), signature: stdout.trim(), publicKey, deltas });
    await writeFile(output, feed);
    return output;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [archive, version, tag, output, ...deltaPaths] = process.argv.slice(2);
    if (!output) throw new Error("Usage: macos-update-feed.mjs <archive.zip> <version> <release-vX.Y.Z> <output.xml>");
    await signMacOSArchive(archive, version, tag, output, deltaPaths);
    console.log(`Signed macOS appcast: ${output}`);
}
