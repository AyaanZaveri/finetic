import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

// Prepare executable startup code and UI assets. The local service check loads
// its actual Node dependencies; unused Next tooling, source maps, notices and
// catalogue artwork do not need to be opened during installation.
export function isStartupFile(path) {
  return path === 'prepare.cjs' || path === 'background-update.cjs' || path === 'update-public-key.txt' || path === 'runtime/node.exe' || path === 'server/server.js'
    || (path.startsWith('lib/') && path.endsWith('.dll'))
    || (path.startsWith('server/.next/') && /\.(js|css|woff2)$/.test(path));
}

export async function writeInstallManifest(resources) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && file !== join(resources, 'install-manifest.json')) {
        const path = relative(resources, file).replaceAll('\\', '/');
        if (!isStartupFile(path)) continue;
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(file)) hash.update(chunk);
        files.push({ path, size: (await stat(file)).size, sha256: hash.digest('hex') });
      } else if (!entry.isFile()) throw new Error('Installer resources must contain regular files only');
    }
  }
  await visit(resources);
  files.sort((a,b) => a.path.localeCompare(b.path));
  await writeFile(join(resources, 'install-manifest.json'), JSON.stringify({ version: 1, files }));
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) await writeInstallManifest(resolve(process.argv[2]));
