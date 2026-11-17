import { readdir, lstat, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import delta from '../desktop/windows/delta.cjs';

export async function releaseManifest(root, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid release version');
  const files=[];
  async function visit(directory) {
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      const file=join(directory,entry.name),path=relative(root,file).replaceAll('\\','/');
      if(path==='release-manifest.json') continue;
      if(!delta.safePath(path)) throw Error('Invalid release path');
      if(entry.isDirectory()) await visit(file);
      else if(entry.isFile()) files.push({path,size:(await lstat(file)).size,sha256:await delta.digest(file)});
      else throw Error('Release files must not contain links');
    }
  }
  await visit(root);files.sort((a,b)=>a.path.localeCompare(b.path));
  const manifest={schema:1,version,files};
  await writeFile(join(root,'release-manifest.json'),JSON.stringify(manifest));
  return manifest;
}
function nsis(value) { return value.replaceAll('$','$$').replaceAll('"','$\\"'); }
export async function prepareDelta(base, target, destination, version) {
  const previous=JSON.parse(await readFile(join(base,'release-manifest.json'),'utf8'));
  const current=JSON.parse(await readFile(join(target,'release-manifest.json'),'utf8'));
  if(previous.schema!==1 || current.schema!==1 || current.version!==version || !/^\d+\.\d+\.\d+$/.test(previous.version)) throw Error('Invalid delta base manifest');
  const known=new Map(previous.files.map(file=>[file.path,file]));
  const entries=[...current.files,{path:'release-manifest.json',size:(await lstat(join(target,'release-manifest.json'))).size,sha256:await delta.digest(join(target,'release-manifest.json'))}];
  const manifest=delta.validate({schema:1,from:previous.version,to:version,files:entries.map(file=>({...file,changed:known.get(file.path)?.sha256!==file.sha256 || known.get(file.path)?.size!==file.size}))});
  await mkdir(destination,{recursive:true});
  let include='';
  for(const file of manifest.files.filter(file=>file.changed)) {
    const path=join(destination,'payload',file.path);
    await mkdir(dirname(path),{recursive:true});await cp(join(target,file.path),path);
    const folder=dirname(file.path).replaceAll('/','\\');
    include+=`SetOutPath "$INSTDIR.update-stage${folder==='.'?'':'\\'+nsis(folder)}"\nFile "${nsis(path)}"\n`;
  }
  await writeFile(join(destination,'payload.nsh'),include);
  await writeFile(join(destination,'manifest.json'),JSON.stringify(manifest));
  return manifest;
}
