import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fetchSparkle } from './fetch-sparkle.mjs';
const exec = promisify(execFile);
export async function createMacOSDelta(archive, previous, version, sdk) {
    if (process.platform !== 'darwin' || !/^\d+\.\d+\.\d+$/.test(version)) throw Error('macOS delta generation requires macOS and a release version');
    sdk ??= await fetchSparkle();
    const directory = await mkdtemp(join(tmpdir(), 'navigator-delta-'));
    try {
        const old = join(directory, 'old'), next = join(directory, 'next');
        await mkdir(old); await mkdir(next);
        for (const [input, output] of [[previous, old], [archive, next]]) {
            const { stdout: paths } = await exec('unzip', ['-Z1', resolve(input)], {maxBuffer:16*1024*1024});
            if (paths.trim().split('\n').some(path=>!path.startsWith('Navigator.app/') && !path.startsWith('__MACOSX/'))
                || paths.split('\n').some(path=>path.split('/').includes('..'))) throw Error('Invalid macOS archive paths');
            await exec('ditto', ['-x', '-k', resolve(input), output]);
        }
        const oldApp = join(old, 'Navigator.app'), nextApp = join(next, 'Navigator.app');
        const plist = (app, key) => exec('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, join(app, 'Contents/Info.plist')]).then(result=>result.stdout.trim());
        const from = await plist(oldApp, 'CFBundleVersion');
        if (!/^\d+\.\d+\.\d+$/.test(from) || await plist(nextApp, 'CFBundleVersion')!==version
            || await plist(oldApp, 'CFBundleIdentifier')!=='app.navigator.desktop'
            || await plist(nextApp, 'CFBundleIdentifier')!=='app.navigator.desktop') throw Error('Invalid macOS delta base');
        const targetVersion=version.split('.').map(BigInt),baseVersion=from.split('.').map(BigInt);
        const first=targetVersion.findIndex((part,i)=>part!==baseVersion[i]);
        if(first<0 || targetVersion[first]<=baseVersion[first]) throw Error('Delta base must be older than the target');
        const path = join(dirname(resolve(archive)), `Navigator-${version}-macos-arm64-from-${from}.delta`);
        await exec(join(sdk, 'bin/BinaryDelta'), ['create', oldApp, nextApp, path], {maxBuffer:1024*1024});
        if ((await stat(path)).size >= (await stat(archive)).size * 0.9) { await rm(path); return null; }
        // Basic package verification: apply the patch to the immutable old app.
        // This does not launch an application or run playback.
        const restored = join(directory, 'restored.app');
        await exec(join(sdk, 'bin/BinaryDelta'), ['apply', oldApp, restored, path], {maxBuffer:1024*1024});
        await exec('codesign', ['--verify', '--deep', '--strict', restored]);
        if (await plist(restored, 'CFBundleVersion') !== version) throw Error('Reconstructed macOS version does not match');
        return path;
    } finally { await rm(directory, {recursive:true,force:true}); }
}
