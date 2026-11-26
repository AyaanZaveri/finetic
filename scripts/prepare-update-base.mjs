// Fetch immutable published inputs for delta generation. Never publish or sign.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, appendFile, mkdtemp, stat, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { windowsPowerShellEnvironment } from './package-windows.mjs';
const exec = promisify(execFile);
export function previousAsset(release, platform, current) {
    if (!/^release-v\d+\.\d+\.\d+$/.test(release.tag_name)) return null;
    const version = release.tag_name.slice('release-v'.length);
    const numbers = value=>value.split('.').map(Number);
    const compare = (a,b)=>{const x=numbers(a),y=numbers(b);for(let i=0;i<3;i++) if(x[i]!==y[i]) return x[i]>y[i];return false;};
    if (!/^\d+\.\d+\.\d+$/.test(current) || !compare(current,version)) return null;
    const name = `Navigator-${version}-${platform==='macos'?'macos-arm64.zip':'windows-x64-portable.zip'}`;
    const asset = release.assets?.find(asset=>asset.name===name);
    // GitHub supplies the digest of uploaded bytes. If absent, use a full
    // update rather than treating an unverified local directory as a base.
    return asset && /^sha256:[a-f0-9]{64}$/.test(asset.digest) ? {name,version,sha256:asset.digest.slice(7)} : null;
}
export function zipPaths(bytes) {
    const min=Math.max(0,bytes.length-65557);let end=-1;
    for(let i=bytes.length-22;i>=min;i--) if(bytes.readUInt32LE(i)===0x06054b50 && i+22+bytes.readUInt16LE(i+20)===bytes.length) {end=i;break;}
    if(end<0 || bytes.readUInt16LE(end+4)!==0 || bytes.readUInt16LE(end+6)!==0) throw Error('Unsupported base archive');
    const count=bytes.readUInt16LE(end+10);let offset=bytes.readUInt32LE(end+16);const names=[];
    if(count===65535) throw Error('ZIP64 bases are not supported');
    for(let i=0;i<count;i++) {
        if(offset+46>bytes.length || bytes.readUInt32LE(offset)!==0x02014b50) throw Error('Invalid base archive');
        const length=bytes.readUInt16LE(offset+28),extra=bytes.readUInt16LE(offset+30),comment=bytes.readUInt16LE(offset+32);
        const name=bytes.toString('utf8',offset+46,offset+46+length);
        if(!name || name.startsWith('/') || /[\\:\x00-\x1f]/.test(name) || name.split('/').some(part=>part==='..' || part==='.')) throw Error('Unsafe base archive path');
        names.push(name);offset+=46+length+extra+comment;
    }
    return names;
}
export function hasBundledBuildOutput(paths) {
    return paths.some(path => /^resources\/server\/(?:dist|build)(?:\/|$)/i.test(path));
}
async function prepare(platform) {
    const repository=process.env.GITHUB_REPOSITORY;
    if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository||'') || !['macos','windows'].includes(platform)) throw Error('Invalid delta build scope');
    const tag=process.env.NAVIGATOR_DELTA_BASE_TAG;
    if(tag && !/^release-v\d+\.\d+\.\d+$/.test(tag)) throw Error('Delta base must be a stable release tag');
    let release;
    try { release=JSON.parse((await exec('gh',['api',`repos/${repository}/releases/${tag?'tags/'+tag:'latest'}`])).stdout); }
    catch { console.log('No published delta base is available. Building a full package.');return; }
    const current=JSON.parse(await readFile('package.json','utf8')).version;
    const asset=previousAsset(release,platform,current);
    if(!asset) { console.log('No older package with a verified digest is available. Building a full package.');return; }
    // Next traces files inside the checkout into standalone server output.
    const directory=await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(),'navigator-update-base-'));
    await exec('gh',['release','download',release.tag_name,'--repo',repository,'--pattern',asset.name,'--dir',directory]);
    const archive=join(directory,asset.name);
    if((await stat(archive)).size>2*1024*1024*1024) throw Error('Delta base archive is too large');
    const hash=createHash('sha256');for await(const chunk of createReadStream(archive)) hash.update(chunk);
    if(hash.digest('hex')!==asset.sha256) throw Error('Delta base digest mismatch');
    const paths=zipPaths(await readFile(archive));
    let environment;
    if(platform==='macos') {
        if(paths.some(path=>!path.startsWith('Navigator.app/') && !path.startsWith('__MACOSX/'))) throw Error('Unexpected macOS base layout');
        environment=`NAVIGATOR_PREVIOUS_MACOS_ARCHIVE=${archive}`;
    } else {
        if(paths.some(path=>path.startsWith('resources/server/.next/cache/') || path.split('/').some(part=>part.startsWith('.env')))) throw Error('Base contains runtime data');
        if(hasBundledBuildOutput(paths)) {
            console.log('Previous Windows package contains nested build output. Building a full package.');
            return;
        }
        const extracted=join(directory,'windows');
        // Windows PowerShell sends per-file progress to stderr in non-interactive runs.
        const script="$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Expand-Archive -LiteralPath $env:NAV_BASE_ZIP -DestinationPath $env:NAV_BASE_DIR";
        await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{
            env:windowsPowerShellEnvironment({...process.env,NAV_BASE_ZIP:archive,NAV_BASE_DIR:extracted}),
        });
        // Old releases have no complete file manifest. Their users receive
        // one full update before later releases can reuse those files.
        if(!await lstat(join(extracted,'release-manifest.json')).catch(()=>null)) {
            console.log('Previous Windows package predates delta manifests. Building a full package.');return;
        }
        environment=`NAVIGATOR_PREVIOUS_WINDOWS_DIR=${extracted}`;
    }
    await appendFile(process.env.GITHUB_ENV,environment+'\n');
    console.log(`Prepared verified ${platform} delta base ${asset.version}.`);
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
    if(process.env.GITHUB_ACTIONS!=='true') throw Error('Delta bases are prepared only in the desktop build workflow');
    await prepare(process.argv[2]);
}
