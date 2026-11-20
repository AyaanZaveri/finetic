// Runs only in the bundled Node runtime. No server or third-party modules.
const { createHash, createPublicKey, verify } = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const { readFile, writeFile, mkdir, rename, rm, copyFile, lstat } = require('node:fs/promises');
const { dirname, join, resolve } = require('node:path');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Transform, Readable } = require('node:stream');

const FEED = 'https://raw.githubusercontent.com/AyaanZaveri/navigator/main/updates/windows.json';
const MAX_PACKAGE = 1024 * 1024 * 1024;
function version(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) throw Error('Invalid update version');
  const parts = value.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw Error('Invalid update version');
  return parts;
}
function newer(a, b) {
  const x = version(a), y = version(b);
  for (let i=0;i<3;i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
function keyFrom(publicKey) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(publicKey.trim())) throw Error('Invalid update key');
  return createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(publicKey.trim(),'base64')]),format:'der',type:'spki'});
}
function validSignature(bytes, signature, key) {
  return typeof signature === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(signature) && verify(null,bytes,key,Buffer.from(signature,'base64'));
}
function packageInfo(info, target, from) {
  const stem = `Navigator-${target}-windows-x64`;
  const filename = from ? `${stem}-from-${from}-delta.exe` : `${stem}-setup.exe`;
  if (!info || !Number.isSafeInteger(info.size) || info.size <= 0 || info.size > MAX_PACKAGE
    || !/^[a-f0-9]{64}$/.test(info.sha256) || !/^[A-Za-z0-9+/]{86}==$/.test(info.signature)) throw Error('Invalid update package');
  const url = new URL(info.url);
  if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash
    || url.pathname !== `/AyaanZaveri/navigator/releases/download/release-v${target}/${filename}`) throw Error('Untrusted update address');
  return {...info,filename};
}
function parseFeed(text, publicKey, installed) {
  if (Buffer.byteLength(text) > 128*1024) throw Error('Update feed is too large');
  const envelope = JSON.parse(text), key = keyFrom(publicKey);
  if (typeof envelope.manifest !== 'string' || !validSignature(Buffer.from(envelope.manifest),envelope.signature,key)) throw Error('Update feed signature failed');
  const release = JSON.parse(envelope.manifest);
  version(release.version); version(installed);
  if (release.schema !== 1 || release.platform !== 'windows-x64' || !Array.isArray(release.deltas) || release.deltas.length > 8) throw Error('Invalid update manifest');
  release.full = packageInfo(release.full,release.version);
  const bases = new Set();
  release.deltas = release.deltas.map(delta=>{
    version(delta.from);
    if (!newer(release.version,delta.from) || bases.has(delta.from)) throw Error('Invalid delta base');
    bases.add(delta.from);
    return {...packageInfo(delta,release.version,delta.from),from:delta.from};
  });
  return newer(release.version,installed) ? release : null;
}
async function hash(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
async function verified(file, info, key) {
  try {
    const stat = await lstat(file);
    return stat.isFile() && !stat.isSymbolicLink() && stat.size === info.size
      && await hash(file) === info.sha256 && validSignature(await readFile(file),info.signature,key);
  } catch { return false; }
}
async function download(info, cache, key, fetcher = fetch) {
  const file = join(cache,info.filename);
  if (await verified(file,info,key)) return file;
  const part = file+'.part';
  await rm(part,{force:true});
  try {
    const res = await fetcher(info.url,{signal:AbortSignal.timeout(10*60*1000),credentials:'omit'});
    if (!res.ok || !res.body) throw Error('Update download failed');
    let size=0;
    const bound = new Transform({transform(chunk,_,done) { size+=chunk.length; done(size>info.size ? Error('Update exceeds signed size') : null,chunk); }});
    await pipeline(Readable.fromWeb(res.body),bound,createWriteStream(part,{flags:'wx',mode:0o600}));
    if (!await verified(part,info,key)) throw Error('Update package signature failed');
    await rename(part,file);
    return file;
  } catch (error) { await rm(part,{force:true}); throw error; }
}
async function getFeed(fetcher = fetch) {
  const res = await fetcher(FEED,{signal:AbortSignal.timeout(15000),credentials:'omit',cache:'no-store',redirect:'error'});
  if (!res.ok || !res.body) throw Error('Could not check for updates');
  let size=0; const chunks=[];
  for await (const chunk of res.body) {
    size+=chunk.length;
    if (size>128*1024) throw Error('Update feed is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function atomicJson(file, value) { await writeFile(file+'.tmp',JSON.stringify(value),{mode:0o600}); await rename(file+'.tmp',file); }
async function prepare(install, installed, cache, publicKey, fetcher = fetch, report = ()=>{}) {
  const text = await getFeed(fetcher), release = parseFeed(text,publicKey,installed);
  if (!release) return {state:'current'};
  await mkdir(cache,{recursive:true});
  const key=keyFrom(publicKey), delta=release.deltas.find(item=>item.from===installed && item.size<release.full.size);
  report({state:'downloading'});
  let selected=delta || release.full;
  try { await download(selected,cache,key,fetcher); }
  catch(error) { if (!delta) throw error; selected=release.full; await download(selected,cache,key,fetcher); }
  // The apply helper must outlive replacement of the installed directory.
  await copyFile(join(install,'resources/runtime/node.exe'),join(cache,'update-node.exe'));
  await copyFile(join(install,'resources/background-update.cjs'),join(cache,'background-update.cjs'));
  await writeFile(join(cache,'update-public-key.txt'),publicKey,{mode:0o600});
  // Persist the original signed envelope, not an unsigned list of executable URLs.
  await atomicJson(join(cache,'ready.json'),{text,installed,install:resolve(install),selected:selected.filename});
  // Keep just this release's selected download and its possible full fallback.
  const { readdir } = require('node:fs/promises');
  for (const name of await readdir(cache)) {
    if (/^Navigator-\d+\.\d+\.\d+-windows-x64-(?:setup|from-\d+\.\d+\.\d+-delta)\.exe(?:\.part)?$/.test(name)
      && name!==selected.filename && name!==release.full.filename) await rm(join(cache,name),{force:true});
  }
  return {state:'ready'};
}
function runInstaller(file) {
  return new Promise((resolve,reject)=>{
    const child=spawn(file,['/S','/UPDATE'],{cwd:dirname(file),stdio:'ignore',windowsHide:true});
    child.once('error',reject);
    child.once('exit',code=>resolve(code));
  });
}
async function apply(cache, publicKey, fetcher=fetch, run=runInstaller, report=()=>{}, expected={}) {
  const ready=JSON.parse(await readFile(join(cache,'ready.json'),'utf8'));
  if ((expected.installed && ready.installed!==expected.installed) || (expected.install && ready.install!==resolve(expected.install))) throw Error('Staged update belongs to a different installation');
  const release=parseFeed(ready.text,publicKey,ready.installed);
  if (!release) throw Error('No verified update is ready');
  const key=keyFrom(publicKey);
  const selected=[release.full,...release.deltas.filter(item=>item.from===ready.installed)].find(item=>item.filename===ready.selected);
  if (!selected) throw Error('Invalid staged update');
  const file=await download(selected,cache,key,fetcher);
  report({state:'installing'});
  let code=await run(file);
  if (code!==0 && selected!==release.full) {
    // A missing/modified base never produces a partial installation.
    // Only the full installer can repair it. Both payloads must pass Ed25519.
    const full=await download(release.full,cache,key,fetcher);
    code=await run(full);
  }
  if (code!==0) throw Error('Update installation failed. The previous app was retained.');
  const current = await readFile(join(cache,'ready.json'),'utf8').then(JSON.parse).catch(()=>null);
  if (current?.text === ready.text && current?.selected === ready.selected) await rm(join(cache,'ready.json'),{force:true});
}
module.exports={version,newer,keyFrom,parseFeed,verified,download,prepare,apply};
if (require.main===module) {
  // The app closes its read pipe after the installation handoff.
  process.stdout.on('error', error=>{ if(error.code!=='EPIPE') process.exitCode=1; });
  const [command,install,installed,cache]=process.argv.slice(2);
  const report=value=>process.stdout.write(JSON.stringify(value)+'\n');
  (async()=>{
    const publicKey=await readFile(join(__dirname,'update-public-key.txt'),'utf8');
    if (command==='prepare') report(await prepare(install,installed,cache,publicKey,fetch,report));
    else if (command==='apply') await apply(resolve(__dirname),publicKey,fetch,runInstaller,report,{install,installed});
    else throw Error('Unknown updater command');
  })().catch(async error=>{
    report({state:'error'});
    if (command==='apply') {
      await writeFile(join(__dirname,'last-error.txt'),String(error.message)).catch(()=>{});
      // If a delta or full installer failed, reopen the retained installation.
      try { spawn(join(resolve(install),'navigator-desktop.exe'),[],{detached:true,stdio:'ignore'}).unref(); } catch {}
    }
    process.exitCode=1;
  });
}
