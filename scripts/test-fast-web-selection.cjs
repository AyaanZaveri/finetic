const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const timers = new Map(); let timerId = 0, wallTime = 0;
function load(file) {
    const context = { exports: {}, AbortController, Date: class extends Date { static now() { return wallTime; } },
        setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout(id) { timers.delete(id); },
        require(name) { return load(name.replace('@/', '') + '.ts'); } };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, context);
    return context.exports;
}
const { resolvePlayback } = load('lib/media/resolve-playback.ts');
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
function source() {
    const done = deferred(), listeners = new Set();
    const request = { id: 'movie', type: 'movie', canonicalId: Promise.resolve('movie'), promise: done.promise,
        snapshot: { streams: [], complete: false, pending: 2, total: 2 }, listeners,
        subscribe(listener) { listeners.add(listener); listener(request.snapshot); return () => listeners.delete(listener); },
        publish(streams, complete = false) {
            request.snapshot = { streams, complete, pending: complete ? 0 : 1, total: 2 };
            for (const listener of listeners) listener(request.snapshot);
            if (complete) done.resolve(streams);
        } };
    return request;
}
const stream = id => ({ url: `https://example.test/${id}.mp4`, title: '1080p H264 AAC' });
const request = { id: 'movie', type: 'movie', name: 'Movie' };
const base = { environment: 'web', autoSelectWebStream: true, canPlayType: () => true,
    fetchStreams: async () => { throw Error('Must share progressive discovery'); }, getNextEpisodeForSeries: async () => null };
(async () => {
    const progressive = source(), checks = new Map(), published = [];
    let confirm;
    const pending = resolvePlayback(request, { ...base, createStreamRequest: () => progressive,
        onCandidates: values => published.push(values),
        onPlaybackConfirmation: callback => { confirm = callback; return () => { confirm = undefined; }; },
        verifyStream: candidate => { const check = deferred(); checks.set(candidate.url, check); return check.promise; },
    }, () => {});
    const slow = stream('slow'), fast = stream('fast'), backup = stream('backup');
    progressive.publish([slow, fast]); await flush();
    assert.equal(checks.size, 2, 'Do not wait for every addon before probing available candidates');
    checks.get(fast.url).resolve('supported'); await flush();
    const result = await pending;
    assert.equal(result.streamUrl, fast.url);
    assert.equal(result.streamRequest, progressive, 'Keep live discovery for future fallback');
    progressive.publish([slow, fast, backup]); await flush();
    checks.get(backup.url).resolve('supported'); await flush();
    assert.equal(progressive.listeners.size, 1, 'Track metadata alone is not main-player confirmation');
    confirm(); await flush();
    assert.equal(progressive.listeners.size, 0, 'Playback plus one decode-verified backup stops the pool');
    assert.equal(confirm, undefined);
    checks.get(slow.url).resolve('unknown'); await flush();
    assert.equal(timers.size, 0);
    assert.ok(published.some(values => values.some(value => value.url === backup.url)));

    const cacheSource = source(), probed = [];
    const uncached = { ...stream('uncached'), name: '1080p ⏳ Uncached' };
    const cached = { ...stream('cached'), name: '720p ⚡' };
    const cachePlayback = resolvePlayback(request, { ...base, createStreamRequest: () => cacheSource,
        verifyStream: async candidate => { probed.push(candidate.url); return 'supported'; },
    }, () => {});
    cacheSource.publish([uncached]); await flush();
    assert.equal(probed.length, 0, 'Do not probe uncached URLs: probing can start a download');
    cacheSource.publish([uncached, cached], true);
    assert.equal((await cachePlayback).streamUrl, cached.url);
    assert.deepEqual(probed, [cached.url]);
    const allUncached = source();
    allUncached.publish([uncached], true);
    await assert.rejects(resolvePlayback(request, { ...base, createStreamRequest: () => allUncached,
        verifyStream: async () => assert.fail('Uncached URL must never be probed'),
    }, () => {}), /No playable streams|No compatible/);

    const rankedCache = source(), unmarked = stream('unmarked');
    const cachedProbe = deferred();
    let chosenCache;
    const prioritized = resolvePlayback(request, { ...base, createStreamRequest: () => rankedCache,
        verifyStream: candidate => candidate === cached ? cachedProbe.promise : Promise.resolve('supported'),
    }, () => {}).then(value => { chosenCache = value; return value; });
    rankedCache.publish([unmarked, cached], true); await flush();
    assert.equal(chosenCache, undefined, 'A quick unknown-cache result must not outrun a pending cached source');
    cachedProbe.resolve('supported'); assert.equal((await prioritized).streamUrl, cached.url);
    const unsupportedCache = source();
    unsupportedCache.publish([unmarked, cached], true);
    assert.equal((await resolvePlayback(request, { ...base, createStreamRequest: () => unsupportedCache,
        verifyStream: async candidate => candidate === cached ? 'unsupported' : 'supported',
    }, () => {})).streamUrl, unmarked.url, 'Allow an unmarked source if the cached source is incompatible');

    const canonical = source(); canonical.id = 'tmdb:123'; canonical.canonicalId = Promise.resolve('movie');
    canonical.publish([fast, backup], true);
    const fallback = await resolvePlayback({ ...request, streamRequest: canonical }, { ...base,
        excludeUrls: new Set([fast.url]), verifyStream: async () => 'supported',
    }, () => {});
    assert.equal(fallback.streamUrl, backup.url);

    const sameRelease = { url: 'https://example.test/Show.S02E03.1080p.WEB-DL.H264.AAC-NTb.mp4' };
    const episode = { id: 'show', type: 'series', name: 'Show', mediaSourceId: 'show:2:3',
        episodeReleasePreference: { url: 'https://example.test/Show.S02E02.1080p.WEB-DL.H264.AAC-NTb.mp4' } };
    const matchingSource = source();
    let matched;
    const matchPending = resolvePlayback(episode, { ...base, createStreamRequest: () => matchingSource,
        verifyStream: async () => 'supported',
    }, () => {}).then(result => { matched = result; return result; });
    matchingSource.publish([fast]); await flush();
    assert.equal(matched, undefined, 'Give another add-on a short window to report the matching release');
    matchingSource.publish([fast, sameRelease], true);
    assert.equal((await matchPending).streamUrl, sameRelease.url);
    const unsupported = source();
    unsupported.publish([sameRelease, fast], true);
    assert.equal((await resolvePlayback(episode, { ...base, createStreamRequest: () => unsupported,
        verifyStream: async candidate => candidate === sameRelease ? 'unsupported' : 'supported',
    }, () => {})).streamUrl, fast.url, 'A matched release must still pass browser compatibility checks');

    const similar = { url: 'https://example.test/Show.S02E03.1080p.AAC.H264.WEB-DL.PROPER.mp4' };
    const similaritySource = source();
    similaritySource.publish([fast, similar, sameRelease], true);
    assert.equal((await resolvePlayback(episode, { ...base, createStreamRequest: () => similaritySource,
        verifyStream: async candidate => candidate === sameRelease ? 'unsupported' : 'supported',
    }, () => {})).streamUrl, similar.url, 'A verified similarity match wins when the exact release is unsupported');

    const timed = source(), hanging = deferred(); let timedSignal;
    const timedPending = resolvePlayback({ ...request, streamRequest: timed }, { ...base,
        verifyStream: (_, options) => { timedSignal = options.signal; assert.equal(options.timeoutMs, 45000); return hanging.promise; },
    }, () => {});
    timed.publish([fast]); await flush();
    assert.ok(![...timers.values()].some(timer => timer.ms === 2200), 'There is no timer that promotes unknown streams');
    assert.ok([...timers.values()].some(timer => timer.ms === 45000), 'Stream selection gets a single 45-second deadline');
    assert.ok(![...timers.values()].some(timer => [4000, 8000, 12000].includes(timer.ms)), 'Old short deadlines must not cut checks off');
    wallTime = 44999;
    assert.equal(timedSignal.aborted, false, 'Keep an admitted stream alive until the requested 45-second deadline');
    hanging.resolve('supported'); await flush();
    assert.equal((await timedPending).streamUrl, fast.url);
    timed.publish([fast], true); await flush(); wallTime = 0;
    assert.equal(timed.listeners.size, 0); assert.equal(timers.size, 0);

    const hardTimed = source(), hardHanging = deferred(); let hardSignal;
    const hardPending = resolvePlayback({ ...request, streamRequest: hardTimed }, { ...base,
        verifyStream: (_, options) => { hardSignal = options.signal; return hardHanging.promise; },
    }, () => {});
    hardTimed.publish([fast]); await flush();
    [...timers.values()].find(timer => timer.ms === 45000).fn();
    await assert.rejects(hardPending, /timed out/);
    assert.equal(hardSignal.aborted, true);
    hardHanging.resolve('supported'); await flush(); assert.equal(timers.size, 0);

    // Time and byte exhaustion fail closed instead of starting an unverified source.
    for (const mode of ['time', 'bytes']) {
        const exhausted = source();
        const exhaustedPending = resolvePlayback({ ...request, streamRequest: exhausted }, { ...base,
            inspectStream: async (_, options) => { if (mode === 'bytes') options.budget.remainingBytes = 0; return undefined; },
            verifyStream: async () => { if (mode === 'time') wallTime += 2000; return 'unknown'; },
        }, () => {});
        exhausted.publish(Array.from({ length: 100 }, (_, i) => stream(`${mode}-${i}`)), true);
        await assert.rejects(exhaustedPending, /checking|timed out/);
        await flush(); assert.equal(timers.size, 0); wallTime = 0;
    }

    const cancelled = source(), abort = new AbortController(); let started = 0;
    const cancelledPending = resolvePlayback({ ...request, streamRequest: cancelled }, { ...base, signal: abort.signal,
        verifyStream: async () => { started++; return 'supported'; },
    }, () => {});
    cancelled.publish([fast]); abort.abort(new Error('cancelled'));
    await assert.rejects(cancelledPending, /cancelled/); await flush();
    assert.equal(started, 0, 'Do not start queued probes after cancellation');
    assert.equal(cancelled.listeners.size, 0); assert.equal(timers.size, 0);

    for (const overrides of [{ environment: 'native' }, { autoSelectWebStream: false }]) {
        const original = source(); let ready = false;
        const originalPending = resolvePlayback({ ...request, streamRequest: original }, { ...base, ...overrides,
            verifyStream: async () => assert.fail('Native/default-off playback must not probe'),
        }, () => {}).then(value => { ready = true; return value; });
        original.publish([fast]); await flush(); assert.equal(ready, false);
        original.publish([slow, fast], true); assert.equal((await originalPending).streamUrl, slow.url);
    }
    console.log('PASS: progressive decoder validation, late backups, canonical fallback, fail-closed budgets, cancellation, and native/default-off ordering.');
})().catch(error => { console.error(error); process.exitCode = 1; });
