const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const globals = { AbortController, AbortSignal, Response, Request, URL, URLSearchParams };
const sequence = load('lib/media/episode-continuation.ts', {}, globals);
const prefs = load('lib/media/playback-preferences.ts');
const titles = load('lib/media/playback-titles.ts');
const media = { id: 'tt1442437', seriesId: 'tt1442437', type: 'series', mediaSourceId: 'tt1442437:6:6',
  seasonNumber: 6, episodeNumber: 6, name: 'Halloween', showName: 'Modern Family', streamUrl: 'https://test/old.mp4', resumePositionTicks: 800,
  navigatorActionId: 'old-action', details: { id: 'tt1442437', type: 'series', name: 'Modern Family', logo: '/logo.png' } };
const next = { id: 'tt1442437:6:7', title: 'Queer Eyes, Full Hearts', season: 6, episode: 7,
  thumbnail: 'https://image.tmdb.org/t/p/w300/next-still.jpg' };
const clone = value => JSON.parse(JSON.stringify(value));
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; }
async function tick() { for(let i=0;i<12;i++) await Promise.resolve(); }
function controller(overrides={}) {
  const calls={lookup:0,prepare:0,warm:0,play:[],stop:[]};
  const instance = new sequence.EpisodeContinuation({ current:()=>media,season:6,episode:6,
    lookup:async()=>{ calls.lookup++; return next; },
    prepare:async target=>{ calls.prepare++; return {...target,streamUrl:'https://test/next.mp4',detailsLoaded:true}; },
    warm:async()=>{ calls.warm++; },play:target=>calls.play.push(target),beforeAdvance:ended=>calls.stop.push(ended),...overrides });
  return { instance,calls };
}
(async()=>{
  for(const [time,duration,wanted] of [[0,1800,false],[1499,1800,false],[1500,1800,true],[749,1000,false],[750,1000,true],[999,1000,true],[1000,1000,false],[74,100,false],[75,100,true],[10,NaN,false],[1,Infinity,false]])
    assert.equal(sequence.shouldPrefetchEpisode(time,duration),wanted);
  assert.equal(sequence.shouldPrefetchEpisode(1300,1800,1600),true,'Prepare five minutes before verified credits');
  assert.equal(sequence.shouldPrefetchEpisode(1300,1800,1900),false,'Ignore credits outside the file');
  const target=sequence.nextEpisodeRequest(media,next);
  assert.equal(target.mediaSourceId,next.id); assert.equal(target.episodeTitle,next.title);
  for(const field of ['streamUrl','resumePositionTicks','navigatorActionId','streamRequest']) assert.equal(target[field],undefined);
  assert.equal(target.details.logo,'/logo.png');
  let {instance,calls}=controller();
  await Promise.all([instance.next(),instance.next(),instance.prefetch(),instance.prefetch()]);
  for(let i=0;i<30;i++) await instance.prefetch();
  assert.equal(calls.lookup,1); assert.equal(calls.prepare,1); assert.equal(calls.warm,1);
  await Promise.all([instance.advance(true),instance.advance(true),instance.advance(false)]);
  assert.equal(calls.play.length,1); assert.deepEqual(calls.stop,[true]); assert.equal(calls.play[0].streamUrl,'https://test/next.mp4');
  instance.dispose();
  ({instance,calls}=controller()); await instance.advance();
  assert.equal(calls.prepare,0,'Prefetch off uses the normal loader without speculative stream reads');
  assert.equal(calls.play[0].streamUrl,undefined); assert.deepEqual(calls.stop,[false]);

  let clock=1000; ({instance,calls}=controller({now:()=>clock})); await instance.prefetch();
  clock+=sequence.NEXT_EPISODE_PREFETCH_TTL+1; await instance.advance(true);
  assert.equal(calls.prepare,2,'Old signed stream preparations are refreshed after a long pause');
  let claimed=0,released=0,warmSignal;
  ({instance,calls}=controller({warm:async(_media,signal)=>{warmSignal=signal;calls.warm++;return {claim(){claimed++;},dispose(){released++;}};}}));
  await instance.prefetch(false);assert.equal(calls.prepare,1);assert.equal(calls.warm,0,'Stream discovery does not require spare video bandwidth');
  await instance.prefetch(true);assert.equal(calls.warm,1);
  instance.suspendVideoPrefetch();assert.ok(warmSignal.aborted);assert.equal(released,1);
  await instance.prefetch(true);assert.equal(calls.prepare,1,'Resuming video preload reuses discovery');
  await instance.advance();assert.equal(claimed,1,'Advance claims video data before changing playback ownership');instance.dispose();
  const pending=deferred(); ({instance,calls}=controller({prepare:()=>pending.promise}));
  const warm=instance.prefetch(); await tick(); const move=instance.advance(true); instance.dispose();
  pending.resolve({...target,streamUrl:'https://test/next.mp4'}); await Promise.all([warm,move]);
  assert.equal(calls.play.length,0,'Closing/changing episodes while prefetch waits cannot start another title');
  assert.equal(calls.stop.length,0);
  const waiting=deferred(); ({instance,calls}=controller({lookup:()=>waiting.promise}));
  const cancel=instance.prefetch(); instance.cancelPrefetch(); waiting.resolve(next); await cancel;
  assert.equal(calls.prepare,0,'Turning prefetch off cancels it even during episode lookup');
  await instance.prefetch(); assert.equal(calls.prepare,1,'Turning it back on permits one new preparation');
  ({instance,calls}=controller({prepare:async()=>{throw Error('offline');}})); await instance.prefetch(); await instance.advance(true);
  assert.equal(calls.play.length,1); assert.equal(calls.play[0].streamUrl,undefined,'Failed prefetch falls back to normal playback');
  for(const episode of [null,{...next,season:6,episode:6},{...next,season:0},{...next,released:'2999-01-01'}]) {
    ({instance,calls}=controller({lookup:async()=>episode})); assert.equal(await instance.advance(true),false); assert.equal(calls.play.length,0);
  }
  let lookups=0; ({instance,calls}=controller({lookup:async()=>{if(!lookups++) throw Error('offline');return next;}}));
  assert.equal(await instance.next(),null); assert.ok(await instance.advance(true),'A transient lookup failure can recover on advance');

  function hookHarness(preferences={...prefs.DEFAULT_PLAYBACK_PREFERENCES,episodePrefetch:true}, hasNext=true) {
    const host=hooks(),played=[],stopped=[],finished=[],requests=[],prepared=[],warmed=[],images=[];
    const timers=new Map();
    let timerId=0;
    const {useEpisodeContinuation}=load('lib/media/use-episode-continuation.ts',{
      react:{...host.react,useLayoutEffect:host.react.useEffect},'@/contexts/settings-context':{useSettings:()=>({playbackPreferences:preferences})},
      'react-dom':{preload:(url,options)=>images.push({url,...options})},
      './episode-continuation':sequence,'./playback-preferences':prefs,'./playback-titles':titles,
      './prefetch-next-episode':{fetchFollowingEpisode:async(id,season,episode,signal)=>{requests.push(signal);return hasNext ? {...next,id:`${id}:${season}:${episode+1}`,season,episode:episode+1} : null;},
        prepareNextEpisode:async target=>{prepared.push(target);return {...target,streamUrl:'https://test/prepared.mp4'};}},
      './preload-next-video':{preloadNextVideo:async target=>{warmed.push(target);},videoPreloadAllowed:()=>true},
    },{document:{addEventListener(){},removeEventListener(){}},
      setTimeout(callback,delay){assert.equal(delay,1000);timers.set(++timerId,callback);return timerId;},
      clearTimeout(id){timers.delete(id);}});
    const options={media,visible:true,native:false,time:0,duration:1000,play:target=>played.push(target),beforeAdvance:value=>stopped.push(value),finish:()=>finished.push(true)};
    const render=()=>{ const value=host.render(()=>useEpisodeContinuation(options));host.flush();return value; };
    const tickCountdown=async()=>{
      assert.equal(timers.size,1);
      const [id, callback]=timers.entries().next().value;
      timers.delete(id);callback();await tick();return render();
    };
    return {host,render,preferences,options,played,stopped,finished,requests,prepared,warmed,images,timers,tickCountdown};
  }
  let h=hookHarness(); h.render(); await tick(); h.options.time=920; let value=h.render(); await tick();
  value=h.render();value.onEnded();value.onEnded(); await tick();
  for (let seconds=5;seconds>0;seconds--) {
    assert.equal(h.render().upNext.seconds,seconds);
    assert.equal(h.played.length,0);
    await h.tickCountdown();
  }
  assert.equal(h.played.length,1);assert.deepEqual(h.stopped,[true]);assert.equal(h.finished.length,0);assert.equal(h.played[0].streamUrl,'https://test/prepared.mp4');h.host.unmount();
  h=hookHarness();h.render();await tick();assert.equal(h.render().upNext,null);
  assert.deepEqual(h.images,[{url:next.thumbnail,as:'image',fetchPriority:'low'}]);
  h.options.time=998;h.render();value=h.render();
  assert.equal(value.upNext,null,'Keep Up Next hidden while the episode is still playing');
  assert.equal(h.timers.size,0);
  value.onEnded();await tick();value=h.render();
  assert.equal(value.upNext.seconds,5,'Show the countdown on the first card render');
  assert.equal(value.upNext.thumbnail,next.thumbnail);h.host.unmount();
  h=hookHarness();h.render();await tick();h.render().onEnded();await tick();value=h.render();
  assert.equal(value.upNext.next.title,next.title);
  const expired=h.timers.values().next().value;
  value.cancelUpNext();value.cancelUpNext();expired();await tick();
  assert.equal(h.played.length,0);assert.deepEqual(h.finished,[true]);assert.equal(h.render().upNext,null);assert.equal(h.timers.size,0);h.host.unmount();
  h=hookHarness();h.render();await tick();h.render().onEnded();await tick();value=h.render();
  value.playUpNext();value.playUpNext();await tick();
  assert.equal(h.played.length,1);assert.deepEqual(h.stopped,[true]);assert.equal(h.render().upNext,null);h.host.unmount();
  h=hookHarness();
  const rewindVideo = Object.assign(new EventTarget(), { currentTime: 1000, duration: 1000, ended: true });
  h.options.mediaRef = { current: rewindVideo };
  h.render();await tick();h.render().onEnded();await tick();h.render();
  const oldTick = h.timers.values().next().value;
  rewindVideo.currentTime = 990;rewindVideo.ended = false;rewindVideo.dispatchEvent(new Event('seeking'));
  assert.equal(h.render().upNext,null,'Seeking back from the end dismisses Up Next');
  assert.equal(h.timers.size,0);assert.equal(h.finished.length,0,'Seeking keeps the same episode open');
  rewindVideo.currentTime = 1000;rewindVideo.ended = true;h.render().onEnded();await tick();
  oldTick();assert.equal(h.render().upNext.seconds,5,'Reaching the end again starts a fresh countdown');
  assert.equal(h.played.length,0);h.host.unmount();
  h=hookHarness();h.options.session=media;h.render();await tick();h.render().onEnded();await tick();h.render();
  const staleTimer=h.timers.values().next().value;
  h.options.session={...media};h.render();staleTimer();await tick();
  assert.equal(h.played.length,0);assert.equal(h.render().upNext,null);h.host.unmount();
  h=hookHarness(prefs.DEFAULT_PLAYBACK_PREFERENCES,false);h.render();await tick();h.render().onEnded();await tick();
  assert.deepEqual(h.finished,[true]);assert.equal(h.render().upNext,null);h.host.unmount();
  h=hookHarness();h.render();await tick();value=h.render();value.advance();await tick();value.onEnded();await tick();
  assert.equal(h.played.length,1);assert.equal(h.finished.length,0,'An ended event after manual Next cannot close the next episode');h.host.unmount();
  h=hookHarness({...prefs.DEFAULT_PLAYBACK_PREFERENCES,episodeAutoplay:false});value=h.render();await tick();value=h.render();value.onEnded();value.onEnded();await tick();
  assert.equal(h.played.length,0);assert.equal(h.finished.length,1,'Disabled autoplay closes normally, once');h.host.unmount();
  h=hookHarness();h.render();await tick();const old=h.render();h.options.media={...media,episodeNumber:8,mediaSourceId:'tt1442437:6:8'};h.render();old.onEnded();await tick();
  assert.equal(h.finished.length,0,'An old ended callback cannot close the newly selected episode');h.host.unmount();
  h=hookHarness();h.render();h.host.replay();await tick();value=h.render();
  assert.ok(h.requests[0].aborted);assert.equal(h.requests.at(-1).aborted,false,'Strict Mode replay creates a live continuation');
  value.onEnded();await tick();h.render().playUpNext();await tick();assert.equal(h.played.length,1);h.host.unmount();
  h=hookHarness();h.options.media={id:'movie',type:'movie',name:'Movie'};value=h.render();value.onEnded();await tick();assert.equal(h.requests.length,0);assert.equal(h.finished.length,1);h.host.unmount();

  // Exercise actual native state events rather than supplying a synthetic
  // options.time value: the player uses mediaRef for both desktop platforms.
  const {MpvController}=load('lib/desktop/mpv-controller.ts',{},
    {Event,EventTarget,CustomEvent,DOMException,URL,crypto:require('node:crypto')});
  for(const platform of ['macos','windows']) {
    const commands=[],listeners=new Set();
    const adapter=new MpvController({platform,capabilities:{initialSeek:true},
      send:command=>commands.push(command),subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}});
    h=hookHarness();h.options.native=true;delete h.options.time;
    h.options.duration=0;h.options.mediaRef={current:null};h.render();await tick();
    h.options.mediaRef.current=adapter;adapter.load(media.streamUrl);
    const session=commands.find(command=>command.type==='load').session;
    const state={position:0,duration:1000,paused:false,volume:1,muted:false,rate:1,buffering:false,seeking:false,buffered:0,width:1920,height:1080};
    adapter.addEventListener('durationchange',()=>{h.options.duration=adapter.duration;});
    const position=time=>{for(const listener of listeners) listener({type:'state',session,state:{...state,position:time}});};
    position(0);
    for(const listener of listeners) listener({type:'loaded',session});
    h.render();await tick();
    position(749);await tick();assert.equal(h.prepared.length,0,`${platform}: do not fetch streams before the window`);
    position(750);await tick();
    assert.equal(adapter.currentTime,750);assert.equal(h.options.duration,1000);assert.equal(h.requests.length,1);
    assert.equal(h.prepared.length,1,`${platform}: native timeupdate starts preparation in the final 25 percent`);
    position(950);await tick();assert.equal(h.prepared.length,1,`${platform}: preparation is shared across position updates`);
    assert.equal(h.warmed.length,1,`${platform}: native playback now requests reusable video bytes too`);
    assert.equal(commands.filter(command=>command.type==='load').length,1,'No next-file load reaches mpv before advance');
    position(993);await tick();
    assert.equal(h.render().upNext,null,`${platform}: keep the card hidden before EOF`);
    h.options.play=target=>{h.played.push(target);adapter.load(target.streamUrl,target.requestHeaders);};
    value=h.render();value.onEnded();await tick();assert.equal(h.render().upNext.seconds,5);
    adapter.currentTime = 980;
    assert.equal(h.render().upNext,null,`${platform}: the native seek cancels autoplay before acknowledgment`);
    assert.equal(h.finished.length,0);
    h.render().onEnded();await tick();h.render().playUpNext();await tick();
    assert.equal(h.played[0].streamUrl,'https://test/prepared.mp4');
    assert.equal(commands.filter(command=>command.type==='load').at(-1).url,'https://test/prepared.mp4','Advance passes the prepared URL to the native adapter');
    assert.equal(h.prepared.length,1,'Advance reuses preparation');
    h.host.unmount();adapter.dispose();
  }
  console.log('PASS: macOS/Windows state events trigger earlier discovery and video preload; advance reuses preparation');

  const audio=load('lib/media/audio-language.ts');
  const resolver=load('lib/media/resolve-playback.ts',{'@/lib/media/audio-language':audio});
  const sharedStreams=[
    {url:'https://test/first.mkv',title:'English HEVC DTS'}, {url:'https://test/next.mp4',title:'English H264 AAC'},
  ];
  const shared={id:next.id,type:'series',canonicalId:Promise.resolve(next.id),promise:Promise.resolve(sharedStreams),
    snapshot:{streams:sharedStreams,complete:true,pending:0,total:1},
    subscribe(listener){listener(this.snapshot);return()=>{};}};
  let preparations=0;
  const preparedApi=load('lib/media/prefetch-next-episode.ts',{
    './fetch-playback-streams':{createPlaybackStreamRequest:(id,type,signal)=>{assert.equal(id,next.id);assert.equal(type,'series');assert.equal(signal.aborted,false);preparations++;return shared;}},
    './fetch-playback-details':{fetchPlaybackDetails:async target=>({id:target.id,type:'series',name:'Modern Family',logo:'/prepared-logo.png'})},
    './resolve-playback':resolver,'./playback-details':require('./test-support/playback-context.cjs').details,
    './stream-metadata':{probeStreamMetadata:async()=>undefined},'./playback-preferences':prefs,
    './stream-playability':{probeStreamPlayability:async()=> 'supported'},
  },globals);
  const ready=await preparedApi.prepareNextEpisode(target,true,new AbortController().signal);
  assert.equal(ready.mediaSourceId,next.id);assert.equal(ready.streamRequest,shared);assert.equal(ready.details.logo,'/prepared-logo.png');assert.equal(ready.detailsLoaded,true);
  await resolver.resolvePlayback(ready,{fetchStreams(){throw Error('Prepared playback must not refetch streams');}},()=>{});
  assert.equal(preparations,1);
  let verified=0;
  const checkedMedia={...ready,preparedWebStream:{url:ready.streamUrl,audioLanguage:'en',headersKey:JSON.stringify(ready.requestHeaders||{}),expires:Date.now()+60_000}};
  const verifyDependencies={environment:'web',autoSelectWebStream:true,preferredAudioLanguage:'en',
    fetchStreams:async()=>sharedStreams,verifyStream:async()=>{verified++;return 'supported';}};
  await resolver.resolvePlayback(checkedMedia,verifyDependencies,()=>{});
  assert.equal(verified,0,'A prepared URL does not repeat its audiovisual probe during the handoff');
  await resolver.resolvePlayback({...checkedMedia,preparedWebStream:{...checkedMedia.preparedWebStream,expires:0}},verifyDependencies,()=>{});
  assert.equal(verified,1,'Expired preparations must be verified again');
  for (const autoSelectWebStream of [false,true]) {
    prefs.savePlaybackPreferences({...prefs.DEFAULT_PLAYBACK_PREFERENCES,autoSelectWebStream});
    const prepared=await preparedApi.prepareNextEpisode(target,false,new AbortController().signal);
    assert.equal(prepared.streamUrl,autoSelectWebStream?'https://test/next.mp4':'https://test/first.mkv',
      'Preloaded episodes honor the same web stream selection preference');
  }
  prefs.savePlaybackPreferences(prefs.DEFAULT_PLAYBACK_PREFERENCES);

  // Execute the actual GlobalMediaPlayer ended handler with the hook result.
  const source=fs.readFileSync('components/global-media-player.tsx','utf8');
  const ast=ts.createSourceFile('player.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let endedCallback;
  function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='handleVideoEnded') endedCallback=node.initializer.arguments[0].getText(ast);ts.forEachChild(node,visit);}visit(ast);
  h=hookHarness();h.render();await tick();value=h.render();const video={}, playbackRequest={};
  const activePlaybackRequestRef={current:playbackRequest};
  const onEnded=vm.runInNewContext(ts.transpileModule(`(${endedCallback})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,
    {videoRef:{current:video},loadGenerationRef:{current:2},activePlaybackRequestRef,playbackRequest,
      episodeContinuationRef:{current:value},handleClose(){throw Error('Shared episode continuation should handle ended');}});
  onEnded({currentTarget:{}},2);
  onEnded({currentTarget:video},1);
  activePlaybackRequestRef.current={};
  onEnded({currentTarget:video},2);
  await tick();
  assert.equal(h.played.length,0,'Detached or superseded video events are ignored');
  activePlaybackRequestRef.current=playbackRequest;
  onEnded({currentTarget:video},2);onEnded({currentTarget:video},2);await tick();h.render().playUpNext();
  await tick();assert.equal(h.played.length,1);h.host.unmount();

  const {GET}=load('app/api/playback/next-episode/route.ts',{'@/app/actions/auth':{getAuthData:async()=>({})}, "@/lib/server/auth": { getAuthData:async()=>({}) },'@/app/actions/tv-shows':{getFollowingEpisodeForSeries:async()=>next}},globals);
  assert.equal((await GET(new Request('http://test/api/playback/next-episode?id=tt1442437&season=6&episode=6'))).status,200);
  assert.equal((await GET(new Request('http://test/api/playback/next-episode?id=bad/id&season=6&episode=6'))).status,400);
  const unauthorized=load('app/api/playback/next-episode/route.ts',{'@/app/actions/auth':{getAuthData:async()=>{throw Error('signed out');}}, "@/lib/server/auth": { getAuthData:async()=>{throw Error('signed out');} },'@/app/actions/tv-shows':{getFollowingEpisodeForSeries:async()=>{throw Error('Must authenticate first');}}},globals);
  assert.equal((await unauthorized.GET(new Request('http://test/api/playback/next-episode?id=tt1442437&season=6&episode=6'))).status,401);
  console.log('PASS: episode autoplay on/off, Next parity, one-shot preparation, bounds, expiration, cancellation, stale callbacks, Strict Mode, movie/finale guards, preload ownership and authenticated endpoint validation');
})().catch(error=>{console.error(error);process.exitCode=1});
