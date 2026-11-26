// Experimental scene selection only. Not imported by the application.
const { createHash } = require('node:crypto');
const { load } = require('./test-support/react-hooks.cjs');
const { sceneCueId: cueId, normalizeSceneMoment: normalizeInterval, validSceneInterval: validInterval,
    projectSceneMoment: project, chronologicalTranscript, sceneMatchPrompt, sceneMatchSchema,
    sceneMomentSchema, sceneMatchingRules: rules, matchedSceneMoment } = load('lib/navigator-scene-matcher.ts');

function candidateWindows(cues, intervals, padding = 18) {
    const ranges = intervals.map(interval => [cues[interval.first - 1].timestamp - padding,
        (cues[interval.end - 1].endTimestamp ?? cues[interval.end - 1].timestamp) + padding]);
    return chronologicalTranscript(cues, cue => ranges.some(([start, end]) => cue.timestamp >= start && cue.timestamp <= end));
}

async function experimentalMatcher({ cues, context, z, generate, model, effort = 'medium', verificationEffort = effort }) {
    const statuses = sceneMatchSchema.shape.status;
    const interval = sceneMomentSchema;
    const usage = [];
    const generateMatch = async (task, schema, prompt, reasoningEffort = effort) => {
        const start = Date.now();
        const response = await generate({ task, schema, prompt, model,
            providerOptions: { openai: { reasoningEffort } },
            timeout: { totalMs: 30_000 }, maxRetries: 0, maxOutputTokens: 2400 });
        usage.push({ task, ms: Date.now() - start, inputTokens: response.totalUsage.inputTokens,
            outputTokens: response.totalUsage.outputTokens, reasoningTokens: response.totalUsage.outputTokenDetails?.reasoningTokens,
            cachedInputTokens: response.totalUsage.inputTokenDetails?.cacheReadTokens });
        return response.output;
    };
    const proposal = await generateMatch('experimental-proposal', sceneMatchSchema, sceneMatchPrompt(cues, context));
    const proposalMs = usage[0].ms;
    const normalized = proposal.candidates.map(normalizeInterval);
    const candidates = normalized.filter(value => validInterval(cues, value));
    const single = matchedSceneMoment(cues, proposal);
    if (!candidates.length || ['no_match', 'insufficient_evidence'].includes(proposal.status)) {
        return { proposalStatus: proposal.status, single, verified: null, proposalMs, usage,
            proposals: proposal.candidates };
    }
    let verified;
    try {
        verified = await generateMatch('experimental-focused-verification', z.object({
        status: statuses, interval: interval.nullable(),
    }), `${context}\n\n${rules}
The full transcript was searched for plausible occurrences. Compare these proposals against the original cues below. Do not assume they are correct or that the first is best.
Proposals: ${JSON.stringify(candidates.map(value => ({ startCue: cueId(value.start - 1), endCue: cueId(value.end - 1),
        evidence: value.evidence.map(id => cueId(id - 1)) })))}
Original cues around all proposals (omitted gaps remain gaps):
${candidateWindows(cues, candidates)}
Accept only a start cue from one of the proposed occurrences with nearby evidence from that occurrence's supplied context. Supporting context may precede the actual seek cue. Otherwise abstain. Identify precisely where the event starts; do not jump forward past an earlier cue that establishes the same event, or back to a merely related discussion.`, verificationEffort);
    } catch (error) {
        return { proposalStatus: proposal.status, single, verified: null, proposalMs, usage,
            proposals: proposal.candidates, verificationError: error.name };
    }
    const refined = normalizeInterval(verified.interval);
    // No redundant candidate-number field. Resolve membership from original
    // cue IDs and require the complete refined evidence span to fit one window.
    const accepted = verified.status === 'matched' && validInterval(cues, refined)
        && candidates.some(value => refined.start >= value.first && refined.start <= value.end
            && cues[refined.first - 1].timestamp >= cues[value.first - 1].timestamp - 18
            && cues[refined.end - 1].timestamp <= (cues[value.end - 1].endTimestamp ?? cues[value.end - 1].timestamp) + 18)
        ? project(cues, refined) : null;
    return { proposalStatus: proposal.status, verificationStatus: verified.status, single, verified: accepted, proposalMs, usage,
        proposals: proposal.candidates, verification: verified };
}

function fingerprint(cues) {
    return createHash('sha256').update(JSON.stringify(cues)).digest('hex');
}

module.exports = { validInterval, candidateWindows, project, normalizeInterval, chronologicalTranscript, experimentalMatcher, fingerprint };
