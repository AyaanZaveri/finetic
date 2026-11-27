const assert = require('node:assert/strict');
const { QueryClient } = require('@tanstack/react-query');
const { load } = require('./test-support/react-hooks.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; return { promise: new Promise(yes => resolve = yes), resolve }; };
const downloads = [];
class Image {
    constructor() { downloads.push(this); }
    set src(value) { this.source = value; }
    removeAttribute() { this.source = ''; }
}
const document = { baseURI: 'https://app.test', images: [{ src: 'https://app.test/existing.png' }] };
const api = load('lib/media/metadata-warmup.ts', {}, { document, Image, URL });
(async () => {
    const images = api.createMetadataImageQueue();
    images.add('/existing.png'); assert.equal(downloads.length, 0, 'Existing pending DOM artwork is reused');
    images.add('/a.png'); images.add('/b.png'); images.add('/c.png');
    assert.equal(downloads.length, 2); assert.equal(downloads[0].fetchPriority, 'low');
    downloads[0].onload(); assert.equal(downloads.length, 3); images.clear();
    images.add('https://image.tmdb.org/t/p/original/logo.png', 'anonymous');
    assert.equal(downloads.at(-1).crossOrigin, 'anonymous', 'Warm logo bytes in the same mode as the visible logo');
    images.clear();
    const work = [], cache = new Map(); let canceled = 0;
    const client = new QueryClient();
    const warmer = api.createMetadataWarmup({ scope: 'session', client,
        async prepare(media, purpose, signal) { const pending = deferred(); work.push({ media, purpose, signal, ...pending }); return pending.promise; },
        peek(media) { return cache.get(media.id) || {}; }, cancelSpeculation() { canceled++; },
    });
    const target = id => ({ id, name: id, type: 'movie' });
    warmer.enqueue(target('off')); assert.equal(work.length, 0);
    warmer.setAllowed(true);
    ['a', 'b', 'c', 'd'].forEach(id => warmer.enqueue(target(id)));
    assert.equal(work.length, 2, 'Only two metadata targets prepare concurrently');
    warmer.enqueue(target('intent'), true); work[0].resolve([]); await tick();
    assert.equal(work[2].media.id, 'intent', 'Intent is ahead of queued visible cards');
    cache.set('intent', { title: { data: { artwork: { logo: '/logo.png', backdrop: '/backdrop.png', poster: 'https://images.metahub.space/poster/small/tt123/img' } } } });
    const before = downloads.length; work[2].resolve([]); await tick();
    assert.equal(downloads[before].source, '/logo.png'); assert.equal(downloads[before + 1].source, '/backdrop.png', 'Deliberate intent can warm the full backdrop');
    cache.set('b', { title: { data: { artwork: { logo: '/automatic-logo.png', backdrop: '/never-automatic.png' } } }, episode: { data: { still: 'https://image.tmdb.org/t/p/w500/still.png' } } });
    work[1].resolve([]); await tick();
    downloads[before].onload(); downloads[before + 1].onload();
    const detailPoster = downloads.find(image => image.source === 'https://images.metahub.space/poster/large/tt123/img');
    assert.ok(detailPoster, 'Warm the exact large poster used by the detail page');
    detailPoster.onload();
    assert.ok(downloads.some(image => image.source === '/automatic-logo.png'));
    assert.ok(downloads.some(image => image.source === 'https://image.tmdb.org/t/p/w1280/still.png'));
    assert.ok(!downloads.some(image => image.source === '/never-automatic.png'), 'Automatic warmup excludes full backdrops');
    const count = work.length; warmer.enqueue(target('b')); assert.equal(work.length, count, 'Idle cards do not continually refresh');
    warmer.setAllowed(false); assert.ok(work.slice(3).every(item => item.signal.aborted)); assert.ok(canceled);
    warmer.setAllowed(true);
    const known = { ...target('known'), backdropUrl: '/known-backdrop.jpg' };
    warmer.enqueue(known, true);
    assert.equal(downloads.at(-1).source, known.backdropUrl, 'Intent warms supplied artwork before the metadata request resolves');
    warmer.setAllowed(false);
    work.forEach(item => item.resolve([])); await tick(); warmer.dispose(); client.clear();
    console.log('Metadata queue concurrency, intent priority, guards, idle reuse, cancellation and separate image budget passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
