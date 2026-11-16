// Real HTML video/canvas integration using macOS WebKit; no server or user profile.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
if (process.platform !== 'darwin') { console.log('SKIP: native WebKit preview check requires macOS'); process.exit(0); }
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'navigator-webkit-preview-'));
try {
    const source = ts.transpileModule(fs.readFileSync('lib/media/preview-frames.ts', 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const video = 'data:video/mp4;base64,' + fs.readFileSync('scripts/fixtures/seek-preview.mp4').toString('base64');
    const html = path.join(temporary, 'preview.html');
    fs.writeFileSync(html, `<video id="main" muted playsinline preload="auto" src="${video}"></video><video id="preview" muted playsinline preload="auto" src="${video}"></video><script>var exports={};${source}</script>`);
    const script = path.join(temporary, 'check.js');
    fs.writeFileSync(script, `
        const wait = (target, event) => new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Timed out: '+event)), 8000);
            target.addEventListener(event, () => {clearTimeout(timer); resolve();}, {once:true});
        });
        const main = document.getElementById('main'), video = document.getElementById('preview');
        await Promise.all([main, video].map(v => v.readyState>=2 ? undefined : wait(v,'loadeddata')));
        const pausedAt = 0.4;
        const positioned = wait(main,'seeked'); main.currentTime = pausedAt; await positioned;
        let callback;
        const answers=[];
        const provider = new exports.BrowserPreviewFrames(video, (...args) => {answers.push(args);callback?.(args);});
        const ask = (at) => new Promise((resolve,reject) => {
            const timer=setTimeout(()=>reject(new Error('No preview frame')),8000);
            callback=(args)=>{clearTimeout(timer);resolve(args);}; provider.want(at);
        });
        const first = await ask(1.5);
        if(!first[1]?.startsWith('blob:') || (await (await fetch(first[1])).blob()).type!=='image/jpeg')throw new Error('Real canvas binary JPEG capture failed');
        const second = await ask(0);
        const before=video.currentTime;
        const cached = await ask(1.5);
        if(cached[1]!==first[1] || video.currentTime!==before)throw new Error('Cache hit sought or changed the auxiliary decoder');
        if(Math.abs(main.currentTime-pausedAt)>0.05)throw new Error('Preview changed main playback position');
        provider.dispose();
        return JSON.stringify({jpeg:true,cache:true,mainTime:main.currentTime,frames:answers.length});
    `);
    const executable = path.join(temporary, 'webkit-check');
    execFileSync('clang', ['-fobjc-arc', '-framework', 'Cocoa', '-framework', 'WebKit', 'scripts/webkit-image-layout.m', '-o', executable]);
    const result = JSON.parse(execFileSync(executable, [html, script], { encoding:'utf8', timeout:30000 }));
    assert.equal(result.jpeg, true); assert.equal(result.cache, true);
    console.log('PASS: real WebKit video seek → binary canvas JPEG, instant cache reuse, and unchanged main playback');
} finally { fs.rmSync(temporary, { recursive:true, force:true }); }
