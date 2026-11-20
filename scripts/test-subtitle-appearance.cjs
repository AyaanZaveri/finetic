const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load,hooks}=require('./test-support/react-hooks.cjs');
const appearance=load('lib/subtitle-appearance.ts');
const storage=new Map();
function mount(){
 const host=hooks();const context=load('contexts/settings-context.tsx',{'react':host.react,'react/jsx-runtime':host.jsx,'@/lib/subtitle-appearance':appearance,'@/lib/media/playback-preferences':load('lib/media/playback-preferences.ts',{}, {localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}})},{localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}});
 host.render(context.SettingsProvider,{children:null});host.flush();host.render(context.SettingsProvider,{children:null});
 return {get value(){return context.useSettings();},render(){host.render(context.SettingsProvider,{children:null});}};
}
let settings=mount();assert.equal(settings.value.subtitleSize,'standard');assert.equal(settings.value.subtitleOutline,'thin');
assert.equal(appearance.stepSubtitleSize('standard', 1), 'large');
assert.equal(appearance.stepSubtitleSize('standard', -1), 'small');
assert.equal(appearance.stepSubtitleSize('large', 1), 'large');
assert.equal(appearance.stepSubtitleSize('small', -1), 'small');
assert.equal(settings.value.subtitlePosition,10);
settings.value.setSubtitlePosition(18);settings.render();settings=mount();assert.equal(settings.value.subtitlePosition,18);
settings.value.setSubtitlePosition(100);settings.render();assert.equal(settings.value.subtitlePosition,30);
settings.value.setSubtitlePosition(-5);settings.render();assert.equal(settings.value.subtitlePosition,5);
for(const corrupt of ['NaN','Infinity','not-a-number','']) {
 storage.set('navigator-subtitle-position',corrupt);settings=mount();assert.equal(settings.value.subtitlePosition,10);
}
settings.value.setSubtitleSize('large');settings.value.setSubtitleOutline('strong');settings.render();
assert.equal(settings.value.subtitleSize,'large');assert.equal(settings.value.subtitleOutline,'strong');
settings=mount();assert.equal(settings.value.subtitleSize,'large');assert.equal(settings.value.subtitleOutline,'strong');
storage.set('navigator-subtitle-size','huge');storage.set('navigator-subtitle-outline','blur');
settings=mount();assert.equal(settings.value.subtitleSize,'standard');assert.equal(settings.value.subtitleOutline,'thin');
settings.value.setSubtitleWeight('bold');settings.value.setSubtitleColor('yellow');settings.render();
assert.equal(settings.value.subtitleWeight,'bold');assert.equal(settings.value.subtitleColor,'yellow');
settings=mount();assert.equal(settings.value.subtitleWeight,'bold');assert.equal(settings.value.subtitleColor,'yellow');
storage.set('navigator-subtitle-weight','1000');storage.set('navigator-subtitle-color','<invalid>');
settings=mount();assert.equal(settings.value.subtitleWeight,'medium');assert.equal(settings.value.subtitleColor,'white');
settings.value.setSubtitleSize('large');settings.value.setSubtitleOutline('strong');
settings.value.setSubtitleWeight('bold');settings.value.setSubtitleColor('light-blue');settings.render();
settings.value.setSubtitlePosition(25);settings.render();
settings.value.resetSubtitleAppearance();settings.render();settings=mount();
assert.equal(settings.value.subtitleSize,'standard');assert.equal(settings.value.subtitleOutline,'thin');
assert.equal(settings.value.subtitleWeight,'medium');assert.equal(settings.value.subtitleColor,'white');
assert.equal(settings.value.subtitlePosition,10);
const host=hooks();const {SubtitleText}=load('components/subtitle-text.tsx',{'react/jsx-runtime':host.jsx,'./subtitle-text.module.css':{default:{text:'subtitle-text'}},'@/lib/subtitle-appearance':appearance,'@/lib/media/playback-preferences':load('lib/media/playback-preferences.ts',{}, {localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}})});
const text=SubtitleText({children:'A bright scene.\nA dark scene.'});
assert.equal(text.props['data-subtitle-outline'],'thin');assert.equal(text.props['data-player-native-glass'],undefined);
assert.equal(text.props['data-player-glass'],undefined);assert.equal(text.props.children,'A bright scene.\nA dark scene.');
const colored=SubtitleText({weight:'semibold',color:'yellow',children:'A line of text.'});
assert.equal(colored.props['data-subtitle-weight'],'semibold');assert.equal(colored.props.style['--subtitle-color'],'#ffe45c');
const source=fs.readFileSync('components/player-clock-islands.tsx','utf8');
assert.match(source, /<SubtitleText/);assert.doesNotMatch(source,/data-player-native-glass|backdrop-blur|bg-black/);
console.log('PASS: subtitle defaults, saved preferences, invalid-value recovery and sampler-free cue rendering');
