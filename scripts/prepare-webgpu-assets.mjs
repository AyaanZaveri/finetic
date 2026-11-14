import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

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
console.log(`prepared webgpu player ${version}`);
