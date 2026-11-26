# Navigator tool reliability playbook

## Principles applied

- **Choose workflows before autonomous loops.** Explicit episode coordinates and clearly parsed scene requests bypass unnecessary planning. Native tool calling remains the default; an endpoint-specific JSON protocol handles Iceman's malformed native calls and DeepSeek's stalled/unavailable native tool streams without changing the selected model.
- **Make tools distinguishable.** Navigation opens details; playback starts media. Narrow available tools only for clear task families, preserving compound requests. Metadata questions must attempt a details lookup, rather than answer solely from memory.
- **Treat schemas as syntax checks, not proof.** All structured answers are locally validated. Episode citations select server-issued passage IDs; the server reconstructs exact quotes. The episode assessor still determines semantic support, so a valid ID alone does not establish truth.
- **Ground event identity.** Search the full subtitle timeline in one semantic pass. Require a matched result with a valid original start cue and nearby supporting cues. Instruct the model to distinguish the actual event from narration, rehearsal, and archival appearances. Valid citations are not independent ground truth; abstain on ambiguous or unsupported events.
- **Bound recovery.** Structured generation permits one recovery/fallback within its original deadline. Never retry authentication failures, arbitrary request errors, or user cancellation. Native SDK transport retries are separately capped. Scene matching does not repeat semantic selection or verification after a schema-valid result.
- **Do not replay side effects.** Prepared browser actions stop the tool loop. The browser's acknowledgement, not model prose, determines completion. Invalid JSON tool arguments are rejected before dispatch. Cancellation propagates to tools and model calls.
- **Measure correctness and latency together.** Require expected canonical identities, action types, evidence lookup and scene windows. Report failures, not only successful runtimes. Keep source-route harness results separate from authenticated HTTP/browser playback.

## Primary resources researched with Ketch

- [Anthropic: Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents): realistic evaluations, clear tool responsibilities, meaningful context, and token-efficient outputs.
- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents): simpler composable workflows before unnecessary agent complexity.
- [OpenAI: Function calling](https://platform.openai.com/docs/guides/function-calling): explicit tool definitions, constrained argument schemas, and application-side execution.
- [DeepSeek: Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/): `reasoning_effort: low` still enables thinking; `none` disables it. OpenCode DeepSeek structured extraction uses `none` to avoid exhausting short interactive generation budgets on hidden reasoning. Native streaming tool calls retain `low`: the gateway's tool stream stalled with `none` in live tests, so these paths are configured separately.
- [AI SDK: Generating structured data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data): structured generation and validation boundaries. Ketch returned incomplete content for this page in the current research pass; installed SDK types and real-SDK tests verify integration details.

## Reproducible checks

```sh
node scripts/test-navigator-structured-output.cjs
node scripts/test-navigator-text-tools.cjs
node scripts/test-navigator.cjs
node scripts/test-episode-discovery.cjs
node scripts/test-navigator-request-timing.cjs
npx tsc --noEmit --incremental false
```

Opt-in calls use real provider and public metadata services, with stubbed app authentication; they can incur API charges. They do not execute browser actions:

```sh
node scripts/test-navigator-tasks-live.cjs --list
node scripts/test-navigator-tasks-live.cjs --live --model MODEL --case people
node scripts/test-navigator-episode-live.cjs --live --model MODEL --prompt 'play that one episode in nathan for you where he goes on jimmy kimmel, and skip to the scene where he goes on'
```

Small repeated samples cannot establish reliability across every task. Preserve strict failures and expand held-out coverage rather than weakening assertions until runs pass.

## Observed validation — November 4, 2026

- The 40-call matrix passed 39 cases: all 30 general tasks, with one DeepSeek scene-intent failure among ten scene runs. Later DeepSeek reruns exposed reasoning-budget exhaustion and native streaming failures; these were not counted as passes.
- After separating structured generation from unreliable native tool streams, DeepSeek passed all six general tasks through the validated JSON tool adapter and three consecutive full scene workflows with thinking disabled (12.5–14.7 seconds).
- The other four models each passed a final scene recheck: Luna 16.3s, Haiku 18.6s, Iceman 53.5s, GLM 11.6s. All selected the actual main-narrative appearance at approximately 17:36–17:39, not the opening recap.
- These are successive diagnostic/recheck batches, not a claim that a single final 40-call batch passed unchanged. General tasks cover title navigation, title playback, explicit episode playback, episode identification, theme changes, and director metadata lookup.
- `npm run test:navigator`, `npm run test:security`, TypeScript, and targeted helper/tool lint pass. Running-server checks covered the login page and anonymous authorization boundaries only. Authenticated browser playback remains untested.
