const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, globals = {}) {
    const context = { exports: {}, Buffer, URLSearchParams, AbortSignal, console, ...globals };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, context);
    return context.exports;
}

async function run() {
    const bits = load('lib/stremio-watched.ts', { require: name => name === 'server-only' ? {} : require(name) });
    const ids = Array.from({ length: 9 }, (_, i) => `tt2934286:1:${i + 1}`);
    const fixture = 'tt2934286:1:5:5:eJyTZwAAAEAAIA=='; // Official Stremio test fixture.
    assert.deepEqual([...bits.watchedVideoIds(fixture, ids)], ids.slice(0, 5));
    assert.deepEqual([...bits.watchedVideoIds(fixture, ids.slice(2))], ids.slice(2, 5), 'Anchor survives removed leading episodes');
    const added = bits.markVideoWatched(fixture, ids, ids[5]);
    assert.deepEqual([...bits.watchedVideoIds(added, ids)], ids.slice(0, 6), 'Preserve previous episodes when marking a new one');
    assert.equal(bits.watchedVideoIds('malformed', ids).length, 0);
    assert.equal(bits.markVideoWatched(`${ids[0]}:1:corrupt`, ids, ids[1]), `${ids[0]}:1:corrupt`, 'Never erase undecodable history');
    assert.equal(bits.watchedVideoIds('unknown:5:eJyTZwAAAEAAIA==', ids).length, 0, 'Do not guess unknown anchor mapping');
    assert.deepEqual([...bits.watchedVideoIds(null, ids, [0, 1, 1])], ids.slice(1, 3));

    const common = load('lib/watch-history.ts');
    const artwork = load('lib/artwork.ts');
    let library = [];
    const writes = [], reads = [], metadataCalls = [];
    let readError = false, writeError = false;
    const episodes = [
        { id: 'show:0:1', season: 0, episode: 1 },
        { id: 'show:1:2', season: 1, episode: 2 },
        { id: 'show:1:1', season: 1, episode: 1 },
    ];
    const globals = {
        require: name => {
            if (name === './auth' || name === '@/lib/server/auth') return { getAuthData: async () => ({ authKey: 'test-only' }) };
            if (name === '@/lib/tmdb-artwork') return { getTMDBArtwork: async () => undefined };
            if (name === './tv-shows') return { fetchEpisodes: async (id, _season, _signal, includeArtwork) => {
                assert.equal(includeArtwork, false, 'History reads and writes must not resolve episode thumbnails');
                metadataCalls.push(id);
                return id === 'tt2934286' ? ids.map((id, i) => ({ id, season: 1, episode: i + 1 })) : episodes;
            } };
            if (name === '@/lib/stremio-watched') return bits;
            if (name === '@/lib/watch-history') return common;
            if (name === '@/lib/artwork') return artwork;
            if (name === '@/lib/series-route') return load('lib/series-route.ts');
            if (name === '@/lib/tmdb-discovery') return { resolveTMDBPlaybackId: async id => id === 'tmdb:123' ? 'tt123' : id };
            return {};
        },
        fetch: async (url, options) => {
            const body = JSON.parse(options.body);
            assert.equal(body.collection, 'libraryItem');
            if (url.endsWith('/datastorePut')) {
                writes.push(body.changes[0]);
                library = library.filter(item => item._id !== body.changes[0]._id).concat(body.changes);
                return { ok: true, json: async () => writeError ? ({ error: { message: 'rejected' } }) : ({ result: true }) };
            }
            reads.push(body);
            assert.equal(options.cache, 'no-store');
            return { ok: true, json: async () => readError ? ({ error: { message: 'rejected' } }) : ({ result: library.filter(item => body.ids.includes(item._id)) }) };
        },
    };
    const actions = load('app/actions/media.ts', globals);
    const history = load('app/actions/watch-history.ts', globals);
    let session = 0;
    const start = actions.reportPlaybackStart, progress = actions.reportPlaybackProgress, stop = actions.reportPlaybackStopped;
    actions.reportPlaybackStart = value => start({ ...value, sessionId: `session-${++session}`, watchedTimeSeconds: 0 });
    actions.reportPlaybackProgress = value => progress({ ...value, sessionId: `session-${session}`, watchedTimeSeconds: value.currentTimeSeconds });
    actions.reportPlaybackStopped = value => stop({ ...value, sessionId: `session-${session}`, watchedTimeSeconds: value.currentTimeSeconds });
    const input = { libraryItemId: 'show', videoId: 'show:1:1', mediaType: 'series', mediaName: 'Show', currentTimeSeconds: 0, durationSeconds: 1000 };
    assert.equal(await actions.reportPlaybackStart(input), true);
    assert.equal(writes.at(-1).state.flaggedWatched, 0, 'Starting is not watched');
    await actions.reportPlaybackProgress({ ...input, currentTimeSeconds: 720 });
    assert.equal(writes.at(-1).state.flaggedWatched, 1);
    assert.deepEqual([...bits.watchedVideoIds(writes.at(-1).state.watched, bits.orderedEpisodeIds(episodes))], ['show:1:1']);
    await actions.reportPlaybackStart({ ...input, videoId: 'show:1:2', durationSeconds: 500 });
    const reset = writes.at(-1).state;
    assert.equal(reset.flaggedWatched, 0);
    assert.equal(reset.timeOffset, 0);
    assert.equal(reset.timeWatched, 0);
    assert.equal(reset.duration, 500000, 'Each episode uses its own duration');
    await actions.reportPlaybackProgress({ ...input, videoId: 'show:1:2', durationSeconds: 500, currentTimeSeconds: 200 });
    await actions.reportPlaybackStart({ ...input, videoId: 'show:1:2', durationSeconds: 500, currentTimeSeconds: 0 });
    assert.equal(writes.at(-1).state.timeOffset, 0, 'Play from start resets the previous resume position for the same episode');
    await actions.reportPlaybackProgress({ ...input, videoId: 'show:1:2', durationSeconds: 500, currentTimeSeconds: 20 });
    assert.equal(writes.at(-1).state.flaggedWatched, 0, 'Previous episode duration/position cannot complete the next episode');
    await actions.reportPlaybackProgress({ ...input, videoId: 'show:1:2', durationSeconds: 500, currentTimeSeconds: 400 });
    await actions.reportPlaybackStopped({ ...input, videoId: 'show:1:2', durationSeconds: 500, currentTimeSeconds: 500, ended: true });
    const final = writes.at(-1).state;
    assert.equal(final.timeOffset, 0);
    assert.equal(final.timesWatched, 2, 'Each episode counted once');
    assert.deepEqual([...bits.watchedVideoIds(final.watched, bits.orderedEpisodeIds(episodes))], ['show:1:1', 'show:1:2']);

    const scrobble = { libraryItemId: 'scrobble', videoId: 'scrobble', mediaType: 'movie', mediaName: 'Scrobble', durationSeconds: 1000, sessionId: 'scrobble-session' };
    await start({ ...scrobble, currentTimeSeconds: 0, watchedTimeSeconds: 0 });
    await progress({ ...scrobble, currentTimeSeconds: 900, watchedTimeSeconds: 3 });
    assert.equal(writes.at(-1).state.flaggedWatched, 0, 'Seeking near the end does not mark watched');
    await progress({ ...scrobble, currentTimeSeconds: 30, watchedTimeSeconds: 4 });
    assert.equal(writes.at(-1).state.timeOffset, 30000, 'Cloud resume saves backward seeks');
    assert.equal(writes.at(-1).state.timeWatched, 4000);
    await progress({ ...scrobble, currentTimeSeconds: 30, watchedTimeSeconds: 4 });
    assert.equal(writes.at(-1).state.timeWatched, 4000, 'Retry is idempotent');
    await start({ ...input, libraryItemId: 'tmdb:123', videoId: 'tmdb:123:1:2', sessionId: 'mapped', watchedTimeSeconds: 0 });
    assert.equal(writes.at(-1)._id, 'tt123', 'Server also canonicalizes manual/additional callers');
    assert.equal(writes.at(-1).state.video_id, 'tt123:1:2');
    const countBeforeError = writes.length;
    readError = true;
    assert.equal(await progress({ ...scrobble, currentTimeSeconds: 31, watchedTimeSeconds: 5 }), false);
    assert.equal(writes.length, countBeforeError, 'API read errors cannot overwrite existing history');
    readError = false; writeError = true;
    assert.equal(await progress({ ...scrobble, currentTimeSeconds: 31, watchedTimeSeconds: 5 }), false, 'HTTP 200 API errors are failures');
    writeError = false;

    library.push({ _id: 'movie', type: 'movie', state: { timesWatched: 1, timeOffset: 0 } },
        { _id: 'started', type: 'movie', state: { timeOffset: 200000 } },
        { _id: 'tt2934286', type: 'series', state: { watched: fixture } },
        { _id: 'latest-only', type: 'series', state: { timesWatched: 7, flaggedWatched: 1, video_id: 'latest-only:3:2' } });
    const requested = [{ id: 'show', type: 'series' }, { id: 'movie', type: 'movie' }, { id: 'started', type: 'movie' },
        { id: 'tt2934286', type: 'series' }, { id: 'latest-only', type: 'series' }];
    reads.length = 0;
    const result = await history.fetchWatchedItems(requested);
    assert.equal(reads.length, 1, 'Batch all visible cards into one datastore read');
    assert.equal(result['movie:movie'].movieWatched, true, 'Completion survives cleared resume position');
    assert.equal(result['movie:started'].movieWatched, false);
    assert.deepEqual([...result['series:show'].watchedEpisodeIds], ['show:1:1', 'show:1:2']);
    assert.deepEqual([...result['series:tt2934286'].watchedEpisodeIds], ids.slice(0, 5), 'Read existing Stremio episode history');
    assert.deepEqual([...result['series:latest-only'].watchedEpisodeIds], ['latest-only:3:2'], 'Times watched never marks all episodes complete');

    const show = library.find(item => item._id === 'show');
    show.state.timeOffset = 123000;
    show.poster = 'https://poster.test/show.jpg';
    show.removed = false;
    const inputToggle = { id: 'show', type: 'series', name: 'Show', videoId: 'show:1:1', watched: false };
    const unchecked = await history.setWatchedStatus(inputToggle);
    assert.deepEqual([...unchecked.watchedEpisodeIds], ['show:1:2']);
    assert.equal(writes.at(-1).state.timeOffset, 123000, 'Toggling another episode preserves active episode progress');
    assert.equal(writes.at(-1).state.flaggedWatched, 1, 'Toggling another episode preserves its watched flag');
    assert.equal(writes.at(-1).poster, show.poster);
    assert.equal(writes.at(-1).removed, false, 'Preserve library membership');
    const checked = await history.setWatchedStatus({ ...inputToggle, watched: true });
    assert.deepEqual([...checked.watchedEpisodeIds], ['show:1:2', 'show:1:1']);
    await history.setWatchedStatus({ ...inputToggle, videoId: 'show:1:2' });
    assert.equal(writes.at(-1).state.flaggedWatched, 0);
    assert.equal(writes.at(-1).state.timeOffset, 0);
    assert.equal(writes.at(-1).state.timeWatched, 0, 'Unwatched episode does not immediately auto-complete from previous watched time');
    const updatedHistory = await history.fetchWatchedItems([{ id: 'show', type: 'series' }]);
    assert.deepEqual([...updatedHistory['series:show'].watchedEpisodeIds], ['show:1:1']);
    const beforeInvalid = writes.length;
    assert.equal(await history.setWatchedStatus({ ...inputToggle, videoId: 'show:999:999' }), null);
    assert.equal(writes.length, beforeInvalid);
    assert.equal((await history.setWatchedStatus({ id: 'movie', type: 'movie', name: 'Movie', watched: false })).movieWatched, false);
    assert.equal(writes.at(-1).state.timesWatched, 0, 'Clear movie completion counters when unmarking');
    assert.equal((await history.setWatchedStatus({ id: 'movie', type: 'movie', name: 'Movie', watched: true })).movieWatched, true);
    assert.equal((await history.setWatchedStatus({ id: 'new-movie', type: 'movie', name: 'New movie', watched: true })).movieWatched, true,
        'Marking an unstarted title creates its Stremio history record');
    library.find(item => item._id === 'show').state.watched = 'show:1:1:1:corrupt';
    const beforeCorrupt = writes.length;
    assert.equal(await history.setWatchedStatus(inputToggle), null);
    assert.equal(writes.length, beforeCorrupt, 'Do not overwrite unreadable existing history');

    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    let watched = true;
    const { WatchedIndicator } = load('components/watched-indicator.tsx', {
        require: name => name === '@/contexts/watch-history-context' ? { useWatchedStatus: () => watched } : require(name),
    });
    const badge = renderToStaticMarkup(React.createElement(WatchedIndicator, { id: 'movie', type: 'movie', aboveProgress: true }));
    assert.ok(badge.includes('aria-label="Watched"'));
    assert.ok(badge.includes('fill-rule="evenodd"'), 'Check is cut out of the filled badge');
    assert.ok(badge.includes('bottom-5'), 'Keep the badge above the progress bar');
    assert.ok(!badge.includes('<button'), 'Status is not a misleading control');
    watched = false;
    assert.equal(renderToStaticMarkup(React.createElement(WatchedIndicator, { id: 'movie', type: 'movie' })), '');

    // Optimistic button/queue behavior is covered in test-watch-toggle-optimistic.cjs.

    // Exercise the shared provider: duplicate thumbnails share one lookup and
    // slow responses cannot overwrite newer history after playback completes.
    const slots = [], timers = new Map(), effects = [], pending = [];
    const events = new EventTarget();
    let cursor = 0, timerId = 0;
    const hooks = {
        createContext: () => ({ Provider: 'provider' }),
        useCallback: fn => fn,
        useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
        useState(initial) {
            const i = cursor++;
            slots[i] ??= { value: initial };
            return [slots[i].value, update => { slots[i].value = typeof update === 'function' ? update(slots[i].value) : update; }];
        },
        useEffect: fn => { effects.push(fn); },
    };
    const { WatchHistoryProvider } = load('contexts/watch-history-context.tsx', {
        window: events,
        setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; },
        clearTimeout: id => timers.delete(id),
        require: name => {
            if (name === 'react') return hooks;
            if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
            if (name === '@/lib/watch-history') return common;
            if (name === '@/app/actions/watch-history') return { fetchWatchedItems: requests => new Promise(resolve => pending.push({ requests, resolve })) };
            return {};
        },
    });
    const render = () => { cursor = 0; effects.length = 0; return WatchHistoryProvider({ children: null }).props.value; };
    const flush = () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); };
    let provider = render();
    const setup = effects[0];
    const cleanup = setup();
    const a = provider.subscribe({ id: 'movie', type: 'movie' });
    const b = provider.subscribe({ id: 'movie', type: 'movie' });
    const c = provider.subscribe({ id: 'show', type: 'series' });
    flush();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].requests.length, 2, 'Duplicate cards do not duplicate datastore reads');
    pending[0].resolve(result);
    await new Promise(setImmediate);
    provider = render();
    assert.equal(provider.items['movie:movie'].movieWatched, true);
    const refresh = () => { const event = new Event(common.WATCH_HISTORY_CHANGED); event.detail = { id: 'movie' }; events.dispatchEvent(event); flush(); };
    refresh();
    refresh();
    assert.equal(pending[1].requests.length, 1, 'Playback refreshes only the affected title');
    pending[2].resolve({ 'movie:movie': { movieWatched: false, watchedEpisodeIds: [] } });
    await new Promise(setImmediate);
    pending[1].resolve({ 'movie:movie': { movieWatched: true, watchedEpisodeIds: [] } });
    await new Promise(setImmediate);
    assert.equal(render().items['movie:movie'].movieWatched, false, 'Ignore stale request results');
    a(); b(); c(); cleanup();
    const strictCleanup = setup();
    provider.subscribe({ id: 'movie', type: 'movie' });
    flush();
    assert.equal(pending.length, 4, 'Effect replay can load history again rather than getting stuck in a cached loading state');
    strictCleanup();
    console.log('PASS: official Stremio bitfield compatibility, completion persistence, episode switching, batched history, and watched badge states.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
