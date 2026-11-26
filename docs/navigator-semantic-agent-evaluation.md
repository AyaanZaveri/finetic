# Navigator semantic agent experiment

Date: 2026-11-26. This is an isolated evaluation, not a production change.

## Finding

Ask Navigator already lets the model select tools through the AI SDK loop in
`app/api/chat/route.ts`. The earlier regex-based scene planner still exists in
`app/tools/scene-workflow.ts` and `lib/navigator-scene-intent.ts`, but the route
does not invoke it. Removing those files alone would not fix the reported
failure.

The exact request was:

> go to the whos on first scene in nathan fielders new movie

The intended movie is *You Can See Everything* (2026), TMDB 1765072,
IMDb tt45368240. [Vulture](https://www.vulture.com/article/you-can-see-everythings-whos-on-first-scene-nathan-for-you.html)
and the [Los Angeles Times](https://www.latimes.com/entertainment-arts/movies/story/2026-10-16/you-can-see-everything-nathan-fielder-elizabeth-holmes-lance-oppenheim-documentary-10-biggest-revelations)
independently describe Nathan Fielder showing Elizabeth Holmes the comedy
routine. Live TMDB credits include the correct film in both acting and
directing results.

The current prompt sometimes chose `The Rehearsal` after successfully
retrieving Fielder's movie credits. The failure therefore occurs before
subtitle matching of the intended film. The model must distinguish the
creator, the referenced work, the requested work, and the desired action.

## Prompt experiment

Use the current tools and the same Gemini 3.1 Flash-Lite model for both
conditions. The alternative prompt is
`scripts/fixtures/navigator-semantic-prompt.txt`.

| Request | Current prompt | Evidence-first prompt |
| --- | --- | --- |
| Exact reported scene | Pass, 18.77s; then wrong title, 24.96s | Pass, 7.75s and 45.42s |
| New documentary by the creator of The Rehearsal, Elizabeth comedy routine | Wrong title, 9.08s | Pass, 33.13s |
| Literal film title and scene | Provider rate limit, 6.87s | Pass, 24.53s |
| Who directed the film? | Pass, 14.82s | Correct answer, 3.18s, but only search snippets |

All successful scene requests prepared one action for IMDb tt45368240 with
subtitle evidence between 47:26 and 47:38. The actual line includes the
question about Abbott and Costello and the name of the routine. Subtitle
release offsets vary. These timestamps are evidence-backed selections, not
verification of frame-perfect playback.

An intermediate, shorter prompt without the explicit evidence-first
instruction succeeded on the exact request (22.37s) and directors
(3.98s, metadata-backed), but failed on the indirect paraphrase (49.09s).
The literal-title trial was rate limited. Prompt length alone is not the
solution. The final alternative also produced one correct fact without the
required evidence, so it is not ready to replace the production prompt.

The successful scene matches consumed approximately 71,000 input tokens over
the two subtitle analysis passes, including cache reads. This is separate
from the outer agent's routing token usage. The matching pass accounts for
3.20s to 27.69s of the final prompt trials.

## libfx experiment

Tested `libfx@0.0.18` using its native macOS engine, separate from the project's
dependencies. The comparison adapts the existing Zod schemas into libfx
tools, validates every call with the original schema, and uses Navigator's
existing tool implementations, model-output projection and action reservation.
The subtitle analysis still uses the AI SDK with the selected model. The
host cancels the engine after a terminal action result so it cannot prepare
another action. No persistent libfx sessions were created.

With Groq `openai/gpt-oss-120b` and the same evidence-first prompt:

| Request | AI SDK | libfx |
| --- | --- | --- |
| Exact reported scene | Correct title, matcher failed (49.89s) | Correct title, matcher failed (16.90s) |
| Who directed the film? | Incomplete, no answer (89.37s) | Metadata retrieved, no answer before deadline (120.08s) |
| Play Interstellar (2014) | Incomplete, no prepared action (61.24s) | Correct prepared action (34.41s) |

Gemini through libfx's OpenAI-compatible transport failed with `InvalidChunk`
on three trials before any tools executed. The direct Gemini SDK transport
worked. This is a compatibility observation for the tested endpoint, not a
conclusion about all libfx providers.

An attempt to use the configured OpenCode Go key returned an active
subscription required error. It did not test model behavior.

These are small, non-deterministic live trials, with variable provider delays.
They do not establish a statistically reliable speed or accuracy advantage
for either engine. The test exercised real models, TMDB, web search, and
subtitle retrieval with isolated app authentication. No browser actions,
playback, application builds, or settings changes were performed.

## GPT-6 Luna follow-up

The official OpenAI API confirmed access to `gpt-6-luna`. With the normal
Responses-based AI SDK route, the original prompt succeeded on the exact
scene (15.99s), playback (2.86s) and director lookup (3.06s), but chose
The Rehearsal for the indirect documentary paraphrase (24.24s).
The evidence-first prompt succeeded on both scene variants (13.85s and
16.01s), playback (1.94s) and director lookup (5.91s). The latter fetched an
A24 source but rendered an internal citation marker instead of a link.

The first libfx attempts failed before executing tools because OpenAI
does not accept function tools with reasoning enabled on Chat Completions
for this model. The supported configuration is `reasoning_effort: none`.
The matched comparison below uses that setting and the Chat Completions
endpoint for both outer engines, the same evidence-first prompt and tools,
and the existing Responses-based scene analysis for both.

| Request | AI SDK | libfx |
| --- | --- | --- |
| Exact reported scene | Pass, 9.86s | Pass, 10.72s |
| Indirect documentary paraphrase | Pass, 8.35s | Pass, 11.11s |
| Play Interstellar | Pass, 1.60s | Pass, 1.72s |
| Who directed the film? | Pass, 3.73s | Pass, 3.88s |
| Nathan for You Jimmy Kimmel episode | Correct target, 23.49s | Correct target, 5.97s |
| Play Severance S2E3 | Pass, 2.10s | Pass, 2.21s |
| Open Dune (ambiguous) | Wrong behavior, 1.19s | Wrong behavior, 1.11s |
| Impossible SpongeBob/Batman scene in Interstellar | Correct abstention, 4.33s | Correct abstention, 2.48s |

Both engines reached the correct user-visible outcome in seven of eight
trials. The episode result has an important evidence caveat: the AI SDK
first attempted a nonexistent catalog ID before recovering and returning
fetched evidence. Libfx found the correct episode via web snippets and
exact-title catalog lookup, but did not fetch episode-specific proof. Both
fall short of the full episode verification policy. Both also opened the
2021 Dune rather than asking which film.

Median end-to-end latency for the eight trials was 4.03s for the AI SDK
and 3.18s for libfx, including the incorrect ambiguity result. The larger
libfx improvement is the remembered episode lookup, where the work
performed was not equivalent. The two scene tests were slightly faster
with the AI SDK; the subtitle matcher accounts for much of their runtime.
This small sample does not establish a general performance advantage.

To repeat, use the official API key in the process environment, add
`--provider openai --model gpt-6-luna --openai-chat-none` and select the same
prompt for both engines. Add `--fx-module` only for the libfx run. The
`--openai-chat-none` option changes only the test's outer agent transport
and reasoning setting, not the application or its subtitle analysis.

### Follow-up: Jimmy Kimmel scene

Exact request: `go to the scene in nathan for you where he goes on jimmy kimmel`.

The first four trials failed after episode discovery. The progress trace
showed the correct canonical episode but a subtitle file named `403 HI.srt`.
The isolated source-route harness did not supply Node's `Buffer` global,
which caused the metadata cache to fail to return the episode title. This
prevented the existing title-based subtitle release selection. Adding
`Buffer` to the harness corrected the test environment without changing
production code.

| GPT-6 Luna configuration | Result | Time |
| --- | --- | --- |
| Current AI SDK route and prompt | Pass | 19.04s |
| AI SDK Responses, evidence-first prompt | Pass | 15.62s |
| AI SDK Chat Completions, evidence-first, reasoning none | Pass | 16.82s |
| libfx Chat Completions, evidence-first, reasoning none | Pass | 9.53s |

All four corrected trials selected one `skipToSubtitleContent` call,
verified The Anecdote (canonical S4E4, IMDb `tt2297757:4:4`), selected
the title-matched 549-line OpenSubtitles release and prepared a seek at
1062.261 seconds (17:42.261). The selected dialogue was
`Please welcome Nathan Fielder! (CHEERS AND APPLAUSE)`.
The matching release is labeled S04E05 because subtitle numbering differs.
Most of the timing difference between the matched SDK and libfx trials
occurred inside the same episode discovery tool (12.32s versus 4.99s),
not in the outer loop. Neither trial actually played the video.

## TinyFish retrieval improvement

The current REST endpoints already match the latest
[TinySearch reference](https://docs.tinyfish.ai/tinysearch/reference) and
[TinyFetch reference](https://docs.tinyfish.ai/tinyfetch/reference).
Navigator does not depend on the TinyFish SDK, so there is no SDK package
to upgrade. Keep direct authenticated HTTP requests, the documented
`purpose` parameter, Markdown extraction, and server caching defaults.
Accept nullable response fields without treating missing text as evidence.

The Fetch API returns a batch only after all URLs finish. Live independent
reads of the four Jimmy Kimmel sources showed all three useful articles
returning in 457–697ms while the YouTube result took 7.02s and timed out.
Reducing the per-URL timeout to 3.5s caused one probe to lose all four
results, so do not use an aggressive universal deadline.

Automatic episode research now fetches up to four individual sources
concurrently. It starts verifying after two readable pages arrive, while
remaining pages continue loading. If the model cannot verify a unique
episode, it consumes the remaining evidence, then uses the existing
search refinement if necessary. If verification succeeds, it cancels
outstanding reads. This does not claim an exhaustive search of every
possible source. Explicit search and selected-source fetch retain their
existing contracts. No account-gated Highlights or TinyAnswer dependency
was added.

Three paired live requests with GPT-6 Luna, the unchanged production
system prompt and the existing AI SDK Responses route:

| Trial | Before total | After total | Before title/episode | After title/episode |
| --- | ---: | ---: | ---: | ---: |
| 1 | 10.64s | 11.07s | 4.68s | 4.69s |
| 2 | 28.41s | 10.92s | 22.79s | 3.96s |
| 3 | 11.60s | 8.34s | 6.60s | 2.98s |

All six prepared The Anecdote at 17:42.261. The median title/episode
resolution time dropped from 6.60s to 3.96s (40%); median total time
dropped from 11.60s to 10.92s. This is a small sample with variable
network/provider latency, not a guarantee of a fixed improvement.

Additional live checks correctly identified You Can See Everything and
prepared its requested scene, and rejected a nonexistent SpongeBob/Batman
scene in Nathan for You. The signed-paper lawyer query verified the correct
Dumb Starbucks episode and subtitle release but did not produce a confident
scene match (43.86s); this remains a scene-analysis failure.
Deterministic checks cover early completion, cancellation of outstanding
reads, waiting for later evidence when needed, and nullable partial results.

## Complex scene comparison after retrieval optimization

All tests used GPT-6 Luna, the optimized web retrieval path, real catalog
and subtitle services, and the isolated source-route harness. The current
configuration uses the production prompt and Responses transport; the
simplified SDK and libfx use the same experimental prompt and Chat
Completions with routing reasoning disabled.

| Prompt | Current | Simplified SDK | libfx |
| --- | --- | --- | --- |
| go to that one scene in b99 where holt complains about phd | Pass 32.16s | Pass 30.06s | Pass 41.66s |
| take me to the part in the office where andy thinks the fire is shooting at them | Pass 29.52s | Pass 19.31s | Ambiguous 37.00s |
| go to that part in better call saul where chuck loses it in front of the bar committee | Pass 15.37s | Pass 17.42s | Pass 20.46s |
| go to the scene in community where troy comes back with the pizzas and everything is on fire | No scene match 23.60s | No scene match 22.08s | No scene match 25.91s |
| take me to the part in severance where mark shouts shes alive | Pass 22.18s | Pass 18.09s | Pass 19.28s |
| go to the scene in nathan for you where he takes the signed paper from the lawyer | No scene match 33.45s | No scene match 41.14s | No scene match 42.02s |

Successful actions match the expected episode identities and dialogue:
The Box S5E14 (12:54–13:01, Holt's doctorate rant), Stress Relief S5E13
(3:22–3:30, the fire is shooting at us), Chicanery S3E5 (46:09, I am
not crazy), and The We We Are S1E9 (38:29, she's alive). Times are tied
to selected subtitle releases, not confirmed video playback.

Current and simplified SDK passed four of six; libfx passed three of six.
All three correctly found Remedial Chaos Theory S3E4 and Dumb Starbucks
S2E5 but could not substantiate the specific visual moment with dialogue.
These are failures to fulfill the requested seek, not incorrect episode
identifications. The Office libfx run abstained on episode ambiguity.

All variants chose the same compound scene tool. B99 research included
four episode-catalog assessment generations for the initial source set;
the libfx trial also needed a search refinement and a second round of
assessment. Slow retrieval and model verification of large episode
catalogs, rather than the outer agent loop, dominate these cases.

## Episode-title leads and compact catalog verification

TinySearch often returns an episode title directly. For example, a B99
search returned `Brooklyn Nine-Nine - The Box Quotes` and multiple IMDb
character/quote pages for The Box. Previously, the automatic resolver
ranked these only by words from the scene description and verified the
same retrieved pages against multiple 40-episode batches.

The updated resolver uses real catalog episode names as retrieval hints,
prefers distinct source hosts, retains search titles/snippets as leads
for a more focused fallback query, and verifies compact groups of up to
200 episode identities in one model call. Metadata-only assessments
retain their smaller batches. A search title cannot by itself authorize
navigation; the model still must associate the original event with the
canonical episode using fetched evidence. Internally verified episode
quotations now reach the subtitle matcher, as do the existing explicit
verification tool results.

Intermediate live trials exposed two false identifications: a later
Severance episode that summarized Mark's original finale scene, and
The Fire rather than Stress Relief in The Office. The revised evidence
instructions distinguish later recaps and dialogue that happens to match
an episode title from a source explicitly identifying the original
episode. Page-read failure also permits one focused search refinement.

Final live rechecks with the current AI SDK route and GPT-6 Luna:

| Scene | Previous current route | Updated route |
| --- | --- | --- |
| B99 PhD rant | 32.16s | 19.72s, correct |
| The Office fire drill | 29.52s | 11.59s, correct |
| Better Call Saul hearing | 15.37s | 12.17s, correct |
| Severance finale | 22.18s | 13.23s, correct |
| Community pizza scene | No match, 23.60s | No match, 22.21s |
| Nathan lawyer scene | No match, 33.45s | Prepared at 4:33, 39.07s; exact physical moment unconfirmed |
| Nathan Jimmy Kimmel | 8.90s median, previous optimization | 12.41s, correct |
| Impossible Nathan/Batman scene | No match | No match, 25.92s |

Additional intermediate B99 success took 15.42s. The final B99 selection
used one episode-verification generation instead of the four catalog
assessment generations seen in the earlier baseline. The final lawyer
trial prepared the correct episode and a line near the signing exchange,
but other trials still abstained on the physical action. Do not count
it as a reliably exact scene match. Community still selects the right
episode but lacks confident subtitle evidence for the visual scene.
Report these failures rather than relaxing verification.

These individual measurements are not a statistically reliable
performance estimate. Unit and regression checks cover title ranking,
source diversity, compact catalog coverage, refinement after unreadable
sources, preservation of search leads, and episode-evidence propagation.

### Matched libfx recheck after both optimizations

Same GPT-6 Luna model, evidence-first prompt, Chat Completions routing
with reasoning disabled, and scene/episode tools for both configurations.

| Scene | Simplified AI SDK | libfx |
| --- | --- | --- |
| B99 PhD rant | Pass, 22.92s | Pass, 37.84s |
| The Office fire drill | Pass, 11.87s | Pass, 11.07s |
| Better Call Saul hearing | Pass, 9.66s | Pass, 6.72s |
| Community pizza scene | No match, 8.16s | No match, 9.86s |
| Severance finale | Pass, 12.29s | Pass, 11.76s |
| Nathan lawyer scene | No match, 14.60s | Pass, 21.93s |

The libfx lawyer result selected the correct episode and dialogue
`Well, I handed it to you just to look over, but you already... No,
I'm not gonna give it back to you.` at 261.928s. This supports the
requested action, although the precise visual frame was not confirmed.

Libfx prepared five supported actions versus four for the simplified
SDK. Median time across all trials was 11.42s versus 12.08s. Both
correctly resolved all six episode identities, and neither matched the
Community visual moment. Libfx's slower B99 trial spent 31.95s in
episode resolution versus 15.85s for the SDK, including a refined
search using The Box and slow page reads. Initial outer-loop tool
selection was 1.34s versus 1.01s. All requests called the same compound
scene tool, so the different results do not establish an intrinsic
agent-engine accuracy or latency advantage.

## Controlled evaluation: distinguish routing from scene reasoning

The two previous lawyer trials called `skipToSubtitleContent` with
identical arguments, verified the same episode using the same two
source URLs, and loaded the same subtitle release. The outer engines
did not choose the timestamp; their shared nested GPT-6 Luna analysis
did.

`--matcher-repeats 6` captures the exact first subtitle-matching
generation in memory and reissues it with a fresh abort signal. Neither
agent engine, web search, nor subtitle retrieval runs during the repeated
generations. The report includes a SHA-256 fingerprint of the fixed
prompt, candidate, confidence, short supporting line and token usage,
not the complete subtitle text.

The captured signed-paper matching prompt used 7575 input tokens.
Repeated selection results:

| Repetition | Candidate source time | Confidence | Time |
| --- | --- | --- | --- |
| 1 | 261s, refusal to return paper | High | 6.90s |
| 2 | 257s, signed paper return exchange | High | 5.78s |
| 3 | 282s, pocket argument | High | 6.90s |
| 4 | 278s, pocket argument | High | 8.22s |
| 5 | 261s, refusal to return paper | High | 7.17s |
| 6 | 273s, signing discussion | Low | 7.99s |

These are initial model selections, not complete validated seeks.
The original full run abstained after its verification calls.
The exact 261s selection from the previous successful fx trial
appeared twice with the engine bypassed. The same input can therefore
lead to different answers and confidence levels.

The new `scripts/bench-navigator-engines.cjs` runner has twelve labeled
cases, including the visual-scene challenge, negative request,
playback, indirect film, ambiguity and grounded factual lookup. It
alternates engine order across pairs, uses the same model/options,
runs serially to reduce simultaneous quota contention, records
episode identity separately from matched dialogue/time/intent, and
keeps failures in latency reporting. Supporting lines and acceptable
timestamp windows are calibrated to known subtitle releases, not
frame-accurate video ground truth. A visual-only prepared action without
known timestamp evidence requires manual review; it is not a pass.

First three paired lawyer-only repetitions:

| Repetition | AI SDK | libfx |
| --- | --- | --- |
| 1 | No match, 16.32s | 4:33 signing discussion, fails scene criterion, 16.20s |
| 2 | No match, 37.17s | No match, 10.91s |
| 3 | No match, 13.50s | Supported pocket exchange, 22.66s |

All six identified the correct episode. The strict scene criterion
passed 0/3 for the SDK and 1/3 for fx. With identical outer tool
selections, the nested matcher remains the main reliability problem.
This sample is too small to declare a winner.

```sh
# List labeled cases without making requests.
node scripts/bench-navigator-engines.cjs --list

# Use OPENAI_API_KEY from the calling process, never from a command argument.
# Install libfx separately and supply the actual node.cjs path.
node scripts/bench-navigator-engines.cjs --live --repeats 5 \
  --fx-module /absolute/path/to/libfx/node.cjs \
  --out /absolute/path/to/new-evaluation-directory
```

For a stronger engine-specific comparison, add frozen catalog/search/
subtitle fixtures and run the outer agent against identical observations.
Include multi-tool and multi-turn questions, not only compound scene
tool calls. Then repeat the live suite to measure system-level behavior.
Do not attribute variability within a shared nested tool to its caller.

## Recommendation

Keep the AI SDK for provider adapters and UI streaming. Make the application
behave like a small evidence-grounded agent harness, rather than adding more
query-pattern routing:

- Give the model the original request and structured current context. Let it
  plan discovery, choose tools, and refine unsuccessful searches.
- Separate title/person discovery from action preparation. Use web discovery
  for indirect references and resolve actual catalog IDs before acting.
- Reduce overlapping tool responsibilities and repeated prompt instructions.
  Keep the fast literal-title path as a tool capability, not a user-query regex.
- Keep schemas, canonical identity checks, source and subtitle evidence,
  timestamps, authentication, cancellation, spoiler limits, and single-action
  execution in deterministic code.
- Optimize large subtitle analysis prompts independently from the agent loop.
- Expand the evaluation to test paraphrases, context carryover, ambiguity,
  factual evidence, negative cases, actions and timeouts before shipping.

libfx offers useful [streaming, tool execution and retry support](https://fx.sh/docs/lib.md),
[durable sessions](https://fx.sh/docs/lib/checkpoints.md), and host-owned
[tool side-effect controls](https://fx.sh/docs/lib/tools.md). It does not
remove the need for Navigator's domain tools or semantic grounding.
Its [custom provider interface](https://fx.sh/docs/lib/providers.md) uses Chat
Completions, whereas some current Navigator models use Responses. Native
addons are limited to macOS and Linux; Windows falls back to
[WebAssembly](https://fx.sh/docs/lib/node.md). Review deployment and provider
compatibility before considering a migration.

## Repeat the experiment

Run from the project root with configured credentials:

```sh
node scripts/test-navigator-episode-live.cjs --live \
  --provider gemini --model gemini-3.1-flash-lite --timings --report-only \
  --prompt 'go to the whos on first scene in nathan fielders new movie'

# Same request, alternative prompt with asserted identity and scene window
node scripts/test-navigator-episode-live.cjs --live \
  --provider gemini --model gemini-3.1-flash-lite --timings \
  --system-prompt-file scripts/fixtures/navigator-semantic-prompt.txt \
  --expected-media-id tt45368240 --timestamp-min 2820 --timestamp-max 2920 \
  --prompt 'go to the whos on first scene in nathan fielders new movie'
```

For libfx, install `libfx@0.0.18` in a separate temporary prefix, not in
Navigator. Supply the absolute path to its `node.cjs` with `--fx-module`.
Use `--provider groq --model openai/gpt-oss-120b` for both the SDK baseline
and the libfx variant with the same prompt.

`--report-only` records the trace without asserting the default episode
target. Judge a scene as successful only when there is one prepared action
for the correct film, a supported subtitle timestamp and no stream error or
unintended action. A fact requires retrieved evidence, not merely the right
answer. An incomplete turn, provider failure or rate limit is not a pass.
## One-pass matcher: paired engine recheck

After the one-pass cue matcher became the default, the same experimental
engine harness was run with GPT-6 Luna, libfx 0.0.18 and AI SDK. The
outer loops both used Chat Completions, reasoning `none`, a 1,400-token
output limit and the same evidence-first system prompt. Both called
the same Navigator tools, including the model-backed one-pass matcher
on Responses with its existing reasoning settings.

The suite used 14 requests, two repetitions per engine (56 requests
total). Engine order alternated within each case. Five groups ran
concurrently; the two engines in each pair ran sequentially. Provider
latency, live search and subtitle release selection varied. This is an
end-to-end comparison of the configured harnesses, not a measurement
of isolated runtime overhead.

| Case | SDK strict passes | fx strict passes | SDK median | fx median |
| --- | ---: | ---: | ---: | ---: |
| Play Interstellar (2014) | 2/2 | 2/2 | 2.00s | 1.63s |
| Open The Matrix (1999) | 2/2 | 2/2 | 1.01s | 0.91s |
| Open The Office S2E1 | 2/2 | 2/2 | 1.97s | 1.93s |
| Who directed Interstellar? | 0/2 | 0/2 | 1.98s | 1.16s |
| Hey, what can you do? | 2/2 | 2/2 | 1.32s | 1.21s |
| Open Dune (ambiguous) | 0/2 | 0/2 | 0.94s | 0.88s |
| Jimmy Kimmel | 2/2 | 2/2 | 17.86s | 7.89s |
| Lawyer, early return exchange | 1/2 | 0/2 | 12.09s | 16.78s |
| Brooklyn Nine-Nine | 2/2 | 1/2 | 17.80s | 16.58s |
| The Office fire | 2/2 | 2/2 | 8.69s | 8.65s |
| Better Call Saul | 2/2 | 2/2 | 6.27s | 6.97s |
| Severance | 2/2 | 2/2 | 11.92s | 10.83s |
| Community pizza | 0 confirmed | 0 confirmed | 12.44s | 17.59s |
| Impossible scene | 2/2 | 2/2 | 29.63s | 30.64s |

For the six positive scenes with subtitle-evidence criteria, SDK
passed 11/12 strict trials and fx passed 9/12. SDK also passed the
broader lawyer interaction criterion twice. All 14 positive episode
identities per engine were correct, including Community. Fx prepared
one unconfirmed Community action at 813.673s based on yelling and
earlier sound effects. It is not counted as a success without visual
ground truth. Both engines rejected both impossible-scene requests.
No playback was executed.

Both engines passed 8/12 simple requests. Both wrongly opened
Interstellar instead of answering the director question, and silently
opened Dune (2021) rather than clarifying the requested version.
These were shared task-routing failures, not provider errors.

Timing findings:

- Across all simple trials, median latency was 1.56s for SDK and
  1.16s for fx. Fx was faster in 10/12 paired trials.
- On the eight simple pairs where both engines passed, medians were
  1.57s and 1.54s. Fx was faster in 7/8, with a median paired saving
  of 0.11s. The bigger all-trial median difference includes failures.
- On the six positive scene cases, median end-to-end time was
  11.41s for SDK and 9.95s for fx, including failures. Each engine
  won six pairs; the median paired difference was 7ms in favor of fx.
- On the nine positive scene pairs where both passed strictly,
  medians were 9.23s and 8.45s. Fx won five pairs, with a median
  paired saving of 0.12s.
- Median matcher latency across all 14 scene analyses was 2.92s
  for SDK and 2.88s for fx. Their median matcher input sizes were
  8,976 and 8,792 tokens respectively.

The shared matcher had the same subtitle release filename in 11/14
pairs, but the exact matching prompt fingerprint was identical in
only one pair. Extracted scene descriptions, episode evidence and
retrieved source context can differ. Therefore these results cannot
attribute scene-selection differences to either outer runtime.

Conclusion: fx shows a modest speed advantage for successful simple
requests, but neither engine demonstrates a reliable advantage on
scene queries. SDK produced more supported scene seeks in this small
sample. Fix shared intent-routing behavior and expand the paired suite
before changing the default runtime. No engine migration was made.

Reproduce with `scripts/bench-navigator-engines.cjs --live`,
`--fx-module <absolute libfx node.cjs path>`, `--out <report directory>`,
`--repeats 2`, and
`--cases kimmel,b99,office,saul,severance,lawyer,community,negative,play,open,episode,director,hello,ambiguity`.
The reports include strict and broad scene scores, timing components,
subtitle release, tool count and matcher input fingerprint.
