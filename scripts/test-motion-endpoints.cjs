const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const {compile}=await import('@tailwindcss/node');
 const files=['components/ui/button.tsx','components/media-page/series-details-frame.tsx'];
 const sources=files.map(file=>fs.readFileSync(file,'utf8'));
 const candidates=sources.flatMap(source=>[...source.matchAll(/"([^"\n]+)"/g)].flatMap(match=>match[1].split(/\s+/)));
 const compiler=await compile('@import "tailwindcss";',{base:process.cwd(),onDependency(){}});
 const css=compiler.build(candidates);
 for(const scale of ['1','0.97','1.01']) assert.ok(css.includes(`transform: translateZ(0) scale(${scale})`),`CSS must animate the explicit ${scale} transform endpoint`);
 assert.ok(sources[0].includes('box-shadow,transform]'),'Button press transition owns transform in both directions');
 assert.ok(!sources[0].includes('data-[pressed=true]:scale-'),'No independent scale property is introduced on press');
 assert.ok(sources[1].includes('(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)'),'Logo zoom respects pointer and motion preferences');
 console.log('PASS: generated button and title-logo CSS has stable transform endpoints, both-direction transitions and pointer/motion gating');
})().catch(error=>{console.error(error);process.exitCode=1;});
