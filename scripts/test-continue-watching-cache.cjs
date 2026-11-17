const assert = require('node:assert/strict');
const { QueryClient, QueryObserver, timeoutManager } = require('@tanstack/react-query');
const { load, hooks } = require('./test-support/react-hooks.cjs');
timeoutManager.setTimeoutProvider({ setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout,
 setInterval: (fn, ms) => { const timer = setInterval(fn, ms); timer.unref(); return timer; }, clearInterval });
const { continueWatchingOptions } = load('lib/media/continue-watching-query.ts');
(async () => {
 const client = new QueryClient();
 let finish, calls=0;
 const item = { id:'tt123', type:'movie', name:'Movie', background:'/backdrop.jpg', logo:'/logo.png', progressPercent:10 };
 const read = () => { calls++; return new Promise(resolve => { finish=resolve; }); };
 const options = continueWatchingOptions('account-a:session', read);
 let observer = new QueryObserver(client, options);
 let unsubscribe = observer.subscribe(() => {});
 finish([item]); await new Promise(setImmediate);
 assert.equal(observer.getCurrentResult().data[0].progressPercent,10);
 unsubscribe();
 observer = new QueryObserver(client, options);
 unsubscribe=observer.subscribe(() => {});
 assert.equal(calls,2,'Returning home refreshes progress');
 assert.equal(observer.getCurrentResult().isPending,false,'Navigation never replaces cached cards with skeletons');
 assert.equal(observer.getCurrentResult().data[0].logo,'/logo.png','Artwork stays present during refresh');
 finish([{...item, progressPercent:25}]); await new Promise(setImmediate);
 assert.equal(observer.getCurrentResult().data[0].progressPercent,25);
 const other = new QueryObserver(client, continueWatchingOptions('account-b:session',read));
 assert.equal(other.getCurrentResult().data,undefined,'Account caches cannot leak across sessions');
 observer.setOptions({...options,queryFn:async()=>{throw Error('offline');}});
 await observer.refetch();
 assert.equal(observer.getCurrentResult().data[0].progressPercent,25,'A failed refresh retains existing cards');
 unsubscribe();client.clear();
 console.log('PASS: home remount keeps cards, refreshes progress, retains data on failure and isolates accounts');
})().catch(error=>{console.error(error);process.exitCode=1;});

// Exercise the row's actual cached render, including optional captions and watcher.
const h = hooks();
const cachedItems = [{id:'tt1',type:'movie',name:'Known',year:2014},{id:'tt2',type:'movie',name:'Missing'}];
let refreshed=0, listener;
const { ContinueWatchingSection } = load('components/home-continue-watching.tsx', {
 react:h.react,'react/jsx-runtime':h.jsx,
 '@tanstack/react-query':{...require('@tanstack/react-query'),useQuery:options=>options.queryKey[0]==='resume-movie-year'?{data:2014}:{data:cachedItems,isPending:false,refetch:()=>{refreshed++;}}},
 '@/components/stream-query-provider':{useStreamQueries:()=>({scope:'user:session',client:{getQueryData:()=>cachedItems}})},
 '@/app/actions/media':{fetchResumeItems(){},fetchResumeMovieYear(){}},
 '@/components/continue-watching-warmup':{ContinueWatchingWarmup:'warmup'},
 '@/components/home-palette-provider':{HomeInitialPalette:'palette'},
 '@/components/media-section':{MediaSection:'row'}, '@/components/ui/skeleton':{Skeleton:'skeleton'},
 '@/lib/artwork':{mediaArtwork:()=>({})},
},{window:{addEventListener:(_,callback)=>{listener=callback;},removeEventListener(){}}});
const tree=h.render(ContinueWatchingSection);h.flush();
const nodes=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
const row=nodes(tree).find(node=>node.type==='row');
assert.equal(row.props.revealArtwork,false,'Returning home does not replay cached artwork and logo fades');
assert.equal(row.props.cardSubtitles[0],undefined,'Known captions do not fetch metadata');
const caption=row.props.cardSubtitles[1];
assert.equal(caption.type(caption.props),'2014','Missing captions resolve separately from the row');
listener();assert.equal(refreshed,1,'Watch-history changes refresh progress without clearing cards');
h.unmount();
