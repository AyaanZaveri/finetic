// Generate a signed feed only after the immutable installer has been built.
// Usage: node scripts/windows-update-feed.mjs <installer> <version> <release-tag> <private-key.pem> <output.xml>
import { createHash, createPublicKey, sign, verify } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { updateReleaseNotesXml } from "./update-release-notes.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const xml = value => String(value).replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]);
export function makeWindowsFeed({ version, tag, filename, bytes, privateKey, publicKey }) {
    if (!/^\d+\.\d+\.\d+$/.test(version) || !tag || /[\r\n]/.test(tag) || basename(filename) !== filename || !filename.endsWith('-windows-x64-setup.exe')) throw new Error("Invalid Windows release metadata");
    const key = createPublicKey(privateKey);
    if (key.asymmetricKeyType !== "ed25519" || key.export({ type: "spki", format: "der" }).subarray(-32).toString("base64") !== publicKey.trim()) throw new Error("Signing key does not match the public key shipped in Navigator");
    const signature = sign(null, bytes, privateKey);
    if (!verify(null, bytes, key, signature)) throw new Error("Update signature verification failed");
    const url = `https://github.com/AyaanZaveri/navigator/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`;
    return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Navigator for Windows</title>
    <language>en</language>
    <item>
      <title>Navigator ${xml(version)}</title>
      <description>${updateReleaseNotesXml}</description>
      <enclosure url="${xml(url)}" sparkle:version="${xml(version)}" sparkle:shortVersionString="${xml(version)}"
        sparkle:os="windows" sparkle:installerArguments="/S /UPDATE" sparkle:edSignature="${signature.toString('base64')}"
        length="${bytes.length}" type="application/octet-stream" />
    </item>
  </channel>
</rss>
`;
}
// New runtimes verify the envelope before choosing a full or delta installer.
// Keep XML for existing WinSparkle installations.
export function makeWindowsBackgroundFeed(options, deltas = []) {
    makeWindowsFeed(options);
    if (options.tag !== `release-v${options.version}`) throw Error("Background updates require a stable release tag");
    const describe = (filename, bytes) => ({
        url: `https://github.com/AyaanZaveri/navigator/releases/download/${options.tag}/${filename}`,
        size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
        signature: sign(null, bytes, options.privateKey).toString('base64'),
    });
    const seen = new Set();
    const manifest = JSON.stringify({ schema: 1, platform: 'windows-x64', version: options.version,
        full: describe(options.filename, options.bytes), deltas: deltas.map(delta => {
            if (!/^\d+\.\d+\.\d+$/.test(delta.from) || seen.has(delta.from)
                || delta.filename !== `Navigator-${options.version}-windows-x64-from-${delta.from}-delta.exe`) throw Error('Invalid delta metadata');
            const target = options.version.split('.').map(BigInt), base = delta.from.split('.').map(BigInt);
            const first = target.findIndex((part, i) => part !== base[i]);
            if (first < 0 || target[first] <= base[first]) throw Error('Delta base must be older than the target');
            seen.add(delta.from);
            return { from: delta.from, ...describe(delta.filename, delta.bytes) };
        }),
    });
    return JSON.stringify({ manifest, signature: sign(null, Buffer.from(manifest), options.privateKey).toString('base64') }, null, 2)+'\n';
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [installer, version, tag, key, output, ...deltaPaths] = process.argv.slice(2);
    if (!output) throw new Error("Usage: windows-update-feed.mjs <installer> <version> <release-tag> <private-key.pem> <output.xml>");
    const options = { version, tag, filename: basename(installer), bytes: await readFile(installer), privateKey: await readFile(key), publicKey: await readFile(joinRoot("desktop/windows/update-public-key.txt"), "utf8") };
    const feed = makeWindowsFeed(options);
    await writeFile(output, feed);
    const deltas = await Promise.all(deltaPaths.map(async path => ({from: /-from-(\d+\.\d+\.\d+)-delta\.exe$/.exec(path)?.[1],filename:basename(path),bytes:await readFile(path)})));
    await writeFile(output.replace(/\.xml$/, '')+'.json', makeWindowsBackgroundFeed(options, deltas));
    console.log(`Signed update feed: ${output}`);
}
function joinRoot(path) { return resolve(root, path); }
