# Scene shortlist evaluation

The tested prototype scans the full chronological transcript for up to six possible moments. It expands these proposals into nearby dialogue, merges overlapping windows, and compares the occurrences. This uses semantic matching. It does not require a keyword hit or an embedding index.

Its comparison returns brief classifications (recap, setup, event, or unclear) and subtitle evidence indices. The prototype accepts a high-confidence result only when the selected moment is marked as matching the request and its indices belong to the supplied context. It resolves the playback timestamp from the original subtitle data. Missing evidence returns no match.

Candidate extraction used the existing fast model settings. The final DeepSeek comparison was tested both without reasoning and with low reasoning. With reasoning disabled, repeated live requests sometimes chose recap dialogue despite high confidence. This is a measured accuracy problem, not a reason to claim faster successful searches. The experiment was not retained in the running application because it did not establish a reliable speed improvement. The previously pushed English SDH and scene lookup fixes remain unchanged.

## Method

Live requests use curl against the user's existing development server. The full request is `go to the conquest fight in invincible`, with no supplied current media or transcript. The test account's subtitle provider returns English SDH for Invincible S3 E8. These experiments used Muse Spark for tool routing and DeepSeek Flash for analysis. The app now uses the user-selected model for every model step. Mixed-model experiment timings do not describe that current configuration.

These are individual requests with warm server caches, not a controlled benchmark. Timings include provider and network variability. API checks verify returned episode, subtitle metadata, timestamp and no-match behavior. They do not verify video frames through playback.

The test variants include the same query with an already loaded episode and transcript, a misspelled request (`go to the conkwest fite in invincble`), and an absent cooking-competition scene. An absent scene correctly returned no match. The configuration with reasoning disabled still selected recap dialogue for the misspelled request and a repeated full request.

## Measured tradeoff

With reasoning disabled, one full request took 16.572 seconds and selected 46.839 seconds, around the transition into the main fight. A repeat took 17.933 seconds but selected 28.779 seconds in the opening montage. That repeat is an accuracy failure, regardless of the tool's high confidence. The misspelled request also selected an opening recap quote. An already loaded exact-query request abstained, so its shorter elapsed time is not a successful search result.

One isolated comparison with low reasoning and the shortened comparison instructions took 29.772 seconds and selected 46.839 seconds. An earlier low-reasoning misspelling trial hit the comparison deadline. The last prototype allowed 45 seconds for comparison instead of 30 seconds, with bounded structured generation and request cancellation. The final full request with low reasoning ended after 60.123 seconds with an abort event and no scene result. Episode discovery completed at 23.109 seconds and English SDH loaded at 25.251 seconds. The outer SDK step deadline expired while matching. HTTP completion and curl exit zero do not make this a successful scene search. This strategy does not establish a latency improvement or reliable three-second scene search.

## Regression coverage

The prototype regression fixtures checked full-transcript coverage during candidate discovery, nearby context with original indices, merging and bounds, comparison replacing an earlier proposal, rejection of unshown indices and contradictory classifications, no-match behavior, cancellation and subtitle snapshot reuse. These fixtures validate the pipeline, not the model's semantic accuracy.

TypeScript and the Navigator regression suite passed for the prototype. The prototype source changes were then removed from the running application. A local patch retains them for further evaluation. No app build, native playback test or release was performed for these experiments.
