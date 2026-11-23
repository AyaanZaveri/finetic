// Disposable Actions fixture. The installed app uses its real prepare and
// apply code. Only the signed feed and its HTTP responses use local test data.
const { createHash, generateKeyPairSync, sign } = require('node:crypto');
const { copyFile, readFile } = require('node:fs/promises');
const { basename, join } = require('node:path');
const runtime = require('./background-update-original.cjs');

async function main() {
  const [command, install, installed, cache] = process.argv.slice(2);
  if (command !== 'prepare') throw new Error('Unexpected fixture command');
  const { NAVIGATOR_UPDATE_FIXTURE_FULL: fullFile, NAVIGATOR_UPDATE_FIXTURE_DELTA: deltaFile,
    NAVIGATOR_UPDATE_FIXTURE_VERSION: version } = process.env;
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keyBytes = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  const key = runtime.keyFrom(keyBytes);
  const signature = data => sign(null, data, privateKey).toString('base64');
  const resources = new Map();
  async function asset(file, from) {
    const bytes = await readFile(file);
    const filename = basename(file);
    const url = `https://github.com/AyaanZaveri/navigator/releases/download/release-v${version}/${filename}`;
    resources.set(url, bytes);
    return { ...(from ? { from } : {}), url, filename, size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), signature: signature(bytes) };
  }
  const full = await asset(fullFile);
  const deltas = deltaFile ? [await asset(deltaFile, installed)] : [];
  const manifest = JSON.stringify({ schema: 1, platform: 'windows-x64', version, full, deltas });
  const feed = JSON.stringify({ manifest, signature: signature(Buffer.from(manifest)) });
  const feedUrl = 'https://raw.githubusercontent.com/AyaanZaveri/navigator/main/updates/windows.json';
  const fetcher = async url => {
    if (url === feedUrl) return new Response(feed);
    if (!resources.has(url)) throw new Error('Unexpected fixture URL');
    return new Response(resources.get(url));
  };
  const report = message => console.log(JSON.stringify(message));
  const result = await runtime.prepare(install, installed, cache, keyBytes, fetcher, report);
  if (result.state === 'ready') {
    // The real apply subprocess reuses a verified full fallback from disk.
    if (deltas.length) await runtime.download(full, cache, key, fetcher);
    await copyFile(join(__dirname, 'background-update-original.cjs'), join(cache, 'background-update.cjs'));
  }
  report(result);
}
main().catch(error => {
  console.error(error.message);
  console.log(JSON.stringify({ state: 'error' }));
  process.exitCode = 1;
});
