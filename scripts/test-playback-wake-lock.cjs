const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const { keepPlaybackAwake } = load('lib/media/playback-wake-lock.ts');
const flush = async () => { for(let i=0;i<12;i++) await Promise.resolve(); };
class Media extends EventTarget { paused=true; ended=false; error=null; }
class Page extends EventTarget { visibilityState='visible'; }
class Sentinel extends EventTarget {
 released=false; releases=0;
 async release(){this.releases++;this.released=true;this.dispatchEvent(new Event('release'));}
}
const deferred = () => { let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve,reject}; };
async function main(){
 const media=new Media(),page=new Page(),view=new EventTarget(),asks=[];
 const wakeLock={request(type){assert.equal(type,'screen');const d=deferred();asks.push(d);return d.promise;}};
 const stop=keepPlaybackAwake(media,{document:page,window:view,wakeLock});
 assert.equal(asks.length,0,'Paused video must not inhibit sleep');
 media.paused=false;media.dispatchEvent(new Event('playing'));assert.equal(asks.length,1);
 media.dispatchEvent(new Event('play'));assert.equal(asks.length,1,'Pending requests are coalesced');
 const first=new Sentinel();asks[0].resolve(first);await flush();
 media.dispatchEvent(new Event('waiting'));assert.equal(first.released,false,'Buffering must not release an active viewing lock');
 media.paused=true;media.dispatchEvent(new Event('pause'));await flush();assert.equal(first.releases,1);
 media.paused=false;media.dispatchEvent(new Event('playing'));
 page.visibilityState='hidden';page.dispatchEvent(new Event('visibilitychange'));
 const late=new Sentinel();asks[1].resolve(late);await flush();assert.equal(late.releases,1,'Late acquisition after hiding must be released');
 page.visibilityState='visible';page.dispatchEvent(new Event('visibilitychange'));assert.equal(asks.length,3);
 const third=new Sentinel();asks[2].resolve(third);await flush();
 view.dispatchEvent(new Event('pagehide'));await flush();assert.equal(third.released,true);
 view.dispatchEvent(new Event('pageshow'));assert.equal(asks.length,4);
 const fourth=new Sentinel();asks[3].resolve(fourth);await flush();
 await fourth.release();await flush();assert.equal(asks.length,4,'System release must not create an immediate retry loop');
 page.dispatchEvent(new Event('visibilitychange'));assert.equal(asks.length,5);
 asks[4].reject(new Error('Power policy'));await flush();assert.equal(asks.length,5,'Denial must not block playback or spin');
 media.dispatchEvent(new Event('playing'));assert.equal(asks.length,6);
 stop();const final=new Sentinel();asks[5].resolve(final);await flush();assert.equal(final.released,true,'Unmount releases a still-pending acquisition');
 media.dispatchEvent(new Event('playing'));page.dispatchEvent(new Event('visibilitychange'));assert.equal(asks.length,6,'Cleanup removes listeners');

 const raceMedia=new Media();raceMedia.paused=false;const racePage=new Page();const raceAsks=[];
 const end=keepPlaybackAwake(raceMedia,{document:racePage,wakeLock:{request(){const d=deferred();raceAsks.push(d);return d.promise;}}});
 racePage.visibilityState='hidden';racePage.dispatchEvent(new Event('visibilitychange'));
 racePage.visibilityState='visible';racePage.dispatchEvent(new Event('visibilitychange'));
 raceAsks[0].reject(new Error('Hidden during request'));await flush();assert.equal(raceAsks.length,2,'Returning during pending denial gets a fresh request');
 const raceLock=new Sentinel();raceAsks[1].resolve(raceLock);await flush();raceMedia.ended=true;raceMedia.dispatchEvent(new Event('ended'));await flush();assert.equal(raceLock.released,true);end();
 for (const event of ['error','emptied','loadstart']) {
  const playing=new Media();playing.paused=false;const lock=new Sentinel();
  const cleanup=keepPlaybackAwake(playing,{document:new Page(),wakeLock:{request:async()=>lock}});await flush();
  playing.dispatchEvent(new Event(event));await flush();assert.equal(lock.released,true,`${event} releases the current lock`);cleanup();
 }
 assert.doesNotThrow(()=>keepPlaybackAwake(new Media(),{document:new Page()})());

 const runtime=hooks();let acquired=0,released=0;
 const { PlaybackWakeLock }=load('components/playback-wake-lock.tsx',{react:runtime.react,'@/lib/media/playback-wake-lock':{keepPlaybackAwake(){acquired++;return()=>released++;}}});
 const ref={current:new Media()};
 const render=(sourceKey,enabled)=>{runtime.render(PlaybackWakeLock,{mediaRef:ref,sourceKey,enabled});runtime.flush();};
 render('first',false);assert.equal(acquired,0,'Native desktop playback uses its OS guard');
 render('first',true);assert.equal(acquired,1);render('second',true);assert.equal(released,1);runtime.unmount();assert.equal(released,2);
 console.log('PASS: playback wake locks, pause/end/unmount cleanup, buffering, visibility/page lifecycle, pending races, denial and system release, unsupported browsers and native isolation');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
