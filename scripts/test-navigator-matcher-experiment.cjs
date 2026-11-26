// Deterministic checks of experimental matcher bookkeeping. No network/model calls.
const assert = require('node:assert/strict');
const { z } = require('zod');
const { normalizeInterval, validInterval, project, candidateWindows, experimentalMatcher } = require('./navigator-matcher-experiment.cjs');

const cues = [
    { timestamp: 1.2, endTimestamp: 2.1, text: 'Unrelated' },
    { timestamp: 100.2, endTimestamp: 101, text: '<i>Earlier context</i>' },
    { timestamp: 105.3, endTimestamp: 106.1, text: 'Requested line' },
    { timestamp: 111.4, endTimestamp: 113.2, text: 'Response' },
    { timestamp: 300, endTimestamp: 301, text: 'Another scene' },
];
const start = { startCue: 'C3', evidence: ['C2', 'C3', 'C4'] };
const normalized = normalizeInterval(start);
assert.deepEqual(JSON.parse(JSON.stringify(normalized)), { start: 3, first: 2, end: 4, evidence: [2, 3, 4] });
assert.equal(project(cues, normalized).timestamp, 105.3, 'Earlier context must not change the seek time');
assert.equal(project(cues, normalized).evidence[0].text, '[italic] Earlier context');
assert.match(candidateWindows(cues, [normalized]), /C2\|\[italic\] Earlier context/);
assert.doesNotMatch(candidateWindows(cues, [normalized]), /C1\||C5\|/);
for (const invalid of [
    { startCue: '105', evidence: ['C3'] },
    { startCue: 'C0', evidence: ['C3'] },
    { startCue: 'C6', evidence: ['C3'] },
    { startCue: 'C3', evidence: ['C6'] },
    { startCue: 'C3', evidence: [] },
    { startCue: 'C3', evidence: ['C1'] },
    { startCue: 'C3', evidence: ['C5'] },
]) assert.equal(validInterval(cues, normalizeInterval(invalid)), false);

async function run(outputs) {
    let calls = 0;
    const result = await experimentalMatcher({ cues, context: 'Find the requested line', z, model: {},
        generate: async ({ schema, prompt }) => {
            if (calls === 1) assert.doesNotMatch(prompt, /C1\|Unrelated|C5\|Another scene/);
            const output = schema.parse(outputs[calls++]);
            return { output, totalUsage: { inputTokens: 100, outputTokens: 10 } };
        } });
    return { ...result, calls };
}

(async () => {
    const proposal = { status: 'matched', candidates: [start] };
    const accepted = await run([proposal, { status: 'matched', interval: start }]);
    assert.equal(accepted.single.timestamp, 105.3);
    assert.equal(accepted.verified.timestamp, 105.3);
    assert.equal(accepted.calls, 2);
    const rejected = await run([proposal, { status: 'insufficient_evidence', interval: null }]);
    assert.equal(rejected.verified, null);
    assert.equal(rejected.single.timestamp, 105.3);
    const outside = await run([proposal, { status: 'matched', interval: { startCue: 'C5', evidence: ['C5'] } }]);
    assert.equal(outside.verified, null, 'Reject a verifier citation outside the supplied context');
    const ambiguous = await run([{ status: 'ambiguous', candidates: [start] }, { status: 'ambiguous', interval: null }]);
    assert.equal(ambiguous.single, null);
    assert.equal(ambiguous.verified, null);
    const negative = await run([{ status: 'no_match', candidates: [] }]);
    assert.equal(negative.calls, 1);
    assert.equal(negative.verified, null);
    console.log('PASS: exact cue IDs, evidence preceding seek, bounded context, local membership and abstention.');
})().catch(error => { console.error(error); process.exitCode = 1; });
