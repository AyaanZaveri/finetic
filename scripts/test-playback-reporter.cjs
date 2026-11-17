const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');
const timers = [];
const { createPlaybackReporter, PROGRESS_REPORT_INTERVAL_MS } = load('lib/media/playback-reporter.ts', {}, {
    crypto: require('node:crypto'),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
});
const tick = () => new Promise(setImmediate);
const input = { libraryItemId: 'tt123', videoId: 'tt123:1:2', mediaType: 'series', mediaName: 'Show', currentTimeSeconds: 0, durationSeconds: 1000 };

(async () => {
    let now = 0;
    const writes = [];
    const reporter = createPlaybackReporter(async (kind, value) => { writes.push({ kind, ...value }); return true; }, () => now);
    reporter.begin(); reporter.report('start', input); await tick();
    reporter.observe(0, false, false);
    for (let i = 1; i <= 300; i++) {
        now = i * 100;
        reporter.observe(i / 10, false, false);
        reporter.report('progress', { ...input, currentTimeSeconds: i / 10 }, true);
    }
    await tick();
    assert.equal(PROGRESS_REPORT_INTERVAL_MS, 30000);
    assert.equal(writes.length, 2, '300 clock events produce one periodic write');
    assert.ok(Math.abs(writes[1].watchedTimeSeconds - 30) < .001);
    reporter.report('progress', { ...input, currentTimeSeconds: 30 }); await tick();
    assert.equal(writes.length, 2, 'Unchanged pause does not duplicate a saved position');
    now += 100; reporter.observe(900, false, true);
    now += 100; reporter.observe(900, false, false);
    now += 100; reporter.observe(10, false, false);
    reporter.report('progress', { ...input, currentTimeSeconds: 10 }); await tick();
    assert.equal(writes.at(-1).currentTimeSeconds, 10, 'Backward seek flushes immediately');
    assert.ok(Math.abs(writes.at(-1).watchedTimeSeconds - 30) < .001, 'Seeks add no watched time');
    now += 60000; reporter.observe(10, true, false);
    reporter.report('progress', { ...input, currentTimeSeconds: 10 }, true); await tick();
    assert.equal(writes.length, 3, 'Paused clock events do not keep writing');
    reporter.report('stopped', { ...input, currentTimeSeconds: 10 }); await tick();
    assert.equal(writes.at(-1).kind, 'stopped');

    const pending = [], ordered = [];
    const slow = createPlaybackReporter((kind, value) => {
        ordered.push({ kind, ...value }); return new Promise(resolve => pending.push(resolve));
    }, () => now);
    slow.begin(); slow.report('start', input);
    slow.report('progress', { ...input, currentTimeSeconds: 1 });
    slow.report('progress', { ...input, currentTimeSeconds: 2 });
    slow.report('stopped', { ...input, currentTimeSeconds: 3 });
    slow.begin(); slow.report('start', { ...input, videoId: 'tt123:1:3' });
    assert.equal(ordered.length, 1, 'Only one request can be in flight');
    pending.shift()(true); await tick();
    assert.equal(ordered[1].currentTimeSeconds, 2, 'Pending progress coalesces to the latest snapshot');
    pending.shift()(true); await tick();
    assert.equal(ordered[2].kind, 'stopped');
    pending.shift()(true); await tick();
    assert.equal(ordered[3].kind, 'start', 'Old episode stop precedes new episode start');
    assert.notEqual(ordered[2].sessionId, ordered[3].sessionId);
    pending.shift()(true); await tick();

    let attempts = 0;
    const retry = createPlaybackReporter(async () => ++attempts > 1, () => now);
    retry.begin(); retry.report('start', input); await tick();
    assert.equal(attempts, 1);
    assert.equal(timers[0].ms, 30000, 'Failure waits before retrying');
    timers.shift().fn(); await tick();
    assert.equal(attempts, 2);
    const limited = createPlaybackReporter(async () => ({ retryAfterMs: 120000 }), () => now);
    limited.begin(); limited.report('start', input); await tick();
    assert.equal(timers.shift().ms, 120000, 'Server Retry-After takes precedence over local backoff');
    limited.cancel();
    const cancelled = [], cancelPending = [];
    const scoped = createPlaybackReporter((kind, value) => {
        cancelled.push(value); return new Promise(resolve => cancelPending.push(resolve));
    }, () => now);
    scoped.begin(); scoped.report('start', input);
    scoped.report('progress', { ...input, currentTimeSeconds: 1 });
    scoped.cancel(); cancelPending.shift()(false); await tick();
    assert.equal(cancelled.length, 1, 'Account cleanup discards pending work');
    assert.equal(timers.length, 0, 'A failed in-flight request cannot schedule retries after cleanup');
    console.log('PASS: 30s cadence, unchanged suppression, local watch accounting, seeks, serialization, coalescing, episode order and retry backoff');
})().catch(error => { console.error(error); process.exitCode = 1; });
