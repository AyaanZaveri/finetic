const assert = require('node:assert/strict');
const { load, hooks } = require('./test-support/react-hooks.cjs');
const flags = load('lib/media/track-flags.ts');
const labels = load('lib/media/track-label.ts', { './track-flags': flags }, { URL });
const names = ['DropdownMenu','DropdownMenuTrigger','DropdownMenuContent','DropdownMenuGroup','DropdownMenuLabel','DropdownMenuRadioGroup','DropdownMenuRadioItem','DropdownMenuSeparator','DropdownMenuItem'];
function find(tree,type) {
 if (Array.isArray(tree)) return tree.flatMap(node=>find(node,type));
 if (!tree || typeof tree !== 'object') return [];
 return [...(tree.type===type?[tree]:[]),...find(tree.props?.children,type)];
}
function mount(native) {
 const host=hooks(), events=new Map(), calls=[], external=[];
 const textTracks=Object.assign([
  {kind:'metadata', language:'en', label:'Chapter metadata',mode:'hidden'},
  {kind:'subtitles',language:'en',label:'English SDH',mode:'disabled'},
 ],{addEventListener:(name,fn)=>events.set('text:'+name,fn),removeEventListener:name=>events.delete('text:'+name)});
 const controller={tracks:[{id:42,type:'audio',lang:'eng'}, {id:91,type:'sub',lang:'tur'}, {id:75,type:'sub',lang:'eng',selected:true}],selectTrack:(...args)=>calls.push(args)};
 const container={};
 const mediaRef={current:{controller,textTracks,closest:()=>container,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)}};
 const {PlayerSubtitles}=load('components/player-subtitles.tsx',{
  react:host.react,'react/jsx-runtime':host.jsx,'@/components/ui/button':{Button:'Button'},
  '@/components/ui/scroll-area':{ScrollArea:'ScrollArea'},
  '@/components/ui/media-player':{MediaPlayerTooltip:'MediaPlayerTooltip'},
  '@/components/arc/dropdown-menu/dropdown-menu':Object.fromEntries(names.map(n=>[n,n])),
  '@/lib/media/track-label':labels,'./player-subtitles.module.css':{},
 });
 let closed=0,opened=0;
 const tracks=[{src:'https://files.test/first',language:'eng',label:'English first',active:false}, {src:'https://files.test/second?token=private',language:'eng',label:'English second',active:false}];
 const props={mediaRef,sourceKey:'one',native,tracks,onTrackChange:track=>external.push(track),timing:{seconds:.3,open:false,onOpen(){opened++},onClose(){closed++}}};
 const render=()=>host.render(PlayerSubtitles,props);
 render();host.flush();const tree=render();
 return {tree,host,events,calls,external,textTracks,controller,props,render,container,get opened(){return opened},get closed(){return closed}};
}
const native=mount(true);
assert.equal(native.tree.props.modal,false);
assert.equal(find(native.tree,'MediaPlayerTooltip')[0].props.shortcut,'C');
assert.equal(find(native.tree,'Button')[0].props['aria-keyshortcuts'],'C');
const content=find(native.tree,'DropdownMenuContent')[0];
assert.equal(content.props.container,native.container);
assert.ok(Object.hasOwn(content.props,'data-player-native-glass'));
const choices=find(native.tree,'DropdownMenuRadioItem');
assert.deepEqual(choices.map(node=>node.props.value),['off','embedded:75','embedded:91','external:0','external:1']);
assert.equal(find(native.tree,'DropdownMenuRadioGroup')[0].props.value,'embedded:75');
assert.deepEqual(find(native.tree,'DropdownMenuLabel').map(n=>n.props.children),['Embedded','External']);
assert.equal(find(native.tree,'DropdownMenuSeparator').length,3);
assert.equal(find(native.tree,'ScrollArea').length,1,'Track scrolling belongs to a viewport inside the glass shell');
const select=find(native.tree,'DropdownMenuRadioGroup')[0].props.onValueChange;
select('external:1');assert.equal(native.external.at(-1),native.props.tracks[1]);
select('embedded:91');assert.equal(native.external.at(-1),null);assert.deepEqual(native.calls.at(-1),['subtitle','91']);
select('off');assert.deepEqual(native.calls.at(-1),['subtitle','no']);
const count=native.calls.length;select('embedded:999');select('external:999');assert.equal(native.calls.length,count);
let prevented=false;
find(native.tree,'DropdownMenuItem')[0].props.onSelect({preventDefault(){prevented=true}});assert.ok(prevented);assert.equal(native.opened,1);
native.tree.props.onOpenChange(false);assert.equal(native.closed,1);
native.props.requestedSrc=native.props.tracks[0].src;
assert.equal(find(native.render(),'DropdownMenuRadioGroup')[0].props.value,'external:0','Requested track is selected during download');
assert.equal(find(native.render(),'DropdownMenuRadioItem').find(n=>n.props.value==='external:0').props['aria-busy'],true);
native.props.requestedSrc=null;
native.props.tracks[1].active=true;
assert.equal(find(native.render(),'DropdownMenuRadioGroup')[0].props.value,'external:1');
native.controller.tracks=[];native.events.get('emptied')();
assert.equal(find(native.render(),'DropdownMenuRadioItem').filter(n=>n.props.value.startsWith('embedded:')).length,0,'Source replacement clears previous embedded tracks');
native.host.unmount();assert.equal(native.events.size,0);
const web=mount(false), choose=find(web.tree,'DropdownMenuRadioGroup')[0].props.onValueChange;
choose('embedded:1');assert.equal(web.textTracks[1].mode,'showing');
choose('external:0');assert.equal(web.textTracks[1].mode,'showing','Keep applied embedded captions until the external file is ready');
choose('off');assert.equal(web.textTracks[1].mode,'disabled');
assert.equal(web.textTracks[0].mode,'hidden','Subtitle selection must preserve chapter/metadata tracks');
assert.ok(!find(web.tree,'DropdownMenuRadioItem').some(n=>n.props.value==='embedded:0'),'Metadata tracks must never become caption choices');
web.host.unmount();assert.equal(web.events.size,0);
console.log('PASS: one subtitle menu, embedded-before-external grouping, Off, actual decoder IDs, web track modes, timing, scrolling ownership and source cleanup');
