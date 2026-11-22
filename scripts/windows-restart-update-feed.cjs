// This file is installed only on the disposable CI runner. It supplies a
// fixture feed to the released prepare helper, then stages the original apply helper.
const { createHash, generateKeyPairSync, sign } = require("node:crypto");
const { copyFile, readFile } = require("node:fs/promises");
const { join } = require("node:path");
const runtime = require("./background-update-original.cjs");

async function main() {
  const [command, install, installed, cache] = process.argv.slice(2);
  if (command !== "prepare" || installed !== "0.6.6") throw new Error("Unexpected fixture command");
  const bytes = await readFile(process.env.NAVIGATOR_UPDATE_FIXTURE_INSTALLER);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const key = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
  const signature = data => sign(null, data, privateKey).toString("base64");
  const version = "0.6.7";
  const url = `https://github.com/AyaanZaveri/navigator/releases/download/release-v${version}/Navigator-${version}-windows-x64-setup.exe`;
  const manifest = JSON.stringify({
    schema: 1, platform: "windows-x64", version, deltas: [],
    full: { url, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), signature: signature(bytes) },
  });
  const feed = JSON.stringify({ manifest, signature: signature(Buffer.from(manifest)) });
  const fetcher = async resource => {
    if (resource === url) return new Response(bytes);
    if (resource === "https://raw.githubusercontent.com/AyaanZaveri/navigator/main/updates/windows.json") {
      return new Response(feed);
    }
    throw new Error("Unexpected fixture URL");
  };
  const report = message => console.log(JSON.stringify(message));
  const result = await runtime.prepare(install, installed, cache, key, fetcher, report);
  await copyFile(join(__dirname, "background-update-original.cjs"), join(cache, "background-update.cjs"));
  report(result);
}
main().catch(error => {
  console.error(error.message);
  console.log(JSON.stringify({ state: "error" }));
  process.exitCode = 1;
});
