// Standalone Chrome fixture: actual artwork components and CSS, no Next
// server, account credentials, network media, or application build required.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const run = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'navigator-artwork-surfaces-'));
const browser = process.env.CHROME_PATH || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
const args = ['--session', `navigator-artwork-surfaces-${process.pid}`, '--headed', '--executable-path', browser];
const cli = commands => run('agent-browser', [...args, ...commands], { timeout: 45_000 });
try {
  const { outputFiles } = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { BackdropImage } from './components/media-page/backdrop-image.tsx';
      import { ProgressiveEpisodeStill } from './components/progressive-episode-still.tsx';
      import { PlayerLoadingWordmark } from './components/player-loading-wordmark.tsx';
      import { Avatar, AvatarImage, AvatarFallback } from './components/ui/avatar.tsx';
      import { UserMenu } from './components/arc/user-menu/user-menu.tsx';
      const root=createRoot(document.querySelector('#fixture'));
      const svg=(color,name)=>'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="'+color+'"/><text x="40" y="150" font-size="50" fill="white">'+name+'</text></svg>');
      const nativeDecode=HTMLImageElement.prototype.decode;
      const gates=new Map();
      HTMLImageElement.prototype.decode=async function(){
        await nativeDecode.call(this);
        await new Promise(resolve=>{gates.set(this,resolve)});
      };
      const img=id=>document.querySelector('#'+id+' img');
      const opacity=image=>Number(getComputedStyle(image).opacity);
      const frame=()=>new Promise(requestAnimationFrame);
      const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const check=(value,message)=>{if(!value)throw Error(message)};
      async function until(condition,message){const limit=performance.now()+6000;while(!condition()){check(performance.now()<limit,message);await frame()}}
      const results=[];
      async function main(){
        root.render(<div className="grid">
          <section id="hero"><BackdropImage name="Hero" backdropImage={svg('#247e7a','Hero')} /></section>
          <section id="episode"><ProgressiveEpisodeStill preview={svg('#747345','Preview')} source={svg('#999544','Sharp')} title="Episode" /></section>
          <section id="wordmark"><PlayerLoadingWordmark src={svg('#393c45','Logo')} alt="Logo" loading /></section>
          <section id="avatar"><Avatar className="fixture-avatar"><AvatarImage src={svg('#6647a1','Cast')} alt="Cast portrait"/><AvatarFallback>CP</AvatarFallback></Avatar></section>
          <section id="account"><UserMenu user={{name:'Fixture',email:'fixture@example.test',avatarSrc:svg('#473d75','Photo')}} open={false} portal={false}/></section>
          <section id="missing-avatar"><Avatar className="fixture-avatar"><AvatarImage src="data:image/png;base64,invalid" alt="Missing portrait"/><AvatarFallback>MP</AvatarFallback></Avatar></section>
        </div>);
        const ids=['hero','episode','wordmark','avatar','account'];
        await until(()=>ids.every(id=>img(id)&&gates.has(img(id)))&&document.querySelectorAll('#episode img').length===2,'One or more real image components did not request decoding');
        const sharp=document.querySelectorAll('#episode img')[1];
        await until(()=>gates.has(sharp),'Sharp still did not request decoding');
        await delay(350);
        for(const id of ids){const image=img(id);check(image.dataset.artworkState==='loading'&&opacity(image)===0,id+': unready pixels were exposed');}
        const mask=document.querySelector('#wordmark [style*="mask-image"]');
        check(mask&&getComputedStyle(mask).visibility==='hidden','Loading shimmer appeared before the actual wordmark');
        check(opacity(sharp)===0,'Sharp artwork appeared before decode');
        check(document.querySelector('#missing-avatar [data-slot="avatar-fallback"]')?.textContent==='MP','Missing avatar lost its existing fallback');
        check(getComputedStyle(img('avatar')).backgroundColor==='rgba(0, 0, 0, 0)','Transparent add-on icons must keep their backing transparent');
        for(const id of ids)gates.get(img(id))();
        const samples=Object.fromEntries(ids.map(id=>[id,[]]));
        const start=performance.now();while(performance.now()-start<550){await frame();ids.forEach(id=>samples[id].push(opacity(img(id))))}
        for(const id of ids){const image=img(id);const intermediate=samples[id].filter(x=>x>.01&&x<.99).length;
          // The account menu intentionally skips replay for already-complete photos.
          if(id!=='account'||image.hasAttribute('data-artwork-revealing'))check(intermediate>=3,id+': the fade had no intermediate frames');
          check(image.dataset.artworkState==='ready'&&opacity(image)===1,id+': image never settled');
          results.push({surface:id,intermediateFrames:intermediate,settled:opacity(image),cachedRevealSkipped:!image.hasAttribute('data-artwork-revealing')});
        }
        check(getComputedStyle(mask).visibility==='visible','Shimmer did not follow the decoded logo');
        gates.get(sharp)();const upgrade=[];const upgradeStart=performance.now();
        while(performance.now()-upgradeStart<350){await frame();upgrade.push(opacity(sharp))}
        const intermediate=upgrade.filter(x=>x>.01&&x<.99).length;
        check(sharp.dataset.animate==='upgrade'&&intermediate>=2&&opacity(sharp)===1,'Sharp still did not crossfade over the decoded preview');
        results.push({surface:'episode-sharp',intermediateFrames:intermediate,settled:opacity(sharp)});
      }
      main().then(()=>({ok:true,results}),error=>({ok:false,error:String(error.stack||error),results})).then(report=>{window.revealReport=report});
    ` }, outfile: join(directory, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false,
  });
  const js = outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = outputFiles.find(file => file.path.endsWith('.css')).text;
  const html = join(directory, 'fixture.html');
  await writeFile(html, `<!doctype html><meta charset="utf-8"><style>
  :root{--accent:#292929;--surface-muted:#292929;--ease-out:cubic-bezier(.23,1,.32,1);color:white;background:#111;--space-3:12px;--radius-pill:999px}
  *{box-sizing:border-box}body{margin:20px;font:16px sans-serif}.grid{display:grid;grid-template-columns:repeat(2,240px);gap:12px}section{position:relative;width:240px;height:180px;background:#222}.w-full{width:100%}.h-full{height:100%}.object-cover{object-fit:cover}.fixture-avatar{position:relative;display:block;width:96px;height:96px;overflow:hidden;border-radius:50%}.size-full{width:100%;height:100%}.aspect-square{aspect-ratio:1}
  ${css}</style><main id="fixture"></main><script>${js.replaceAll('</script', '<\\/script')}</script>`);
  await cli(['open', pathToFileURL(html).href]);
  await cli(['wait', '--fn', 'window.revealReport !== undefined']);
  const { stdout } = await cli(['eval', 'JSON.stringify(window.revealReport)']);
  const value = JSON.parse(stdout.split('\n').find(line => line.startsWith('{') || line.startsWith('"{')));
  const report = typeof value === 'string' ? JSON.parse(value) : value;
  console.log(JSON.stringify(report, null, 2));
  assert.equal(report.ok, true, report.error);
} finally {
  await cli(['close']).catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
