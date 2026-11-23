import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import runtime from '../desktop/windows/background-update.cjs';
import deltaRuntime from '../desktop/windows/delta.cjs';
import { makeWindowsBackgroundFeed } from './windows-update-feed.mjs';
import { releaseManifest, prepareDelta } from './windows-delta.mjs';
import { previousAsset, zipPaths } from './prepare-update-base.mjs';
import { deltaArtifacts } from './ci-desktop-artifacts.mjs';

const keys=generateKeyPairSync('ed25519');
const publicKey=keys.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64');
const full=Buffer.from('full signed installer'.repeat(30)), patch=Buffer.from('small signed delta');
const options={version:'0.6.1',tag:'release-v0.6.1',filename:'Navigator-0.6.1-windows-x64-setup.exe',bytes:full,privateKey:keys.privateKey,publicKey};
const patches=[{from:'0.6.0',filename:'Navigator-0.6.1-windows-x64-from-0.6.0-delta.exe',bytes:patch}];
const text=makeWindowsBackgroundFeed(options,patches);
assert.deepEqual(deltaArtifacts('0.6.1',false,[patches[0].filename,options.filename,'Navigator-0.5.0-windows-x64-from-0.4.0-delta.exe']),[patches[0].filename]);
assert.deepEqual(deltaArtifacts('0.6.1',true,['Navigator-0.6.1-macos-arm64-from-0.6.0.delta','Navigator-0.6.1-macos-arm64-from-0.6.0.delta.tmp']),['Navigator-0.6.1-macos-arm64-from-0.6.0.delta']);
const release=runtime.parseFeed(text,publicKey,'0.6.0');
const published={tag_name:'release-v0.6.0',assets:[{name:'Navigator-0.6.0-windows-x64-portable.zip',digest:'sha256:'+'a'.repeat(64)}]};
assert.equal(previousAsset(published,'windows','0.6.1').version,'0.6.0');
assert.equal(previousAsset(published,'windows','0.6.0'),null);
assert.equal(previousAsset({...published,assets:[{...published.assets[0],digest:null}]},'windows','0.6.1'),null);
assert.throws(()=>zipPaths(Buffer.from('not a zip')),/archive/);
assert.equal(release.deltas[0].from,'0.6.0');
assert.equal(runtime.parseFeed(text,publicKey,'0.6.1'),null);
assert.equal(runtime.parseFeed(text,publicKey,'0.7.0'),null);
assert.equal(runtime.newer('0.10.0','0.9.9'),true);
const envelope=JSON.parse(text);
assert.throws(()=>runtime.parseFeed(JSON.stringify({...envelope,manifest:envelope.manifest.replace('0.6.1','9.9.9')}),publicKey,'0.6.0'),/signature/);
function signedManifest(change) {
  const manifest=JSON.parse(envelope.manifest);change(manifest);
  const bytes=JSON.stringify(manifest);
  return JSON.stringify({manifest:bytes,signature:sign(null,Buffer.from(bytes),keys.privateKey).toString('base64')});
}
for(const change of [m=>m.full.url='https://evil.test/payload.exe',m=>m.full.size=2**40,m=>m.deltas.push(m.deltas[0]),m=>m.deltas[0].from='0.6.1']) {
  assert.throws(()=>runtime.parseFeed(signedManifest(change),publicKey,'0.6.0'));
}
const temp=await mkdtemp(join(tmpdir(),'navigator-update-unit-'));
try {
  const install=join(temp,'app'),cache=join(temp,'cache');
  await mkdir(join(install,'resources/runtime'),{recursive:true});
  await writeFile(join(install,'resources/runtime/node.exe'),'unit fixture, never executed');
  await writeFile(join(install,'resources/background-update.cjs'),'unit fixture, never executed');
  const requests=[];
  const fetcher=async url=>{
    requests.push(url);
    return new Response(url.endsWith('.json')?text:url.includes('-delta.exe')?patch:full);
  };
  const statuses=[];
  assert.deepEqual(await runtime.prepare(install,'0.6.0',cache,publicKey,fetcher,s=>statuses.push(s.state)),{state:'ready'});
  assert.deepEqual(statuses,['downloading']);
  assert.equal(requests.filter(u=>u.endsWith('.exe')).length,1,'Download only the applicable delta');
  await runtime.prepare(install,'0.6.0',cache,publicKey,fetcher);
  assert.equal(requests.filter(u=>u.endsWith('.exe')).length,1,'A verified cached payload is reused after relaunch');
  const installed=[];
  await assert.rejects(runtime.apply(cache,publicKey,fetcher,async()=>{throw Error('Must not run');},()=>{},{installed:'0.5.0'}),/different installation/);
  const helperPath = new URL('../desktop/windows/background-update.cjs', import.meta.url);
  const require = createRequire(helperPath);
  const helper = { exports: {} };
  runInNewContext(await readFile(helperPath, 'utf8'), {
    module: helper, Buffer, URL, AbortSignal,
    require: name => name === 'node:child_process' ? {
      spawn(file, args, { cwd }) {
        assert.equal(cwd, cache, 'The installer must not inherit the running app’s working directory');
        assert.deepEqual(Array.from(args), ['/S', '/UPDATE', '/UPDATEPID=2345', `/D=${install}`]);
        installed.push(file);
        const child = new EventEmitter();
        queueMicrotask(() => child.emit('exit', file.includes('-delta.exe') ? 13 : 0));
        return child;
      },
    } : require(name),
  });
  await helper.exports.apply(cache, publicKey, fetcher, undefined, undefined, {parentPid:2345});
  assert.deepEqual(installed.map(file=>file.includes('-delta.exe')), [true,false], 'Base mismatch automatically falls back to the signed full installer');
  assert.equal(requests.filter(u=>u.endsWith('-setup.exe')).length,1);
  await assert.rejects(readFile(join(cache,'ready.json')),/ENOENT/);
  const other=join(temp,'fallback-cache');
  const broken=async url=>url.endsWith('.json')?new Response(text):new Response(url.includes('-delta.exe')?'corrupt':full);
  await runtime.prepare(install,'0.6.0',other,publicKey,broken);
  assert.equal(JSON.parse(await readFile(join(other,'ready.json'),'utf8')).selected,options.filename,'A bad delta signature falls back before installation');
  const corrupt=async url=>new Response(url.endsWith('.json')?makeWindowsBackgroundFeed(options):'tampered full installer');
  await assert.rejects(runtime.prepare(install,'0.6.0',join(temp,'bad'),publicKey,corrupt),/signature/);
  const oversized=async()=>new Response(Buffer.alloc(patch.length+1));
  await assert.rejects(runtime.download(release.deltas[0],await mkdir(join(temp,'oversized'),{recursive:true}).then(()=>join(temp,'oversized')),runtime.keyFrom(publicKey),oversized),/signed size/);

  const base=join(temp,'base'),target=join(temp,'target'),work=join(temp,'delta');
  await mkdir(base);await mkdir(target);
  await writeFile(join(base,'unchanged.dll'),'same binary');await writeFile(join(base,'screen.js'),'old UI');await writeFile(join(base,'deleted.js'),'obsolete');
  await releaseManifest(base,'0.6.0');
  await writeFile(join(target,'unchanged.dll'),'same binary');await writeFile(join(target,'screen.js'),'new UI');
  await releaseManifest(target,'0.6.1');
  const manifest=await prepareDelta(base,target,work,'0.6.1');
  assert.equal(manifest.files.find(f=>f.path==='unchanged.dll').changed,false);
  const stage=base+'.update-stage';await mkdir(stage);await cp(join(work,'payload'),stage,{recursive:true});
  await deltaRuntime.materialize(base,stage,manifest);
  assert.equal(await readFile(join(stage,'screen.js'),'utf8'),'new UI');
  assert.equal(await readFile(join(stage,'unchanged.dll'),'utf8'),'same binary');
  await assert.rejects(readFile(join(stage,'deleted.js')),/ENOENT/,'Removed files are not carried into the new release');
  await rm(stage,{recursive:true});await mkdir(stage);await cp(join(work,'payload'),stage,{recursive:true});
  await writeFile(join(base,'unchanged.dll'),'modified!');
  await assert.rejects(deltaRuntime.materialize(base,stage,manifest),/mismatch/);
  assert.equal(await readFile(join(base,'screen.js'),'utf8'),'old UI','A failed reconstruction leaves the installed app untouched');
  for(const path of ['../outside','/absolute','C:/outside','a\\b','file:stream','CON','file.','a//b']) {
    assert.equal(deltaRuntime.safePath(path),false,path);
  }
  assert.throws(()=>deltaRuntime.validate({...manifest,files:[manifest.files[0],{...manifest.files[0],path:manifest.files[0].path.toUpperCase()}]}),/Invalid/);
  if(process.platform!=='win32') {
    await rm(stage,{recursive:true});await mkdir(stage);await cp(join(work,'payload'),stage,{recursive:true});
    await rm(join(base,'unchanged.dll'));await symlink(join(target,'unchanged.dll'),join(base,'unchanged.dll'));
    await assert.rejects(deltaRuntime.materialize(base,stage,manifest),/links/);
  }
  console.log('PASS: signed background feeds, version/base selection, cache reuse, payload tampering, size limits, delta/full fallback, reconstruction, removals, path and symlink rejection.');
} finally { await rm(temp,{recursive:true,force:true}); }
