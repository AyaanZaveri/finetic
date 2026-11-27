import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const platform = process.argv[2];
if (platform !== 'android' && platform !== 'ios') {
  console.error('Usage: node scripts/dev-client-fingerprint.mjs android|ios');
  process.exit(2);
}

const project = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const { createFingerprintAsync } = require('expo/fingerprint');

// Bump this when the native binary format or cache compatibility rules change.
// Deliberately omit source revision, runner image build date, Metro, and test
// files so normal JavaScript and UI edits reuse the native development client.
const cacheEpoch = 'navigator-dev-client-v1';
const expectedOS = platform === 'android' ? 'linux' : 'darwin';
function toolVersion(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    // Fail closed in CI instead of creating an ambiguous key.
    if (process.env.GITHUB_ACTIONS === 'true') {
      throw new Error(`Could not identify the native toolchain: ${command}`, { cause: error });
    }
    return 'unavailable-local';
  }
}

function javaVersion() {
  const result = spawnSync('java', ['-version'], { encoding: 'utf8' });
  if (result.status === 0) {
    const version = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    if (version) return version;
  }
  if (process.env.GITHUB_ACTIONS === 'true') throw new Error('Could not identify the Android JDK');
  return 'unavailable-local';
}

const pkg = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
const devClient = pkg.dependencies?.['expo-dev-client'] ?? pkg.devDependencies?.['expo-dev-client'];
if (!devClient) throw new Error('expo-dev-client is not declared in mobile/package.json');

const producerPaths = [
  'scripts/dev-client-fingerprint.mjs',
  `scripts/dev-client-${platform}.sh`,
  ...(platform === 'android' ? ['scripts/configure-android-sdk.sh'] : []),
  'fingerprint.config.js',
  '.fingerprintignore',
];
const producerHashes = {};
for (const path of producerPaths) {
  try {
    producerHashes[path] = createHash('sha256').update(await readFile(join(project, path))).digest('hex');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Fingerprint configuration files are optional.
    if (path.startsWith('scripts/') && process.env.GITHUB_ACTIONS === 'true') {
      throw new Error(`Missing native producer: ${path}`, { cause: error });
    }
    producerHashes[path] = 'absent';
  }
}

const fingerprint = await createFingerprintAsync(project, {
  platforms: [platform],
  hashAlgorithm: 'sha256',
  silent: true,
});

const toolchain = platform === 'ios' ? toolVersion('xcodebuild', ['-version']) : '';
if (process.env.GITHUB_ACTIONS === 'true' && process.platform !== expectedOS) {
  throw new Error(`Unexpected build host for ${platform}: ${process.platform}`);
}
const source = {
  cacheEpoch,
  platform,
  runnerOS: process.platform,
  runnerArch: process.arch,
  nodeVersion: process.version,
  nativeTarget: platform === 'android' ? 'android-debug-x86_64' : 'iphonesimulator-debug',
  toolchain: platform === 'ios' ? toolchain : javaVersion(),
  devClient,
  fingerprint: fingerprint.hash,
  producerHashes,
};
console.log(createHash('sha256').update(JSON.stringify(source)).digest('hex'));
