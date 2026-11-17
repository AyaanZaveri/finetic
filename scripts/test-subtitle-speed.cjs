const assert=require('node:assert/strict');
const {load}=require('./test-support/react-hooks.cjs');
const {firstEnglishSDHCatalog}=load('lib/media/preferred-subtitle-catalog.ts');
const text='1\n00:00:10,000 --> 00:00:12,000\n[door opens] This is the secret.\n';
const english={src:'https://fixture.test/sdh-1',label:'English SDH',language:'eng',sdh:true};
(async()=>{
 let releaseSlow;
 const slow=new Promise(resolve=>{releaseSlow=resolve;});
 const result=await firstEnglishSDHCatalog([Promise.resolve([{language:'es',sdh:true}]),slow,Promise.resolve([english])]);
 assert.equal(result[0],english,'An English SDH provider does not wait for an unrelated stalled add-on');
 releaseSlow([]);
 const ordinary={language:'en',sdh:false};
 const fallback=await firstEnglishSDHCatalog([Promise.resolve([ordinary]),Promise.resolve([])]);
 assert.equal(fallback.length,1);assert.equal(fallback[0],ordinary,'No SDH still returns normal English tracks');
 let calls=[],signals=[];
 const {loadParsedSubtitles}=load('app/tools/subtitles.ts',{
  ai:{tool:x=>x},'@/lib/server/auth':{getAuthData:async()=>({user:{_id:'user'}})},
  '@/app/actions/utils':{getSubtitleTracks:async(_,__,options)=>{assert.equal(options.navigatorEnglishSDH,true);return [{src:'https://fixture.test/es',label:'Spanish SDH',language:'es',sdh:true},english,{...english,src:'https://fixture.test/sdh-2'},{...ordinary,src:'https://fixture.test/normal',label:'English'}];}},
  '@/app/actions/subtitles':{fetchSubtitleFileContent:(src,signal)=>{calls.push(src);signals.push(signal);if(src===english.src)return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled'))));return Promise.resolve({success:true,content:text});}},
  './media':{playMedia:{},searchMedia:{}},'./episodes':{createEpisodeTools:()=>({})},
  '@/lib/navigator-structured-output':{generateNavigatorObject(){}},
 });
 const loaded=await loadParsedSubtitles({id:'tt123',name:'Movie',type:'movie'},0);
 assert.equal(loaded.success,true);assert.equal(loaded.selectedTrackLabel,'English SDH');
 assert.deepEqual(calls,[english.src,'https://fixture.test/sdh-2'],'Race equivalent English SDH releases before lower-preference languages/tracks');
 assert.equal(signals[0].aborted,true,'Stop the stalled losing request');

 const modes=[], recoveredDownloads=[];
 const recovery=load('app/tools/subtitles.ts',{
  ai:{tool:x=>x},'@/lib/server/auth':{getAuthData:async()=>({user:{_id:'user'}})},
  '@/app/actions/utils':{getSubtitleTracks:async(_,__,options)=>{modes.push(options.navigatorEnglishSDH);return options.navigatorEnglishSDH?[english]:[english,{...english,src:'https://fixture.test/another-provider'}];}},
  '@/app/actions/subtitles':{fetchSubtitleFileContent:async src=>{recoveredDownloads.push(src);return src===english.src?{success:false,error:'broken'}:{success:true,content:text};}},
  './media':{playMedia:{},searchMedia:{}},'./episodes':{createEpisodeTools:()=>({})},
  '@/lib/navigator-structured-output':{generateNavigatorObject(){}},
 });
 assert.equal((await recovery.loadParsedSubtitles({id:'tt123',name:'Movie',type:'movie'},0)).success,true);
 assert.deepEqual(modes,[true,false],'Broken fast provider falls back to the full catalog once');
 assert.deepEqual(recoveredDownloads,[english.src,'https://fixture.test/another-provider'],'Do not redownload a known-broken URL');
 // Exercise the actual server catalog, including cancellation of slow providers.
 const pending=[];
 const actions=load('app/actions/utils.ts',{
  '@/lib/server/auth':{getAuthData:async()=>({user:{_id:'user'}})},
  './auth':{getInstalledAddons:async()=>['first','slow'].map(id=>({transportUrl:`https://${id}.test/manifest.json`,manifest:{id,name:id,resources:['subtitles']}}))},
  '@/lib/server/outbound-fetch':{outboundFetch:(url,{signal})=>new Promise((resolve,reject)=>{pending.push({url,signal,resolve});signal.addEventListener('abort',()=>reject(Error('cancelled')));})},
 },{URL,console:{error(){}}});
 const catalog=actions.getSubtitleTracks('tt123','movie',{navigatorEnglishSDH:true});
 await new Promise(setImmediate);
 pending[0].resolve({ok:true,json:async()=>({subtitles:[{url:english.src,lang:'eng',sdh:true}]})});
 assert.equal((await catalog)[0].language,'eng');
 assert.equal(pending[1].signal.aborted,true,'The actual server stops its slow provider after preferred discovery');
 const start=pending.length;
 let completed=false;
 const full=actions.getSubtitleTracks('tt123','movie').then(value=>{completed=true;return value;});
 await new Promise(setImmediate);
 pending[start].resolve({ok:true,json:async()=>({subtitles:[{url:english.src,lang:'eng',sdh:true}]})});
 await new Promise(setImmediate);assert.equal(completed,false,'Player subtitle menus still wait for the full language list');
 pending[start+1].resolve({ok:true,json:async()=>({subtitles:[{url:'https://fixture.test/es',lang:'spa'}]})});
 assert.equal((await full).length,2);
 console.log('PASS: early English SDH discovery, normal-English fallback, parallel equivalent releases and loser cancellation');
})().catch(error=>{console.error(error);process.exitCode=1;});
