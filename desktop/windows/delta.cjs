// Included inside a signed delta installer. Rebuild only a new staging tree.
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { readFile, lstat, mkdir, copyFile, realpath } = require('node:fs/promises');
const { join, resolve, dirname, relative, isAbsolute } = require('node:path');
function safePath(path) {
  return typeof path==='string' && path.length<240 && path.split('/').every(part=>part && part!=='.' && part!=='..'
    && !/[<>:"\\|?*\x00-\x1f]/.test(part) && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part));
}
function validate(manifest) {
  if (!manifest || manifest.schema!==1 || !/^\d+\.\d+\.\d+$/.test(manifest.from) || !/^\d+\.\d+\.\d+$/.test(manifest.to)
    || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length>50000) throw Error('Invalid delta manifest');
  const seen=new Set();let total=0;
  for (const file of manifest.files) {
    if (!safePath(file.path) || seen.has(file.path.toLowerCase()) || !Number.isSafeInteger(file.size) || file.size<0 || !/^[a-f0-9]{64}$/.test(file.sha256)
      || typeof file.changed!=='boolean') throw Error('Invalid delta file');
    seen.add(file.path.toLowerCase());total+=file.size;
  }
  if (total>8*1024*1024*1024) throw Error('Delta is too large');
  for (const file of manifest.files) {
    const parts=file.path.toLowerCase().split('/');parts.pop();
    while(parts.length) { if(seen.has(parts.join('/'))) throw Error('Conflicting delta path');parts.pop(); }
  }
  return manifest;
}
async function regular(root, path) {
  let file=root;
  for(const part of path.split('/')) {
    file=join(file,part);const info=await lstat(file);
    if (info.isSymbolicLink()) throw Error('Delta paths must not contain links');
  }
  const info=await lstat(file), actual=relative(root,await realpath(file));
  if (!info.isFile() || isAbsolute(actual) || actual==='..' || actual.startsWith('../') || actual.startsWith('..\\')) throw Error('Invalid base file');
  return {file,info};
}
async function digest(path) {
  const hash=createHash('sha256');for await(const chunk of createReadStream(path)) hash.update(chunk);return hash.digest('hex');
}
async function materialize(base, stage, manifest) {
  validate(manifest);
  base=await realpath(base);stage=await realpath(stage);
  if (stage===base || !stage.endsWith('.update-stage') || stage!==base+'.update-stage') throw Error('Invalid delta staging directory');
  const old=JSON.parse(await readFile(join(base,'release-manifest.json'),'utf8'));
  if(old.schema!==1 || old.version!==manifest.from) throw Error('Delta base version does not match');
  // Reuse only files named by the signed target manifest. Deleted files and
  // local runtime caches are never copied to the new installation.
  let next = 0;
  async function worker() {
    while (next < manifest.files.length) {
      const entry = manifest.files[next++];
      if (!entry.changed) {
        const source=await regular(base,entry.path);
        if(source.info.size!==entry.size) throw Error(`Delta base mismatch: ${entry.path}`);
        const destination=join(stage,entry.path);
        await mkdir(dirname(destination),{recursive:true});
        // Check existing parent paths too, so a junction cannot redirect writes.
        let parent=stage;
        for(const part of entry.path.split('/').slice(0,-1)) { parent=join(parent,part);if((await lstat(parent)).isSymbolicLink()) throw Error('Invalid staging link'); }
        await copyFile(source.file,destination,require('node:fs').constants.COPYFILE_EXCL);
      }
      // Verify the staged bytes once, including unchanged files we just copied.
      const target=await regular(stage,entry.path);
      if(target.info.size!==entry.size || await digest(target.file)!==entry.sha256) throw Error(`Delta base or payload mismatch: ${entry.path}`);
    }
  }
  // Drain all workers on failure before the installer removes the stage.
  const results = await Promise.allSettled(Array.from({length: Math.min(8, manifest.files.length)}, worker));
  const failure = results.find(result=>result.status==='rejected');
  if (failure) throw failure.reason;
  return manifest.files.length;
}
module.exports={safePath,validate,digest,materialize};
if(require.main===module) {
  const [base,stage,manifest]=process.argv.slice(2);
  readFile(manifest,'utf8').then(text=>materialize(resolve(base),resolve(stage),JSON.parse(text)))
    .catch(error=>{ console.error(error.message);process.exitCode=13; });
}
