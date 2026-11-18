const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const globals = { Request, Response, Headers, URL, ReadableStream, TextDecoder, Event, EventTarget, AbortController, AbortSignal };
const tick = async () => { for (let i=0;i<30;i++) await Promise.resolve(); };
const server = load('lib/server/desktop-video-preload.ts', { 'server-only': {} }, globals);

(async () => {
  const file = Uint8Array.from({length:20},(_,i)=>i), requests=[];
  const upstream = async (url, init) => {
    const headers = new Headers(init.headers), range = /^bytes=(\d+)-(\d+)$/.exec(headers.get('Range'));
    requests.push({url,headers,signal:init.signal});
    const start=Number(range[1]),end=Math.min(Number(range[2]),file.length-1);
    return new Response(file.slice(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${file.length}`,
      'Content-Length':String(end-start+1),ETag:'"version-one"','Content-Type':'video/mp4'}});
  };
  let now=0;
  const cache=server.createDesktopVideoPreload(upstream,()=>now), signal=new AbortController().signal;
  const token=await cache.prepare('https://cdn.example/video.mp4',{Authorization:'Bearer fixture'},8,signal);
  assert.ok(token);assert.equal(requests.length,1);
  const request = (range,method='GET') => new Request('http://127.0.0.1/api/playback/preload?token='+token,
    {method,...(range?{headers:{Range:range}}:{})});
  let response=await cache.serve(token,request('bytes=0-3'));
  assert.equal(response.status,206);assert.equal(response.headers.get('Content-Range'),'bytes 0-3/20');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[0,1,2,3]);
  assert.equal(requests.length,1,'Initial metadata bytes come from cache without opening an upstream connection');
  response=await cache.serve(token,request('bytes=4-12'));
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[4,5,6,7,8,9,10,11,12]);
  assert.equal(requests[1].headers.get('Range'),'bytes=8-12','Only the uncached tail is requested');
  assert.equal(requests[1].headers.get('If-Range'),'"version-one"');
  assert.equal(requests[1].headers.get('Authorization'),'Bearer fixture');
  response=await cache.serve(token,request());assert.equal(response.status,200);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[...file]);
  const before=requests.length;
  response=await cache.serve(token,request(null,'HEAD'));assert.equal(response.headers.get('Content-Length'),'20');
  assert.equal(requests.length,before,'HEAD never consumes video data');
  response=await cache.serve(token,request('bytes=-3'));
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[17,18,19],'Suffix ranges support tail metadata/seek readers');
  assert.equal((await cache.serve(token,request('bytes=-0'))).status,416);
  assert.equal((await cache.serve(token,request('bytes=21-'))).status,416);
  cache.release(token);assert.equal((await cache.serve(token,request('bytes=0-0'))).status,206,'Speculative cleanup cannot delete an adopted cache');
  cache.release(token,true);assert.equal((await cache.serve(token,request())).status,404);

  const expiring=await cache.prepare('https://cdn.example/expire.mp4',{},8,signal);
  now=6*60_000+1;assert.equal((await cache.serve(expiring,request())).status,404,'Unclaimed prefixes expire');
  let cancelled=false;
  const ignored=server.createDesktopVideoPreload(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:200}));
  assert.equal(await ignored.prepare('https://cdn.example/no-range',{},8,signal),null);assert.ok(cancelled);
  const unsafe=server.createDesktopVideoPreload(async()=>new Response(file.slice(0,8),{status:206,
    headers:{'Content-Range':'bytes 0-7/20','Content-Type':'video/mp4'}}));
  assert.equal(await unsafe.prepare('https://cdn.example/no-validator',{},8,signal),null,'Never splice unversioned files');
  let changed=false;
  const changing=server.createDesktopVideoPreload((url,init)=>changed ? Promise.resolve(new Response(file,{status:200})) : upstream(url,init));
  const changedToken=await changing.prepare('https://cdn.example/change.mp4',{},8,signal);changed=true;
  await assert.rejects((await changing.serve(changedToken,request())).arrayBuffer(),/changed/,'Changed upstream data cannot be mixed with the prefix');
  console.log('PASS: desktop byte reuse, bounded range reads, authenticated upstream headers, streaming tail, HEAD, expiry, adoption and changed-file protection');

  class Video extends EventTarget {
    constructor(){super();this.className='';this.readyState=0;this.paused=true;this.currentTime=0;this.duration=1000;
      this.seeking=false;this.buffered={length:1,start:()=>0,end:()=>100};this.attributes=new Map();this.loads=0;this.removed=false;}
    load(){this.loads++;}pause(){this.paused=true;}remove(){this.removed=true;}
    setAttribute(name,value){this.attributes.set(name,value);}removeAttribute(name){this.attributes.delete(name);}
  }
  const engines=[], videos=[], timers=new Map();let timerId=0;
  const fakeMux={initialize(props,video){
    const config={maxBufferLength:30,maxMaxBufferLength:600,maxBufferSize:60e6,backBufferLength:Infinity,...props._hlsConfig};
    const engine={config,constructor:{DefaultConfig:{maxBufferLength:30,maxMaxBufferLength:600,maxBufferSize:60e6,backBufferLength:Infinity}},
      stops:0,starts:0,stopLoad(){this.stops++;},startLoad(){this.starts++;}};
    engines.push({engine,props,video});return {engine};
  },teardown(video){video.tornDown=true;}};
  const document={visibilityState:'visible',createElement(){const video=new Video();videos.push(video);return video;},addEventListener(){},removeEventListener(){}};
  let gpuEnabled = false, nativeDecoding = false, hdrOutput = false;
  const nativeRenderers = [], embeddedEngines = [];
  const web=load('lib/media/web-video-preload.ts',{
    '@mux/playback-core':fakeMux, './webgpu-module': { canUseWebGpu: () => gpuEnabled },
    './playback-preferences': { readPlaybackPreferences: () => ({ nativeWebGpuDecoding: nativeDecoding, hdrOutput }) },
    './webgpu-source': { resolveWebGpuSource: async () => 'https://cdn.example/resolved.mkv' },
    './native-webgpu-renderer': { renderNativeVideoWithWebGpu(video) {
      const renderer = { video, disposed: false }; nativeRenderers.push(renderer);
      return () => { renderer.disposed = true; };
    } },
    './webgpu-video': { attachWebGpuVideo(video) {
      const engine = { video, disposed: false }; embeddedEngines.push(engine);
      return () => { engine.disposed = true; };
    } },
  },{...globals,document,
    setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
  const controller=new AbortController(),url='https://cdn.example/episode.m3u8';
  const lease=await web.preloadWebVideo(url,controller.signal), standby=videos.at(-1),engine=engines.at(-1).engine;
  assert.equal(engine.config.maxMaxBufferLength,8);assert.equal(engine.config.maxBufferSize,32*1024*1024);
  standby.dispatchEvent(new Event('progress'));assert.equal(engine.stops,1,'Stop HLS loading after the opening buffer without destroying it');
  lease.claim();controller.abort();lease.dispose();assert.ok(!standby.tornDown,'Claimed data survives previous-episode cleanup');
  const adopted=web.takeWebVideo(url);assert.equal(adopted.video,standby,'Adopt the exact buffered element');
  assert.equal(engine.starts,1);assert.equal(engine.config.maxBufferLength,30,'Restore normal budgets on playback');
  assert.equal(web.takeWebVideo(url),undefined,'Adoption is single-use');adopted.dispose();assert.ok(standby.tornDown);
  const stop=new AbortController();await web.preloadWebVideo(url,stop.signal);const discarded=videos.at(-1);stop.abort();assert.ok(discarded.tornDown);
  assert.equal(timers.size,0,'Aborted/consumed preloads leave no timers');

  const outdated = await web.preloadWebVideo(url, new AbortController().signal);
  const oldVideo = videos.at(-1); outdated.claim(); gpuEnabled = true;
  assert.equal(web.takeWebVideo(url), undefined, 'Do not adopt native standby after WebGPU is enabled');
  assert.ok(oldVideo.tornDown); assert.equal(timers.size, 0);
  const count = videos.length;
  assert.equal(await web.preloadWebVideo(url, new AbortController().signal), undefined);
  assert.equal(videos.length, count, 'WebGPU playback avoids a duplicate native preload');
  Video.prototype.requestVideoFrameCallback = () => 1;
  nativeDecoding = true;
  const browserSession = web.createWebVideoSession('https://cdn.example/file.mkv');
  await Promise.resolve();
  assert.equal(browserSession.video.src, 'https://cdn.example/resolved.mkv');
  assert.equal(embeddedEngines.length, 0);
  browserSession.video.dispatchEvent(new Event('loadeddata'));
  assert.equal(nativeRenderers[0].video, browserSession.video, 'Render the existing browser-decoded element');
  assert.equal(timers.size, 0);
  browserSession.dispose();
  assert.equal(nativeRenderers[0].disposed, true);

  const rejected = web.createWebVideoSession('https://cdn.example/file.mkv');
  await Promise.resolve();
  rejected.video.dispatchEvent(new Event('error'));
  assert.equal(embeddedEngines[0].video, rejected.video, 'Decode errors retry through WebGPU on the same element');
  assert.equal(nativeRenderers.length, 1);
  rejected.dispose();
  assert.equal(embeddedEngines[0].disposed, true);

  const stalled = web.createWebVideoSession('https://cdn.example/file.mkv');
  [...timers.values()][0].fn();
  await Promise.resolve();
  assert.equal(embeddedEngines[1].video, stalled.video, 'A stalled browser open retries the custom engine');
  assert.equal(stalled.video.src, undefined, 'Late source resolution cannot replace the custom engine');
  stalled.dispose();

  hdrOutput = true;
  const hdr = web.createWebVideoSession('https://cdn.example/file.mkv');
  assert.equal(embeddedEngines[2].video, hdr.video, 'HDR output uses the custom engine');
  hdr.dispose();
  gpuEnabled = false;

  // The player wrapper attaches the retained element, preserving Media Chrome's
  // actual media ref and native event handlers through rerenders and cleanup.
  const notices=[];
  const host=hooks();
  const react={...host.react,useLayoutEffect:host.react.useEffect};
  const component=load('components/web-playback-video.tsx',{react,'react/jsx-runtime':host.jsx, sonner: { toast: message => notices.push(message) },
    '@/lib/media/web-video-preload':web},globals);
  const handoff=await web.preloadWebVideo(url,new AbortController().signal);const retained=videos.at(-1);handoff.claim();
  retained.readyState=4;
  let mediaRef,metadata=0,clicks=0;
  const props={src:url,ref:node=>{mediaRef=node;},className:'fixture-video',onLoadedMetadata:()=>metadata++,onClick:()=>clicks++};
  const tree=host.render(component.WebPlaybackVideo,props);tree.props.ref.current={append(video){assert.equal(video,retained);}};host.flush();await tick();
  retained.dataset = { webgpuHdr: 'display-unavailable' };
  retained.dispatchEvent(new Event('webgpu-hdr-unavailable'));
  retained.dispatchEvent(new Event('webgpu-hdr-unavailable'));
  assert.equal(notices.length, 1, 'Show the HDR fallback reason once per video');
  assert.match(notices[0], /browser reports an SDR display/);
  assert.equal(mediaRef,retained);assert.equal(metadata,1,'Replay ready metadata after adopting an already-loaded element');
  retained.dispatchEvent(new Event('click'));assert.equal(clicks,1);
  host.render(component.WebPlaybackVideo,{...props,onClick:()=>clicks+=2});host.flush();retained.dispatchEvent(new Event('click'));assert.equal(clicks,3);
  host.unmount();assert.equal(mediaRef,null);assert.ok(retained.tornDown);
  console.log('PASS: retained Mux/HLS engine and media element, bounded standby config, cancellation, single-use adoption, restored budgets, player refs/events and unmount cleanup');

  const conditions=load('lib/media/preload-next-video.ts',{'@/lib/desktop/bridge':{desktopBridge:()=>undefined},'./web-video-preload':web},
    {...globals,document,navigator:{connection:{saveData:false,effectiveType:'4g'}}});
  const current=new Video();current.paused=false;current.readyState=4;current.currentTime=85;
  assert.equal(conditions.videoPreloadAllowed(current),false);assert.equal(conditions.videoPreloadAllowed(current,5),true,'Use hysteresis between starting and suspending');
  current.currentTime=70;assert.equal(conditions.videoPreloadAllowed(current),true);
  current.duration=100;current.currentTime=98;
  assert.equal(conditions.videoPreloadAllowed(current),true,'A fully buffered ending must not discard next-episode data');
  current.paused=true;assert.equal(conditions.videoPreloadAllowed(current),false);current.paused=false;
  document.visibilityState='hidden';assert.equal(conditions.videoPreloadAllowed(current),false);
  console.log('PASS: current-playback buffer priority, pause/background gating and hysteresis');

  const nativeHost=hooks(),loads=[],released=[];
  let clock=0,errors=0,fallbacks=0;
  const nativeReact={...nativeHost.react,useLayoutEffect:nativeHost.react.useEffect,createElement:(type,props)=>({type,props})};
  const native=load('components/desktop/mpv-video.tsx',{react:nativeReact,
    '@/lib/desktop/mpv-element':{MPV_TAG:'fixture-mpv',registerMpvElement(){}},
    '@/lib/media/preload-next-video':{releaseNativePreload:url=>released.push(url)},
    '@/lib/compose-refs':{useComposedRefs:(a,b)=>node=>{a.current=node;if(typeof b==='function')b(node);else if(b)b.current=node;}},
  },{...globals,Date:{now:()=>clock}});
  const element=new EventTarget();element.controller={currentTime:0,load:(...args)=>loads.push(args)};
  const nativeProps={src:'https://cdn.example/raw.mkv',preloadSrc:'http://127.0.0.1/api/playback/preload?token=fixture',preloadExpires:1000,
    requestHeaders:{Authorization:'Bearer fixture'},onError:()=>errors++,onPreloadFallback:()=>fallbacks++};
  let nativeTree=nativeHost.render(native.MpvVideo,nativeProps);nativeTree.props.ref(element);nativeHost.flush();
  assert.equal(loads[0][0],nativeProps.preloadSrc);assert.deepEqual(Object.keys(loads[0][1]),[],'Credentials stay on the upstream side of the cache');
  clock=1500;nativeHost.render(native.MpvVideo,nativeProps);nativeHost.flush();
  assert.equal(loads.length,1,'A preload expiry crossing during playback must not reload the current episode');
  element.controller.currentTime=123;element.dispatchEvent(new Event('error'));
  assert.equal(errors,0,'Cache errors fall back once before becoming a playback error');
  assert.equal(fallbacks,1,'The player can cover the prior frame until the direct retry is ready');
  assert.equal(loads[1][0],nativeProps.src);assert.equal(loads[1][2],123,'Direct fallback preserves the playback position');
  element.dispatchEvent(new Event('error'));assert.equal(errors,1,'A failed direct retry reports its error');
  nativeHost.unmount();assert.ok(released.length>=1);
  console.log('PASS: mpv cache URL handoff, original headers, one-shot direct fallback, resume position, expiry stability and cleanup');

  const endpointCalls=[];let authenticated=true;
  const endpoint=load('app/api/playback/preload/route.ts',{
    '@/lib/server/auth':{getAuthData:async()=>{if(!authenticated)throw Error('signed out');return{};}},
    '@/lib/server/outbound-fetch':{outboundFetch(){throw Error('Use cache boundary');},outboundUrl:value=>{const url=new URL(value);if(!['http:','https:'].includes(url.protocol))throw Error('bad URL');return url;}},
    '@/lib/server/desktop-video-preload':{MAX_PRELOAD_BYTES:32*1024*1024,createDesktopVideoPreload:()=>({
      prepare:async(url,headers,bytes)=>{endpointCalls.push({url,headers,bytes});return 'fixture-token';},
      serve:async()=>new Response(null,{status:404}),release(){},
    })},
  },{...globals,process:{env:{NODE_ENV:'development'}}});
  const post=(body,origin='http://127.0.0.1:3000',base='http://127.0.0.1:3000')=>new Request(base+'/api/playback/preload',
    {method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await endpoint.POST(post({url:'https://cdn.example/a.mp4',bytes:1e12}))).status,200);
  assert.equal(endpointCalls[0].bytes,32*1024*1024,'The endpoint enforces its own cap');
  assert.equal((await endpoint.POST(post({url:'https://cdn.example/a.mp4'},'https://attacker.example'))).status,403);
  assert.equal((await endpoint.POST(post({url:'https://cdn.example/a.mp4'},'https://hosted.example','https://hosted.example'))).status,404);
  authenticated=false;assert.equal((await endpoint.POST(post({url:'https://cdn.example/a.mp4'}))).status,401);authenticated=true;
  assert.equal((await endpoint.POST(post({url:'https://cdn.example/a.mp4',headers:{Host:'bad'}}))).status,400);
  assert.equal((await endpoint.POST(post({url:'https://cdn.example/a.mp4',padding:'x'.repeat(65536)}))).status,400);
  assert.equal((await endpoint.POST(post({url:'file:///private/file'}))).status,400);
  assert.equal((await endpoint.POST(post({url:'https://cdn.example/a.m3u8'}))).status,204);
  assert.equal(endpointCalls.length,1,'Refused requests never reach the network/cache');
  console.log('PASS: loopback-only API, signed-in same-origin creation, request-size and byte caps, header validation and manifest fallback');
})().catch(error=>{console.error(error);process.exitCode=1;});
