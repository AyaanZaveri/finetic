const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { load } = require('./test-support/react-hooks.cjs');
const helpers = load('lib/aurora-palette.ts');
const homeColors = load('lib/home-palette-colors.ts', { './aurora-palette': helpers });
const settle = () => new Promise(resolve => setImmediate(resolve));

async function realPipeline() {
    const messages = [];
    const self = { postMessage: value => messages.push(value) };
    load('lib/palette.worker.ts', { './home-palette-colors': homeColors }, { self });
    const pixels = new Uint8ClampedArray(160 * 90 * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set(i % 3 ? [230, 60, 20, 255] : [20, 50, 210, 255], i);
    await self.onmessage({ data: { id: 9, pixels } });
    assert.equal(messages[0].id, 9); assert.equal(messages[0].colors.length, 3);
    assert.ok(messages[0].colors.every(color => /^#[0-9a-f]{6}$/i.test(color)));
    await self.onmessage({ data: { id: 10, pixels: new Uint8ClampedArray() } });
    assert.equal(messages.at(-1).colors, null, 'Malformed samples return a bounded failure');
}

function fixture() {
    const workers = [], images = [], timers = new Map();
    let timerId = 0, failNext = false;
    class FakeWorker {
        constructor(url, options) {
            assert.ok(url.pathname.endsWith('/palette.worker.ts')); assert.equal(options.type, 'module');
            workers.push(this);
        }
        terminate() { this.terminated = true; }
        postMessage(payload, transfers) {
            assert.equal(transfers[0], payload.pixels.buffer, 'Pixel buffer is transferred to the worker');
            assert.ok(payload.pixels.length <= 160 * 160 * 4);
            this.payload = payload;
            if (failNext) {
                failNext = false;
                queueMicrotask(() => this.onerror?.({ preventDefault() {} }));
            }
        }
        complete(colors) { this.onmessage?.({ data: { id: this.payload.id, colors } }); }
    }
    class FakeImage {
        naturalWidth = 780; naturalHeight = 440;
        set src(value) {
            if (!value) return;
            this.source = value; images.push(this);
            if (value.includes('stalled')) return;
            queueMicrotask(() => value.includes('broken') ? this.onerror?.() : this.onload?.());
        }
    }
    const dimensions = [];
    const document = { createElement() {
        const canvas = { width: 0, height: 0 };
        canvas.getContext = () => ({
            drawImage(_image, _x, _y, width, height) { dimensions.push([width, height]); },
            getImageData: () => ({ data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }),
        });
        return canvas;
    } };
    const context = { exports: {}, Worker: FakeWorker, Image: FakeImage, URL, AbortController, Uint8ClampedArray, document,
        setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout(id) { timers.delete(id); },
    };
    const source = fs.readFileSync('lib/palette-worker-client.ts', 'utf8').replace('import.meta.url', '"file:///navigator/lib/palette-worker-client.ts"');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
    return { extract: context.exports.extractHomePalette, workers, images, dimensions, timers,
        failNext() { failNext = true; },
        expire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } },
    };
}
async function client() {
    const f = fixture(), red = ['#ff4400', '#ffaa00', '#bb2200'];
    const a = f.extract(['first']); await settle();
    assert.equal(f.workers.length, 1); assert.equal(f.dimensions[0][0], 160);
    const b = f.extract(['second']); const c = f.extract(['third']);
    assert.equal(await b, null, 'Intermediate queued work is dropped');
    f.workers[0].complete(red); assert.equal(await a, null, 'A superseded running job cannot publish');
    await settle(); assert.equal(f.workers.length, 1, 'One worker is reused');
    assert.equal(f.images.at(-1).source, 'third');
    f.workers[0].complete(red); assert.deepEqual(await c, red);
    const stalled = f.extract(['stalled']); await settle();
    const latest = f.extract(['broken', 'poster']); assert.equal(await stalled, null, 'A stale network load is aborted immediately');
    await settle(); assert.equal(f.images.at(-1).source, 'poster', 'Artwork failure reaches the alternate sample');
    f.workers[0].complete(red); await latest;
    assert.equal(f.timers.size, 1, 'Only the idle worker timer remains after settling');
    f.expire(30000); assert.equal(f.workers[0].terminated, true);
    f.failNext(); const retry = f.extract(['retry']); await settle();
    assert.equal(f.workers.length, 3, 'A worker crash creates one replacement');
    assert.equal(f.workers[1].terminated, true);
    f.workers[2].complete(red); assert.deepEqual(await retry, red, 'Retry retains usable pixels after transfer');
    f.expire(30000);
    const timed = f.extract(['timeout']); await settle(); f.expire(2000); await settle();
    f.expire(2000); assert.equal(await timed, null, 'Two stalled worker attempts fail safely');
    f.expire(30000);
}
async function cache() {
    const calls = [], artwork = load('lib/artwork.ts', {}, { URLSearchParams });
    const vibrant = { from: () => ({ maxDimension() { return this; },
        getPalette: async () => ({ Vibrant: { hex: '#ffcc00', population: 500 } }),
    }) };
    const loader = load('lib/aurora-palette-loader.ts', {
        '@/lib/artwork': artwork, '@/lib/aurora-palette': helpers,
        'node-vibrant/browser': { Vibrant: vibrant },
        './palette-worker-client': { extractHomePalette: sources => { calls.push(sources); return Promise.resolve(['#ff0000', '#aa0000', '#880000']); } },
    }, { URLSearchParams, Image: class {} });
    const aurora = await loader.loadAuroraPalette('https://image.tmdb.org/t/p/w780/tt1.jpg');
    const a = loader.loadHomePalette('https://image.tmdb.org/t/p/w780/tt1.jpg');
    assert.equal(a, loader.loadHomePalette('https://image.tmdb.org/t/p/w1280/tt1.jpg'));
    const colors = await a;
    assert.notEqual(colors[0], aurora[0], 'A cached vibrant Aurora palette must not replace Home dominant colors');
    assert.equal(await loader.loadHomePalette('https://image.tmdb.org/t/p/w300/tt1.jpg'), colors);
    assert.equal(calls.length, 1); assert.ok(!calls[0][0].includes('width='));
    assert.ok(calls[0][0].startsWith('https://wsrv.nl/'));
    assert.ok(calls[0][0].startsWith('https://wsrv.nl/') && calls[0][1].startsWith('https://image.tmdb.org/'), 'Use external sampling first with a direct fallback');
    assert.equal(await loader.loadHomePalette(), null, 'No artwork retains home emerald rather than an unrelated Aurora default');
    const source = 'https://image.tmdb.org/t/p/w780/tt2.jpg';
    const homeFirst = await loader.loadHomePalette(source);
    assert.notEqual((await loader.loadAuroraPalette(source))[0], homeFirst[0], 'Detail pages also retain vibrant selection after a Home visit');
}
(async () => {
    await realPipeline(); await client(); await cache();
    console.log('PASS: real Vibrant worker pipeline, bounded pixels, transferred buffers, latest-only queue, immediate stale-load cancellation, alternate artwork, restart/timeouts and normalized shared cache.');
})().catch(error => { console.error(error); process.exitCode = 1; });
