// Runs the production NativePlayerGlass effect against actual native video.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
const root=resolve(import.meta.dirname,'..');
const surfacesOnly=process.env.NAVIGATOR_GLASS_SURFACES_ONLY==='1';
const css=['components/desktop/native-playback.css','components/player-mobile.css','components/subtitle-text.module.css','components/arc/dropdown-menu/dropdown-menu.module.css', ...surfacesOnly?['components/arc/floating-surface.module.css','components/player-selection-controls.module.css']:[]].map(p=>readFileSync(resolve(root,p),'utf8').replaceAll(/:global\(([^)]+)\)/g,'$1')).join('\n').replaceAll(/\.text(?=[\s{\[])/g,'[data-subtitle-text]');
const controller=ts.transpileModule(readFileSync(resolve(root,'components/native-player-glass.tsx'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const canvasController=ts.transpileModule(readFileSync(resolve(root,'lib/desktop/windows-player-glass.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
// Twelve seconds of local moving color bars keep the decoder active while
// the test hides glass; EOF must not accidentally make a demand-stop test pass.
const chunks=[Buffer.from('YUV4MPEG2 W320 H180 F60:1 Ip A1:1 C420jpeg\n')];
for(let f=0;f<720;f++){
 const pixels=Buffer.alloc(320*180*3/2);
 for(let y=0;y<180;y++)for(let x=0;x<320;x++)pixels[y*320+x]=32+(Math.floor((x+f*2)/40)%7)*30;
 pixels.fill(90,320*180,320*180*5/4);pixels.fill(180,320*180*5/4);
 chunks.push(Buffer.from('FRAME\n'),pixels);
}
const video=process.env.NAVIGATOR_GLASS_VIDEO?readFileSync(process.env.NAVIGATOR_GLASS_VIDEO):Buffer.concat(chunks);
const html=`<!doctype html><html><head><style>${css}
:root{--background:#111;--popover:#18181b;--foreground:#fff;--border:#fff3;--layer-overlay:100;font:18px 'Segoe UI',sans-serif;color:white}
body{margin:0}.panel{position:fixed;width:240px;padding:24px;border-radius:14px;border:1px solid #fff3}
.preview{left:10%;top:30%}.menu{position:fixed;right:10%;top:30%;--radix-dropdown-menu-content-available-width:600px;--radix-dropdown-menu-content-available-height:600px}.subtitle{position:fixed;left:50%;bottom:12%;transform:translateX(-50%);max-width:90vw;text-align:center}
.panel[aria-hidden=true]{visibility:hidden}
</style></head><body>
 ${surfacesOnly? `<div class="panel menu popup surface" data-player-native-glass data-player-selection-drawer>Drawer glass</div>
<div class="panel preview" data-player-glass data-slot="media-player-speed-boost">2× speed</div>` : `<div class="panel preview" data-player-glass>Preview glass</div>
<div class="panel menu" role="menu" data-state="open" data-player-native-glass>Speed<br><br>Subtitles</div>
<div class="subtitle" data-subtitle-text data-subtitle-size="standard" data-subtitle-outline="thin">Every story starts somewhere.</div>`}
<script>
const bridge=window.navigatorDesktop, cleanups=[];
const subtitlesOnly=${process.env.NAVIGATOR_GLASS_SUBTITLES_ONLY==='1'};
if(subtitlesOnly)document.querySelectorAll('.panel').forEach(node=>node.setAttribute('aria-hidden','true'));
let attached=false,frames=0,painted=false,measuring=true;const arrivals=[],changes=[],paints=[],drops=[],raf=[],work=[];
let state={};
const originalDraw=CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage=function(...args){const result=originalDraw.apply(this,args);if(measuring&&this.canvas.hasAttribute('data-browser-glass-frame')&&this.canvas.parentElement?.classList.contains('preview'))paints.push(performance.now());return result;};
const rafStart=performance.now();requestAnimationFrame(function tick(t){if(measuring)raf.push(t);if(performance.now()-rafStart<20000)requestAnimationFrame(tick);});
const controllerBridge={...bridge,subscribe(fn){return bridge.subscribe(message=>{const start=performance.now();fn(message);if(measuring&&message.type==='glass-pixels')work.push(performance.now()-start);});}};
const canvasModule=(()=>{const exports={};${canvasController};return exports;})();
const NativePlayerGlass=(()=>{const exports={};const require=name=>name==='react'?{useEffect:fn=>cleanups.push(fn())}:name.endsWith('/bridge')?{desktopBridge:()=>controllerBridge}:name.endsWith('/windows-player-glass')?canvasModule:{};
${controller}
return exports.NativePlayerGlass;})();
bridge.subscribe(message=>{
 if(message.type==='state')state=message.state;
 if(message.type==='state'&&measuring&&typeof message.state.droppedFrames==='number')drops.push({at:performance.now(),dropped:message.state.droppedFrames,decoder:message.state.decoderDroppedFrames??0});
 if(message.type==='ready'&&!attached){attached=true;document.documentElement.dataset.nativePlaying='';NativePlayerGlass({mediaRef:{current:{controller:{previewSession:'glass-fixture'}}},sourceKey:'fixture',ready:true});if(subtitlesOnly){setTimeout(()=>fetch('/painted',{method:'POST',body:JSON.stringify({subtitle:{sampling:document.querySelector('.subtitle').matches('[data-player-glass],[data-player-native-glass]'),stroke:getComputedStyle(document.querySelector('.subtitle')).webkitTextStrokeWidth}})}),1500);setTimeout(()=>fetch('/completed',{method:'POST',body:JSON.stringify({frames,position:state.position})}),6500);}}
 if(message.type==='glass-pixels'){
  frames++;if(measuring){arrivals.push(performance.now());let hash=0;for(let i=0;i<message.frame.data.length;i+=236)hash=(Math.imul(hash,31)+message.frame.data[i])|0;changes.push(hash);}
  if(${surfacesOnly}){
   if(frames>=3&&!painted){
    painted=true;
    const material=[...document.querySelectorAll('.panel')].map(node=>{
     const canvas=node.querySelector('canvas');
     const tint=getComputedStyle(node,'::after');
     return {painted:node.hasAttribute('data-browser-glass'),aligned:!!canvas&&Math.abs(canvas.getBoundingClientRect().left)<1&&Math.abs(canvas.getBoundingClientRect().top)<1,tinted:tint.display!=='none'&&tint.backgroundColor!=='rgba(0, 0, 0, 0)'};
    });
    fetch('/painted',{method:'POST',body:JSON.stringify({frames,material,distinct:new Set(changes).size,width:message.frame.width,height:message.frame.height})});
   }
   return;
  }
  if(frames>=3&&!painted){painted=true;
   setTimeout(async()=>{
    const panels=[...document.querySelectorAll('.panel')];
    const material=panels.map(node=>({painted:node.hasAttribute('data-browser-glass'),image:!!node.querySelector('[data-browser-glass-frame]')&&getComputedStyle(node.querySelector('canvas')).visibility==='visible',x:node.style.getPropertyValue('--browser-glass-x'),y:node.style.getPropertyValue('--browser-glass-y'),tint:getComputedStyle(node,'::after').backgroundColor,dropdownOpacity:getComputedStyle(node).getPropertyValue('--dropdown-opacity')}));
    await fetch('/painted',{method:'POST',body:JSON.stringify({frames,material,subtitle:{sampling:document.querySelector('.subtitle').matches('[data-player-glass],[data-player-native-glass]'),background:getComputedStyle(document.querySelector('.subtitle')).backgroundColor,blur:getComputedStyle(document.querySelector('.subtitle')).backdropFilter,stroke:getComputedStyle(document.querySelector('.subtitle')).webkitTextStrokeWidth},pixels:[...document.querySelector('.preview canvas').getContext('2d').getImageData(Math.floor(message.frame.width/6)-16,Math.floor(message.frame.height*.35),32,1).data],canvasStyle:Object.fromEntries(['position','z-index','left','top','width','height','display','visibility','opacity','isolation','clip-path'].map(key=>[key,getComputedStyle(document.querySelector('.preview canvas')).getPropertyValue(key)])),panelStyle:Object.fromEntries(['position','z-index','isolation','background-color','overflow'].map(key=>[key,getComputedStyle(document.querySelector('.preview')).getPropertyValue(key)])),filterSupported:'filter' in document.createElement('canvas').getContext('2d'),bytes:message.frame.data.byteLength,width:message.frame.width,height:message.frame.height})});
    setTimeout(async()=>{
     measuring=false;
     const gaps=arrivals.slice(1).map((t,i)=>t-arrivals[i]).sort((a,b)=>a-b);
     const paintGaps=paints.slice(1).map((t,i)=>t-paints[i]).sort((a,b)=>a-b);
     const metrics={fps:(arrivals.length-1)*1000/(arrivals.at(-1)-arrivals[0]),p95GapMs:gaps[Math.floor(gaps.length*.95)],paintFps:(paints.length-1)*1000/(paints.at(-1)-paints[0]),p95PaintGapMs:paintGaps[Math.floor(paintGaps.length*.95)],p95CanvasMs:work.sort((a,b)=>a-b)[Math.floor(work.length*.95)],uniqueFrames:new Set(changes).size,rafFps:(raf.length-1)*1000/(raf.at(-1)-raf[0]),videoDropIncrease:drops.length?drops.at(-1).dropped-drops[0].dropped:null,decoderDropIncrease:drops.length?drops.at(-1).decoder-drops[0].decoder:null};
     const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
     bridge.send({type:'pause',session:'glass-fixture'});await wait(300);
     const pausedAt=frames;await wait(500);const pausedCached=frames===pausedAt;
     const until=async test=>{const end=performance.now()+2500;while(!test()&&performance.now()<end)await wait(20);return test();};
     const seekStarted=performance.now();bridge.send({type:'seek',session:'glass-fixture',position:3});
     const pausedSeekUpdated=await until(()=>frames>pausedAt&&!state.seeking&&Math.abs((state.position??0)-3)<.25);
     metrics.pausedSeekMs=performance.now()-seekStarted;
     const seekAt=frames,resumeStarted=performance.now();
     bridge.send({type:'play',session:'glass-fixture'});const resumed=await until(()=>frames>seekAt&&!state.paused&&!state.seeking&&!state.buffering&&(state.position??0)>3.05);
     metrics.resumeMs=performance.now()-resumeStarted;
     const beforeFullscreen=frames;bridge.send({type:'fullscreen',value:true});
     const fullscreenUpdated=await until(()=>bridge.fullscreen&&frames>beforeFullscreen&&getComputedStyle(document.querySelector('.preview canvas')).width===window.innerWidth+'px');
     const beforeRestore=frames;bridge.send({type:'fullscreen',value:false});
     const fullscreenRestored=await until(()=>!bridge.fullscreen&&frames>beforeRestore&&getComputedStyle(document.querySelector('.preview canvas')).width===window.innerWidth+'px');
     for(const node of panels)node.setAttribute('aria-hidden','true');
     await wait(300);const stoppedAt=frames;await wait(1200);
     for(const cleanup of cleanups)cleanup?.();
     fetch('/completed',{method:'POST',body:JSON.stringify({...metrics,frames,stopped:frames===stoppedAt,pausedCached,pausedSeekUpdated,resumed,fullscreenUpdated,fullscreenRestored})});
    },5000);
   },100);
  }
 }
});
bridge.send({type:'app-ready',dark:true});bridge.send({type:'load',session:'glass-fixture',url:location.origin+'/video.y4m',headers:{}});
</script></body></html>`;
createServer((req,res)=>{
 if(req.url==='/video.y4m'){
  const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??'');
  const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),video.length-1):video.length-1;
  if(start>end||start>=video.length){res.writeHead(416,{'Content-Range':`bytes */${video.length}`});res.end();return;}
  res.writeHead(range?206:200,{'Content-Type':'application/octet-stream','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${video.length}`}:{})});res.end(video.subarray(start,end+1));
 }
 else if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html'});res.end(html);}
 else if(['/painted','/completed'].includes(req.url)){
  let body='';req.on('data',chunk=>{body+=chunk;if(body.length>65536)req.destroy();});req.on('end',()=>{writeFileSync(process.env.NAVIGATOR_GLASS_RESULT+req.url.replace('/','.')+'.json',body);res.writeHead(204);res.end();});
 }else{res.writeHead(404);res.end();}
}).listen(37381,'127.0.0.1',()=>writeFileSync(process.env.NAVIGATOR_GLASS_RESULT+'.ready','ready'));
