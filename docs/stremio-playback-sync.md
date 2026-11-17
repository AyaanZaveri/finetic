# Stremio playback sync

Reviewed against Stremio's official source on 2026-11-17. Validation uses
mocked API responses and official bitfield fixtures. No live account writes
were run for this review.

Stremio stores playback in the `libraryItem` collection. A record belongs to
the title. For a series, `state.video_id` identifies the active episode.
Positions and durations use milliseconds. The player tracks time watched
separately from position. Seeking must not count as watching the skipped part.
The watched threshold is 70%. Completed playback past 90% clears the resume
position when the player stops.

Sources:

- [Core player and watch accounting](https://github.com/Stremio/stremio-core/blob/master/src/models/player.rs)
- [Library updates and API sync](https://github.com/Stremio/stremio-core/blob/master/src/models/ctx/update_library.rs)
- [Watched and credits thresholds](https://github.com/Stremio/stremio-core/blob/master/src/constants.rs)
- [Web player events](https://github.com/Stremio/stremio-web/blob/development/src/routes/Player/usePlayer.js)
- [Datastore request contract](https://github.com/Stremio/stremio-core/blob/master/src/types/api/request.rs)
- [Success and error response contract](https://github.com/Stremio/stremio-core/blob/master/src/types/api/response.rs)
- [Library state and watched episode ordering](https://github.com/Stremio/stremio-core/blob/master/src/types/library/library_item.rs)
- [Manual watched actions](https://github.com/Stremio/stremio-core/blob/master/src/models/meta_details.rs)

Reads use `datastoreGet` with `authKey`, `collection: "libraryItem"`, `ids`
and `all: false`. Writes use `datastorePut` with `authKey`, the collection and
`changes`. A successful write has `result.success: true`. For compatibility, the adapter also
accepts a boolean `result: true` shape. An HTTP 200 response alone
does not establish success.

Removing a card matches Stremio's `RewindLibraryItem`: clear `timeOffset`,
update `_mtime`, and preserve the rest of the record. Episode watched flags
use Stremio's compressed bitfield, sorted by season, episode and release date,
with season-zero specials first. Explicit episode toggles do not change the
playback completion counter. Navigator also keeps its active-episode flag in
sync and clears the active resume position when toggling that episode.

The reviewed sources do not establish a public API request quota or a required
scrobble interval. Navigator uses a 30-second interval as its own policy. It
does not send a request for each playback clock event.

Navigator samples time locally. Forward playback advances a cumulative session
watch counter. Large seeks, backward seeks, paused events and long gaps between
samples do not add skipped time. A sync saves the current position, even when
it is lower than the previous position. The session counter makes a repeated
write idempotent while its marker remains in the Stremio record. Other Stremio
clients may replace custom fields when they write their own state.

Start, pause and stop can flush outside the periodic interval. Unchanged
progress is skipped. One request runs at a time. Pending progress is replaced
with the latest snapshot, but start and stop events keep their order across
episodes. Failures get up to three delayed retries, with 30-, 60- and 120-second
backoff. A longer server `Retry-After` takes precedence. This queue lives in
the mounted app. It is not a durable offline queue, and forced process exit
or browser termination can lose unsaved progress.

Each sync reads the current title record before writing it. This preserves
library membership, metadata and watch history from the server. A failed read
does not create an empty replacement. API errors inside HTTP 200 responses
also count as failures. Continue Watching refreshes on stop and explicit
history changes, rather than reading the full library at each heartbeat.

Both automatic and manually selected streams resolve TMDB titles to the same
canonical playback ID. The server also normalizes title and episode keys.
Continue Watching collapses exact IDs, series IDs stored as episode IDs, and
verified TMDB/IMDb aliases. Equal title names only identify candidates for an
external-ID lookup. They never establish identity. A failed lookup keeps
separate records. The latest record wins before resume filtering, so an older
record cannot restore a cleared position. Existing cloud records are not
deleted or merged by this display repair. Other Stremio clients may still show
old duplicate cloud records.

Regression checks:

```sh
npm run test:watch-history
npm run test:continue-watching
node scripts/test-resume-items.cjs
node scripts/test-tmdb-playback-id.cjs
node scripts/test-player-clock-work.cjs
npx tsc --noEmit
```
