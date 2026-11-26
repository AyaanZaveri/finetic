# Navigator subtitle matching playbook

Date: 2026-11-26. The evaluation below preceded the approved production
switch to the one-pass cue matcher.

## Objective

Locate the beginning of the intended scene quickly, using the correct
video release and real timestamp evidence. Prefer a supported approximate
scene start over a fabricated exact frame. If a description cannot be
resolved from dialogue, report that limitation. Do not confuse successful
episode identification with a successful seek.

## Current production pipeline

The episode and release discovery paths remain unchanged. The matcher
now retains each original cue ID and uses `sceneMatchPrompt`,
`sceneMatchSchema` and `matchedSceneMoment` from
`lib/navigator-scene-matcher.ts`. It makes one semantic selection with
the user-selected model. Nearby supporting cues can precede the seek
cue. Invalid IDs, missing evidence, distant evidence, ambiguous
results and unsupported scenes do not prepare playback. Structured
output recovery remains bounded; there is no semantic correction or
verification loop. The returned time is the original cue time, with
the existing snapshot delay applied when appropriate.

The experimental replay script uses the same production schema,
prompt and validation functions. Its optional focused verifier
remains a research-only path. The `baseline` label in new replay
reports now refers to the current production matcher; historical
reports retain the former grouped implementation's measurements.

### Live integration check after the switch

The actual chat route, with GPT-6 Luna and live discovery, prepared
subtitle-backed actions for Brooklyn Nine-Nine, The Office, Better
Call Saul and Severance in one selection pass. Kimmel and the lawyer
case initially abstained, then both produced a prepared action on a
follow-up run. Kimmel selected the introduction at 1062.261s. The
lawyer selected later dialogue at 275.342s; that is not a pass under
the narrower return-exchange criterion. Community remained unresolved.
The impossible scene was rejected at episode resolution. These results
show that the architecture benchmark does not guarantee end-to-end
accuracy with variable retrieved context. No video was played.

## Previous pipeline (comparison baseline)

1. The outer agent chooses `skipToSubtitleContent`.
2. The tool resolves the title and, if necessary, the episode using catalog
   and web evidence.
3. It loads a matching subtitle track and parses its cue intervals.
   It prefers English SDH and reuses a matching active-player snapshot.
4. `sceneSubtitleCandidates` merges consecutive cues into up to 420
   passages. Each passage gets the timestamp of its first cue.
5. A structured model request selects one passage index and a confidence
   label.
6. A second request reads the entire prompt again and selects a passage
   independently. Its answer replaces the original. If it abstains,
   the tool can run one correction and another full verification.
7. The tool returns a prepared playback or seek action. The player applies
   the position, which still depends on release alignment.

Relevant code:

- `app/tools/subtitles.ts`: track discovery, loading, prompt, selection,
  verification and action preparation.
- `lib/navigator-subtitles.ts`: passage grouping and index validation.
- `lib/media/subtitle-content.ts`: SRT/WebVTT parsing.
- `lib/media/subtitle-episode-identity.ts`: episode title matching.
- `lib/media/subtitle-preference.ts`: language, SDH and forced-track ranking.
- `lib/media/subtitle-snapshot.ts`: exact playback identity and delay.
- `lib/navigator-model-settings.ts`: reasoning settings.

## Findings from previous experiments

- Full chronological coverage improved recall relative to sparse keyword
  samples. The November 16 shortlist experiment did not establish better
  latency or reliable recap rejection on DeepSeek Flash. Do not restore
  it unchanged.
- The current grouping loses exact cue boundaries and marks an entire
  passage italic if any cue is italic. This can mix narration and action.
  One long merged group can also be truncated at 1200 characters.
- The verifier is actually a second full selection. It never sees the
  first selected passage and need not agree with it. The correction
  prompt subsequently calls that result a rejection of the first passage.
  This is not a faithful description of what the model checked.
- A high-confidence index is valid syntax, not semantic proof. In the
  previous frozen lawyer test, six identical calls selected five distinct
  positions between 257s and 282s.
- The lawyer scene shows that nearby dialogue can identify a continuous
  physical interaction even if the actual motion is not captioned. The
  target is the exchange over returning the signed paper, not every line
  about signatures or lawyers.
- Community's pizza scene needs visual grounding or a sufficiently
  distinctive action caption/utterance. A caption for an earlier breaking
  glass or gunshot is not automatically the requested return with pizza.
- GPT-6 Luna defaults to medium reasoning on Responses. The current
  Navigator matcher does not override this model's setting.

## Controlled variables

| Layer | Variables to test and log |
| --- | --- |
| Intent | Original words, normalized scene clue, prior conversation, current playback, start of scene versus exact quote, requested occurrence |
| Entity and episode | Canonical ID, season/episode restrictions, verified source quotes, recap versus original, alternate occurrences and ambiguous titles |
| Track identity | Provider, source/release ID, episode title, language, SDH versus ordinary captions, forced flag, filename, video size, track duration, completeness, release offsets and playback delay |
| Parsing | SRT/VTT, Unicode, formatting, speaker markers, cue start/end, ordering, overlap, duplicate cues, music versus action markers, missing/malformed entries |
| Candidate representation | Original cue IDs, non-overlapping versus overlapping windows, length in seconds/words/cues, stride, maximum chars, gap boundaries, scene breaks, per-cue narration and action labels |
| Retrieval | Full timeline, lexical/BM25, embeddings, hybrid fusion, source-quote anchors, semantic shortlist, top-K, candidate diversity, neighboring context, fallback recall |
| Prompt | Length, order of query and transcript, stable prefix, examples, untrusted-data boundaries, explicit distinction between event and setup/recap, visual versus dialogue evidence, output fields |
| Selection | Model and exact version, transport, effort, temperature/top-p only when supported, structured schema, tokens, timeouts, cache status, service tier |
| Verification | Always versus conditional, independent global comparison versus local candidate verification, explicit evidence IDs, confidence calibration, candidate agreement, alternative occurrence search, maximum retries |
| Timing | First relevant cue versus passage start, interval boundaries, optional pre-roll, measured release mismatch, playback offset/drift and actual seek acknowledgement |
| Performance | Model latency, web retrieval, subtitle discovery/download, prompt assembly, input/cache/output/reasoning tokens, retries, p50/p95, rate limit, cancellation and concurrent request load |

Do not change all variables together. Fix the media release, cue data,
request context and expected outcome before comparing one model setting.
Use the selected provider's supported parameters instead of applying
temperature, seeds or reasoning settings universally. Preserve the
user-selected model unless an explicit experiment chooses another.

## Recommended implementation order

### 1. Keep stable cue identities and locate intervals

Use original cue IDs and precise start/end times. Candidate windows must
refer back to these cues without changing their timestamps or flattening
individual speech/action markers. Test overlapping chronological windows
of roughly 15–30 seconds with 5–10 seconds of overlap. These are initial
test values, not established optimal parameters.

Select a continuous matching interaction first; choose its start cue
within that interaction second. A quoted line can have a narrower target.
Return supporting cue IDs separately from the start cue. The app verifies
IDs, order, range and membership; the model never invents seconds.

### 2. Make verification actually verify

Test a compact selection schema that distinguishes `matched`,
`ambiguous`, `no_match` and `insufficient_evidence`, and supplies a small
number of candidate intervals plus supporting cue IDs. The model can
classify original event, setup, replay and unclear as needed, rather than
force a selection.

For an uncertain choice or repeated occurrence, compare the proposed
intervals with their surrounding original cues. An explicit rejection
must name which interval failed and why. A global comparison remains
available when another occurrence may be better. Do not replace full
coverage with a narrow keyword filter or skip verification solely on
self-reported confidence.

Avoid running three or four near-identical full-transcript prompts.
Compare the current method with a proposal plus focused check and
with a single structured selection that includes evidence. Require
non-inferior false-positive behavior before making a faster path default.

### 3. Tune reasoning effort and prompt length

Try none, low and medium on fixed inputs. Lower effort can improve speed
but may produce overconfident near-misses. Try a concise evidence-first
instruction instead of the current lengthy overlapping guidance.
Keep the distinctions between dialogue, action, setup and recap.

Use a bounded output schema and deadlines. `maxOutputTokens` includes
reasoning on relevant models: a very small cap can eliminate the final
answer. Record cached tokens and actual reasoning tokens, since a
configured reasoning effort is not a guarantee of a particular budget.
Do not add paid fast processing or high reasoning by default.

### 4. Add source-anchored retrieval only when it helps

The show and episode lookup has already collected relevant web passages.
If they contain quoted dialogue, use that dialogue as an additional
retrieval query alongside the original request. A semantically matched
window or exact quote is a lead; the original subtitle timeline and the
model establish the matching moment.

Benchmark BM25, semantic embeddings and hybrid top-K against full-context
matching, including cases where the scene uses none of the user's words.
Evaluate retrieval recall before evaluating the downstream model.
An in-memory index over a single episode is enough to test this hypothesis;
do not add a database or precompute embeddings for the entire catalog
without evidence of a benefit. Full-context fallback remains necessary
for low-recall queries.

### 5. Handle evidence availability and release alignment separately

Test alternative subtitle tracks when the initial track lacks relevant
action captions or has missing/incorrect content. The current loader
retries failed downloads but does not automatically switch tracks after
semantic abstention. Compare a bounded alternative-track retry with a
model retry. A different cut may have different timestamps; do not
blindly transfer the time.

Use the exact player snapshot when available, including applied
subtitle delay. For unopened videos, label an external subtitle time
as approximate until the chosen stream/release is known.

For purely visual scenes, subtitle matching cannot guarantee the exact
event. A separate future experiment could use a few frames from the
user's authorized media around plausible intervals, with a vision model,
or a verified time-aligned scene description. Avoid decoding a whole
episode or adding a video ingestion pipeline by default. No frame
analysis or playback testing was performed in this investigation.

## Fixed-input reasoning experiment

The test script captures the first selection prompt and replays it
without retrieval, agent routing or full-scene verification. Two
iterations at each effort were run with GPT-6 Luna on each of four
captured prompts. These are initial suggestions, not completed seeks.

| Case | None | Low | Medium |
| --- | --- | --- | --- |
| Jimmy Kimmel | 2/2 correct introductions, 1.05–1.36s | 2/2, 2.67–2.88s | 2/2, 1.47–1.64s |
| Signed paper | 1/2 return exchange, 0.81–1.15s | 1/2 return exchange, 1.20–1.60s | 2/2 return exchange, 5.16–6.80s |
| Community pizza | 2/2 high-confidence glass/gunshot captions, 0.87–1.01s | Low confidence or none, 2.96–3.61s | One high and one low on nearby yelling, 3.20–4.15s |
| Impossible Interstellar scene | 2/2 abstentions, 0.88–1.27s | 2/2, 1.11–1.17s | 2/2, 1.20–1.33s |

The Community candidates are not confirmed scene locations and cannot
count as passes. The two medium lawyer selections found the signing
return exchange at 257s, whereas one none and one low output selected
surrounding signing discussion. In addition, medium reasoning is not
sufficient to fix the existing full selection/verification chain:
the original lawyer request abstained after 39.61s of scene analysis.

This small experiment supports a faster proposal for simple dialogue
requests but not a global switch to no reasoning. Cache hits and
provider latency varied. We need controlled full-pipeline tests of
the new verification shape and held-out scenes before shipping.

```sh
node scripts/test-navigator-episode-live.cjs --live \
  --provider openai --model gpt-6-luna --timings --report-only \
  --matcher-repeats 2 --matcher-efforts none,low,medium \
  --prompt 'go to the scene in nathan for you where he takes the signed paper from the lawyer'
```

Use `OPENAI_API_KEY` from the process environment. Captured prompts
remain in memory; output contains a fingerprint and short supporting
lines, not full transcripts.

## Live architecture comparison

Four experimental revisions were evaluated against actual production
matching. Each round used eight scene requests and three alternating
pairs per request. The episode ID was known in advance. Both matchers
used the same parsed subtitle release, frozen in a player-snapshot
fixture for all six runs per case. No media was played. This isolates
the matcher from title lookup, subtitle download and the outer agent.
Different rounds could load different releases, so comparisons across
rounds are not fixed-input comparisons.

The new matcher sends the complete transcript with original cue IDs
and returns a start cue plus nearby supporting cues. The application
derives the evidence interval. It can then compare up to three proposed
occurrences using only their original cues and surrounding context.
Times always come from the original cue data.

The first revision used numeric IDs alongside seconds. Luna repeatedly
returned seconds in the start/end ID fields, so valid evidence was
discarded. The second revision used `C`-prefixed IDs, separated timeline
headers and distinct start/end fields. The third removed the model's
end field, which caused unnecessary rejection when an otherwise
correct scene exceeded the arbitrary interval limit. It still rejected
valid supporting context preceding the seek cue. The fourth revision
allows nearby earlier evidence and derives the verifier's candidate
membership from the cited IDs rather than requiring a redundant
candidate number. The final revision used medium reasoning for
proposal selection and low reasoning for focused verification.

The production matcher uses its existing Luna default (medium). The
one-pass proposal and its focused verification share the same model
output, so they are paired, not independent trials. All results below
are from the fourth round.

| Metric | Production | One pass | Focused verification |
| --- | ---: | ---: | ---: |
| Existing subtitle-evidence criteria | 19/21 | 21/21 | 21/21 |
| With narrower lawyer start criterion | 19/21 | 20/21 | 19/21 |
| Median matcher latency, all 24 trials | 4.65s | 3.02s | 4.58s |
| p95 matcher latency (nearest rank) | 14.56s | 11.99s | 11.99s |
| Median matcher input tokens | 15,037 | 8,384 | 9,166 |
| Mean model calls | 1.67 | 1.00 | 1.75 |
| Community seeks (unverified) | 0/3 | 0/3 | 0/3 |

There were no provider errors in the fourth round. Community visual
grounding is unscored, not a successful abstention. The impossible
negative was correctly rejected by all three paths. The start-time
windows and dialogue checks come from the existing evaluation suite,
not frame-level annotations.

The broad signed-paper criterion accepts dialogue about putting the
paper in a pocket, even after the initial return exchange. A narrower
250–265s subtitle-context check distinguishes that earlier exchange
from later discussion. Production passed it once, the one-pass matcher
twice, and focused verification once. In two trials the verifier
selected the later pocket dialogue at 278.512s. This demonstrates why
an aggregate broad-scene score can hide a seek-precision regression.
The exact physical action still needs visual review.

All five other positive cases passed every final-round trial. The cue
representation also identified the exact “She's alive!” subtitle
instead of the earlier grouped passage. This is better cue precision,
not verified video-frame precision.

The one-pass path was 35% faster at the median and used 44% fewer median
input tokens than production. Focused verification reduced median
input tokens by 39% but did not materially improve median latency.
Provider variability, prompt cache hits and concurrent case execution
affect these estimates. The revised matcher was tuned on these same
cases. Earlier revisions sometimes proposed unsupported Community
timestamps, which the focused verifier rejected. Do not infer
generalization, calibrated confidence or a reliable universal
one-pass policy from this small suite.

The comparison harness and optional focused verifier remain experimental.
The one-pass schema, prompt and validation now live in the production
`lib/navigator-scene-matcher.ts` module:

- `scripts/navigator-matcher-experiment.cjs`: cue-based proposal and
  focused verification.
- `scripts/test-navigator-matcher-experiment.cjs`: deterministic
  validation and abstention checks.
- `scripts/test-navigator-episode-live.cjs`: actual production baseline
  and experimental matcher using a shared frozen subtitle snapshot.

Reproduce a round with a configured OpenAI key:

```sh
for case in lawyer community kimmel b99 office saul severance negative; do
  node scripts/test-navigator-episode-live.cjs --live \
    --provider openai --model gpt-6-luna --timings \
    --matcher-architecture-case "$case" \
    --architecture-repeats 3 --architecture-verifier-effort low
done
node scripts/test-navigator-matcher-experiment.cjs
```

Use `--architecture-verifier-effort medium` to compare verification
effort, `--architecture-effort` to vary proposal reasoning, and
`--architecture-variants interval` for experimental-only diagnostics.
The JSONL report includes track identity, cue fingerprint, per-stage
usage, latency, candidate IDs, accepted evidence and provisional score.
Full subtitle files and credentials are not written to disk.

The user approved the one-pass implementation after this comparison.
Freeze a held-out suite with independently adjudicated starts and
ambiguous or repeated occurrences to measure generalization and
determine whether more verification is useful on specific cases.

## Evaluation gate

Build a frozen, versioned corpus with independently reviewed scene
intervals for actual subtitle releases. Separate tuning and held-out
examples. Start with 30–50 cases: exact quotes, approximate quotes,
abstract dialogue, indirect visuals, SDH actions, recaps, repeated
events, ambiguous episodes, multilingual/misspelled clues, absent
scenes and malformed/wrong-release tracks. Include real negative
examples, not only easy impossible cartoon crossovers.

Measure:

- Episode and track identity accuracy.
- Retrieval recall at K, independently of final selection.
- Correct occurrence and interval overlap (IoU), absolute start-time
  error, and supported start within a declared tolerance.
- Precision among accepted seeks, coverage, false-positive and false
  abstention rates. Confidence must be calibrated against those labels.
- Median and p95 matching/end-to-end time and total model calls/tokens.
- Repeated-run reliability (all trials correct), not best-of-N selected
  after the fact.

Run initially three to five paired repeats per case with the same
inputs and alternating variant order. Use deterministic checks when
ground truth is known and human review for visually dependent or
ambiguous results. Do not treat a provider failure as a successful
abstention. For an established contender, expand to a larger held-out
suite and retain prior regression cases. Keep the outer agent engine
constant during matcher experiments, then rerun the end-to-end suite.

## References and playbooks

- [OpenAI: GPT-6 Luna](https://platform.openai.com/docs/models/gpt-6-luna):
  supported reasoning levels and the medium default.
- [OpenAI: Latency optimization](https://platform.openai.com/docs/guides/latency-optimization):
  measure p50/p95, reduce output and input tokens, fewer calls,
  parallelize independent work.
- [OpenAI: Prompt caching](https://platform.openai.com/docs/guides/prompt-caching):
  exact-prefix reuse and cached token measurement.
- [OpenAI: Structured outputs](https://platform.openai.com/docs/guides/structured-outputs):
  schema guarantees do not eliminate application validation.
- [OpenAI: Evaluation best practices](https://platform.openai.com/docs/guides/evaluation-best-practices):
  scoped evals, representative cases and human calibration.
- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):
  simplest useful workflow, then add complexity based on results.
- [Anthropic: Contextual retrieval](https://www.anthropic.com/news/contextual-retrieval):
  combine lexical and semantic retrieval and preserve context.
- [Anthropic: Demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):
  repeated trials, traces, outcomes and graders.
- [Lost in the Middle](https://arxiv.org/abs/2307.03172):
  evidence position can affect long-context retrieval accuracy.
- [TVR: Video-Subtitle Moment Retrieval](https://arxiv.org/abs/2001.09099):
  temporal windows and separate visual/subtitle/mixed query classes.
- [QVHighlights](https://arxiv.org/abs/2107.09609):
  query-specific temporal annotations and moment relevance.

The external retrieval papers motivate experiments; their reported
results are not measured accuracy or latency improvements for Navigator.
