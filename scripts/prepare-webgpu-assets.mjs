import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { patchWebGpuRuntime } from './webgpu-runtime-patch.mjs';

const require = createRequire(import.meta.url);
const manifest = require.resolve('@aiostreams/webgpu-player/package.json');
const { version } = JSON.parse(readFileSync(manifest, 'utf8'));
const root = new URL('../public/webgpu-player/', import.meta.url);
// Keep the complete upstream layout, including decoder licenses and source links.
rmSync(root, { recursive: true, force: true });
const destination = new URL(`${version}/`, root);
mkdirSync(destination, { recursive: true });
cpSync(join(dirname(manifest), 'libraries'), new URL('libraries/', destination), { recursive: true });
cpSync(join(dirname(manifest), 'LICENSE'), new URL('LICENSE', destination));
const entry = new URL('libraries/webgpu-player/EmbeddedPlayer.js', destination);
writeFileSync(entry, patchWebGpuRuntime(readFileSync(entry, 'utf8'), version));
console.log(`prepared webgpu player ${version}`);
