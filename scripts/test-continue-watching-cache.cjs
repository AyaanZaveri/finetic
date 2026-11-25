const assert = require('node:assert/strict');
const { QueryClient, QueryObserver, timeoutManager } = require('@tanstack/react-query');
const { load, hooks } = require('./test-support/react-hooks.cjs');
timeoutManager.setTimeoutProvider({ setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout,
 setInterval: (fn, ms) => { const timer = setInterval(fn, ms); timer.unref(); return timer; }, clearInterval });
const { continueWatchingOptions, continueWatchingCardKey } = load('lib/media/continue-watching-query.ts');
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
const cachedItems = [{id:'tt1',type:'movie',name:'Known',year:2014},{id:'tt2',type:'movie',name:'Missing'}];
let refreshed=0, listener, pendingRemovals=[];
let cachedAtMount = cachedItems;
let resumeResult = { data: cachedItems, isPending: false, refetch: () => { refreshed++; } };
const loadSection = h => load('components/home-continue-watching.tsx', {
    './media-section.module.css': { track: 'track' },
 react:h.react,'react/jsx-runtime':h.jsx,
 '@tanstack/react-query':{...require('@tanstack/react-query'),useMutationState:()=>pendingRemovals,useQuery:options=>options.queryKey[0]==='resume-movie-year'?{data:2014}:resumeResult},
 '@/components/stream-query-provider':{useStreamQueries:()=>({scope:'user:session',client:{getQueryData:()=>cachedAtMount}})},
 '@/app/actions/media':{fetchResumeItems(){},fetchResumeMovieYear(){}},
 '@/components/continue-watching-warmup':{ContinueWatchingWarmup:'warmup'},
 '@/components/home-palette-provider':{HomeInitialPalette:'palette'},
 '@/components/media-section':{MediaSection:'row'}, '@/components/ui/skeleton':{Skeleton:'skeleton'},
 '@/lib/artwork':{mediaArtwork:()=>({})},
},{window:{addEventListener:(_,callback)=>{listener=callback;},removeEventListener(){}}}).ContinueWatchingSection;
let h = hooks();
let ContinueWatchingSection = loadSection(h);
const tree=h.render(ContinueWatchingSection);h.flush();
const nodes=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
const row=nodes(tree).find(node=>node.type==='row');
assert.equal(row.props.revealArtwork,true,'A newly mounted cached row fades its artwork like an episode card');
assert.equal(row.props.cardSubtitles[0],undefined,'Known captions do not fetch metadata');
const caption=row.props.cardSubtitles[1];
assert.equal(caption.type(caption.props),'2014','Missing captions resolve separately from the row');
listener({ detail: { playback: 'progress' } });
listener({ detail: { playback: 'start' } });
assert.equal(refreshed,0,'Heartbeats do not read the full library again');
listener({ detail: { playback: 'stopped' } });
assert.equal(refreshed,1,'Closing playback refreshes the row');
listener({});assert.equal(refreshed,2,'Watch-history changes refresh progress without clearing cards');
pendingRemovals=[continueWatchingCardKey(cachedItems[0])];
assert.deepEqual(Array.from(nodes(h.render(ContinueWatchingSection)).find(node=>node.type==='row').props.mediaItems),[cachedItems[1]],'A pending removal hides only the selected card');
pendingRemovals=cachedItems.map(continueWatchingCardKey);
assert.equal(h.render(ContinueWatchingSection),null,'Removing all cards hides the entire section');
pendingRemovals=[];
assert.deepEqual(Array.from(nodes(h.render(ContinueWatchingSection)).find(node=>node.type==='row').props.mediaItems),cachedItems,'A failed removal lets the card return in its original position');
h.unmount();

cachedAtMount = undefined;
h = hooks();
ContinueWatchingSection = loadSection(h);
resumeResult = { ...resumeResult, data: undefined, dataUpdatedAt: 0, isPending: true };
assert.ok(nodes(h.render(ContinueWatchingSection)).some(node => node.type === 'skeleton'));
h.flush();
resumeResult = { ...resumeResult, data: [], isPending: false };
assert.equal(h.render(ContinueWatchingSection),null,'An empty library hides the entire section');
resumeResult = { ...resumeResult, data: cachedItems, dataUpdatedAt: 1, isPending: false };
const restored = nodes(h.render(ContinueWatchingSection));
assert.equal(restored.find(node => node.type === 'row').props.revealArtwork, true);
resumeResult = { ...resumeResult, data: [{ ...cachedItems[0], progressPercent: 25 }], dataUpdatedAt: Date.now() + 1 };
const refreshedRow = nodes(h.render(ContinueWatchingSection));
assert.equal(refreshedRow.find(node => node.type === 'row').props.revealArtwork, true,
    'Refreshing a restored snapshot retains the same reveal policy and stable card keys');
assert.equal(refreshedRow.find(node => node.type === 'row').props.mediaItems[0].progressPercent, 25);
assert.ok(!refreshedRow.some(node => node.type === 'skeleton'));
h.unmount();

h = hooks();
ContinueWatchingSection = loadSection(h);
resumeResult = { ...resumeResult, dataUpdatedAt: Date.now() + 10_000 };
assert.equal(nodes(h.render(ContinueWatchingSection)).find(node => node.type === 'row').props.revealArtwork, true,
    'The first live response on a cold start still reveals the artwork');
h.unmount();
