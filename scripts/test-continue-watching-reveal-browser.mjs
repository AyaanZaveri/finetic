// Exercise the real MediaCard, ArtworkImage, and their CSS in Chrome without
// starting Next, making external image requests, or signing into the app.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const run = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'navigator-reveal-'));
const browser = process.env.CHROME_PATH || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
const args = ['--session', `navigator-reveal-${process.pid}`, '--headed', '--executable-path', browser];
const cli = (commands, timeout = 45_000) => run('agent-browser', [...args, ...commands], { timeout });
// Only unrelated application integrations are replaced. The real card,
// image readiness component, and CSS modules remain in the bundle.
const mocks = {
  '@/components/metadata-preload': 'export const useMetadataIntent=()=>({start(){},cancel(){}})',
  '@/lib/media/playback-details': 'export const projectPlaybackDetails=x=>x',
  '@/lib/preload-tools': 'export const preloadPlayer=()=>{}',
  '@/components/home-palette-provider': 'export const useHomePaletteScene=()=>null',
  '@/lib/artwork': 'export const mediaArtwork=x=>x; export const backdropVariantUrl=x=>x',
  '@/components/intent-link': 'export const IntentLink=()=>null',
  '@/contexts/MediaPlayerContext': 'export const usePlaybackActions=()=>({})',
  '@/lib/series-route': 'export const buildEpisodePath=()=>"/";export const parseSeriesRouteId=id=>({seriesId:id})',
  '@/components/watched-indicator': 'export const WatchedIndicator=()=>null',
  '@/components/media-card-menu': 'export const MediaCardMenu=({children})=>children',
  '@/components/continue-watching-warmup': 'export const useContinueWatchingWarmup=()=>null',
};
try {
  const { outputFiles } = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { MediaCard } from './components/media-card.tsx';
      const root=createRoot(document.querySelector('#fixture'));
      const results=[];
      const check=(value,message)=>{if(!value)throw Error(message)};
      const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const frame=()=>new Promise(requestAnimationFrame);
      async function until(condition,message){const limit=performance.now()+6000;while(!condition()){check(performance.now()<limit,message);await frame()}}
      const svg=(color,name)=>'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="780" height="440"><rect width="780" height="440" fill="'+color+'"/><text x="100" y="200" font-size="80" fill="white">'+name+'</text></svg>');
      const nativeDecode=HTMLImageElement.prototype.decode;
      let release, decodeCalls=0;
      HTMLImageElement.prototype.decode=async function(){
        if(!this.hasAttribute('data-prefetch-artwork'))return nativeDecode.call(this);
        decodeCalls++;
        await nativeDecode.call(this);
        await new Promise(resolve=>{release=resolve});
      };
      const art=()=>document.querySelector('#fixture img[data-prefetch-artwork]');
      const opacity=()=>{const image=art();return Number(getComputedStyle(image).opacity)*Number(getComputedStyle(image.parentElement).opacity)};
      const logo=()=>document.querySelector('#fixture div[data-logo-ready]');
      async function exercise(name, mac, warm){
        document.documentElement.dataset.nativePlatform=mac?'macos':'web';
        const src=svg('#247e7a',name), mark=svg('#253e54','Logo');
        if(warm){const image=new Image();image.src=src;await nativeDecode.call(image)}
        decodeCalls=0;release=undefined;
        const props={continueWatching:true,item:{id:name,type:'movie',name,background:src,logo:mark,progressPercent:20}};
        root.render(<MediaCard key={name} {...props}/>);
        await until(()=>release&&art()?.complete&&logo(),name+': the real backdrop did not request decoding');
        await delay(380); // longer than the old 300ms load-event animation
        check(art().dataset.artworkState==='loading'&&opacity()===0,name+': undecoded pixels started fading');
        check(getComputedStyle(logo()).visibility==='hidden',name+': wordmark appeared ahead of the backdrop');
        check(decodeCalls===1,name+': duplicate decodes');
        release();
        const samples=[]; const start=performance.now();
        while(performance.now()-start<600){await frame();const image=art();samples.push({time:performance.now()-start,state:image.dataset.artworkState,opacity:opacity(),logo:Number(getComputedStyle(logo()).opacity)})}
        const endpoint=mac ? 0.65 : 1;
        const intermediate=samples.filter(x=>x.state==='ready'&&x.opacity>.01&&x.opacity<endpoint-.01);
        check(intermediate.length>=3,name+': no visible intermediate backdrop frames: '+JSON.stringify(samples.slice(0,10)));
        check(Math.abs(opacity()-endpoint)<.001,name+': wrong final backdrop opacity');
        check(Number(getComputedStyle(logo()).opacity)===1,name+': wordmark did not settle');
        const element=art();root.render(<MediaCard key={name} {...props} item={{...props.item,progressPercent:30}}/>);
        await frame();await frame();
        check(art()===element&&Math.abs(opacity()-endpoint)<.001&&decodeCalls===1,name+': metadata refresh replayed the reveal');
        results.push({name,decoded:decodeCalls,intermediateFrames:intermediate.length,endpoint,firstIntermediate:intermediate[0].opacity,lastIntermediate:intermediate.at(-1).opacity});
      }
      async function main(){await exercise('cold-web',false,false);await exercise('cached-macos',true,true)}
      main().then(()=>({ok:true,results}),error=>({ok:false,error:String(error.stack||error),results})).then(report=>{window.revealReport={...report,viewport:{width:innerWidth,height:innerHeight}};document.querySelector('#report').textContent=JSON.stringify(window.revealReport)});
    ` }, outfile: join(directory, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false,
    plugins: [{ name: 'isolate-media-card', setup(builder) {
      builder.onResolve({ filter: /^@\// }, value => Object.hasOwn(mocks, value.path) ? { path: value.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, value => ({ contents: mocks[value.path], loader: 'js' }));
    } }],
  });
  const js = outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = outputFiles.find(file => file.path.endsWith('.css')).text;
  const html = join(directory, 'fixture.html');
  // Minimal fixture geometry for the card's utility classes, with the actual
  // component styles responsible for all motion and compositing.
  await writeFile(html, `<!doctype html><meta charset="utf-8"><style>
    :root{--accent:#292929;--ease-out:cubic-bezier(.23,1,.32,1);color:white;background:#111;--space-3:12px}
    *{box-sizing:border-box}body{margin:32px;font:16px sans-serif}.relative{position:relative}.absolute{position:absolute}.inset-0{inset:0}.w-80{width:320px}.w-full{width:100%}.h-full{height:100%}.aspect-video{aspect-ratio:16/9}.object-cover{object-fit:cover}.block{display:block}.overflow-hidden{overflow:hidden}.flex{display:flex}.items-center{align-items:center}.justify-center{justify-content:center}.max-h-\\[36\\%\\]{max-height:36%}.max-w-\\[78\\%\\]{max-width:78%}.w-auto{width:auto}.z-25{z-index:25}.z-30{z-index:30}.z-40{z-index:40}
    ${css}</style><main id="fixture"></main><pre id="report">Running</pre><script>${js.replaceAll('</script', '<\\/script')}</script>`);
  await cli(['open', pathToFileURL(html).href]);
  if (process.env.ARTWORK_VIEWPORT) {
    const [width, height] = process.env.ARTWORK_VIEWPORT.split('x');
    assert.ok(/^\d+$/.test(width) && /^\d+$/.test(height), 'Set ARTWORK_VIEWPORT as WIDTHxHEIGHT');
    await cli(['set', 'viewport', width, height]);
    await cli(['reload']);
  }
  await cli(['wait', '--fn', 'window.revealReport !== undefined']);
  const { stdout } = await cli(['eval', 'JSON.stringify(window.revealReport)']);
  const raw = stdout.split('\n').find(line => line.startsWith('{') || line.startsWith('"{'));
  const value = JSON.parse(raw);
  const report = typeof value === 'string' ? JSON.parse(value) : value;
  console.log(JSON.stringify(report, null, 2));
  assert.equal(report.ok, true, report.error);
} finally {
  await cli(['close']).catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
