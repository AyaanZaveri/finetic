const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const { load, hooks: fixtureHooks } = require('./test-support/react-hooks.cjs');
function languageRequire(name) {
    if (!['@/lib/media/audio-language', '@/lib/media/stream-release-info', '@/lib/media/stream-codecs', '@/lib/media/stream-cache-status', '@/lib/media/playback-limits', '@/lib/series-route'].includes(name)) return require(name);
    const context = { exports: {}, require: languageRequire };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(name.replace('@/', '') + '.ts', 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, context);
    return context.exports;
}

const React = require('react');
const { PlayerPlaybackError } = load('components/player-playback-error.tsx', {
    '@/components/ui/button': { Button: 'button' },
});

// Playback stream requests and the web startup watchdog use bounded timers.
// Keep them available inside the VM used for utility modules as well.

function transpile(file) {
    return ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        fileName: file,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
}
function utility(file) {
    const context = { exports: {}, Error, URL, crypto: { randomUUID }, setTimeout, clearTimeout, AbortController, AbortSignal, require: languageRequire };
    vm.runInNewContext(transpile(file), context);
    return context.exports;
}
function find(tree, predicate) {
    if (!tree || typeof tree !== 'object') return [];
    return [...(predicate(tree) ? [tree] : []), ...React.Children.toArray(tree.props?.children).flatMap(child => find(child, predicate))];
}
function checkSiblingKeys(tree) {
    const keys = new Set();
    React.Children.forEach(tree?.props?.children, child => {
        if (!React.isValidElement(child)) return;
        if (child.key !== null) {
            assert.ok(!keys.has(child.key), 'Player siblings must have unique keys during source replacement');
            keys.add(child.key);
        }
        checkSiblingKeys(child);
    });
}
class Media extends EventTarget {
    closest() { return null; }
    dataset = {};
    error = null;
    currentTime = 0;
    duration = 600;
    play() { return Promise.resolve(); }
}
function harness({ native = false, automatic = false, autoSelectWebStream = true, streams: customStreams, episodePosition } = {}) {
    const source = 'https://stream.example/Buddy.2160p.mkv';
    let request = { id: 'buddy', type: 'movie', name: 'Buddy', detailsPath: '/movie/buddy', navigatorActionId: 'test-playback-ack', resumePositionTicks: 42, ...(automatic ? {} : { streamUrl: source }) };
    if (episodePosition !== undefined) request = { ...request, type: 'series', mediaSourceId: 'buddy:1:2', resumePositionTicks: episodePosition };
    let visible = true, dirty = true, index = 0, tree, renderedVideo, media, timerId = 0, streamFetches = 0, wallTime = 0;
    const slots = [], effects = [], timers = new Map(), events = [], toasts = [], published = [], routes = [];
    const storage = new Map();
    const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
    const preferences = load('lib/media/playback-preferences.ts', {}, { localStorage });
    preferences.savePlaybackPreferences({ ...preferences.DEFAULT_PLAYBACK_PREFERENCES, autoSelectWebStream });
    const settingsHost = fixtureHooks();
    const settings = load('contexts/settings-context.tsx', {
        react: settingsHost.react, 'react/jsx-runtime': settingsHost.jsx, '@/lib/media/playback-preferences': preferences,
    }, { localStorage });
    const renderSettings = () => settingsHost.render(settings.SettingsProvider, { children: null });
    renderSettings(); settingsHost.flush(); renderSettings();
    const settingUpdates = [];
    const proxyRequests = [];
    const proxySource = 'https://proxy.example/_token_fixture/proxy/stream/video.mkv';
    const mediaFlow = load('lib/media/mediaflow-source.ts', { './playback-preferences': preferences }, {
        URL, fetch: async (path, options) => {
            proxyRequests.push({ path, body: JSON.parse(options.body), savedMode: preferences.readPlaybackPreferences().mediaFlowMode });
            return Response.json({ url: proxySource });
        },
    });
    const streams = customStreams || [{ url: source, title: '2160p HEVC DTS REMUX' },
        { url: 'https://stream.example/best.mp4', title: '1080p H264 AAC' },
        { url: 'https://stream.example/next.mp4', title: '720p H264 AAC' }];
    const dismissedToasts = [];
    const toast = (message, options) => toasts.push({ message, ...options });
    toast.error = toast; toast.success = toast; toast.dismiss = id => dismissedToasts.push(id);
    const noOp = () => {};
    const equal = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
    const hooks = {
        ...React,
        useState(initial) {
            const i = index++;
            slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
            return [slots[i].value, update => {
                const value = typeof update === 'function' ? update(slots[i].value) : update;
                if (!Object.is(slots[i].value, value)) { slots[i].value = value; dirty = true; }
            }];
        },
        useRef(initial) { return (slots[index++] ??= { current: initial }); },
        useMemo(create, deps) {
            const i = index++;
            if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { value: create(), deps };
            return slots[i].value;
        },
        useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
        useEffect(create, deps) {
            const i = index++;
            if (slots[i] && equal(slots[i].deps, deps)) return;
            effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: create() }; });
        },
    };
    hooks.useLayoutEffect = hooks.useEffect;
    const context = { exports: {}, Error, AbortController, Date: class extends Date { static now() { return wallTime; } }, console: { warn() {}, error() {} },
        setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
        clearTimeout(id) { timers.delete(id); },
        window: { dispatchEvent: noOp },
        document: { documentElement: { dataset: {} }, addEventListener: noOp, removeEventListener: noOp,
            dispatchEvent(event) { events.push(event.detail); } },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        require(name) {
            if (name === 'next/navigation') return { useRouter: () => ({ push(path, options) {
                assert.ok(find(tree, node => node.props?.['data-player-shell'] !== undefined).length, 'Navigation must wait for the opaque player shell to commit');
                routes.push({ path, options });
            } }) };
            if (name === 'react') return hooks;
            if (name === 'react-dom') return { preload: noOp, flushSync(callback) {
                callback();
                settingUpdates.splice(0).forEach(update => update());
                renderSettings();
            } };
            if (name === 'jotai') return { useAtomValue: () => false };
            if (name === 'framer-motion') return { motion: new Proxy({}, { get: (_, tag) => tag }), AnimatePresence: 'animate-presence' };
            if (name === 'sonner') return { toast };
            if (name.endsWith('.css')) return {};
            if (name === '@/contexts/MediaPlayerContext') return { useMediaPlayer: () => ({
                currentMedia: request, isPlayerVisible: visible, skipTimestamp: null,
                setIsPlayerVisible(value) { visible = value; dirty = true; },
                playMedia(value) { request = value; dirty = true; },
                setCurrentMediaWithSource: value => published.push(value), setCurrentTimestamp: noOp,
            }) };
            if (name === '@/contexts/settings-context') {
                return { useSettings: () => ({
                    ...settings.useSettings(),
                    updatePlaybackPreferences: patch => settingUpdates.push(() => settings.useSettings().updatePlaybackPreferences(patch)),
                }) };
            }
            if (name === '@/lib/media/subtitle-timing') {
                const timing = () => ({ key: null, seconds: 0, onChange: noOp });
                return { useSubtitleTiming: timing, useVideoTiming: timing, subtitleTime: time => time };
            }
            if (name === '@/lib/desktop/bridge') return { desktopBridge: () => native ? {} : null, recordDesktopStage() {} };
            if (name === '@/lib/media/playback-source') return utility('lib/media/playback-source.ts');
            if (name === '@/lib/media/playback-preferences') return preferences;
            if (name === '@/lib/media/mediaflow-source') return mediaFlow;
            if (name === '@/lib/media/playback-error') return load('lib/media/playback-error.ts', {}, { URL });
            if (name === '@/components/player-playback-error') return { PlayerPlaybackError: 'player-playback-error' };
            if (name === '@/lib/media/playback-reporter') return utility('lib/media/playback-reporter.ts');
            if (name === '@/lib/media/resolve-playback') return utility('lib/media/resolve-playback.ts');
            if (name === '@/lib/media/playback-details') return require('./test-support/playback-context.cjs').details;
            if (name === '@/lib/media/playback-titles') return utility('lib/media/playback-titles.ts');
            if (name === '@/lib/media/resume-playback') return utility('lib/media/resume-playback.ts');
            if (name === '@/lib/media/use-episode-continuation') return { useEpisodeContinuation: () => ({}) };
            if (name === '@/components/use-player-chapters') return { usePlayerChapters: () => [] };
            if (name === '@/lib/media/episode-continuation') return utility('lib/media/episode-continuation.ts');
            if (name === '@/lib/media/stream-playability') return { probeStreamPlayability: async () => 'supported' };
            if (name === '@/lib/media/fetch-playback-streams') return {
                async fetchPlaybackStreams() { streamFetches++; return streams; },
                createPlaybackStreamRequest(id, type) { streamFetches++; return { id, type, canonicalId: Promise.resolve(id), snapshot: { streams, pending: 0, total: streams.length, complete: true }, promise: Promise.resolve(streams), subscribe(listener) { listener(this.snapshot); return () => {}; } }; },
            };
            if (name === '@/lib/media/fetch-playback-details') return { fetchPlaybackDetails: async () => null };
            if (name === '@/lib/media/fetch-playback-episode') return { fetchPlaybackEpisode: async () => null };
            if (name === '@/app/actions') {
                const report = async () => true;
                return { fetchMediaDetails: async () => null, reportPlaybackStart: report, reportPlaybackProgress: report, reportPlaybackStopped: report };
            }
            if (name === '@/lib/media/playback-subtitles') return { PlaybackSubtitles: class { discover() { return Promise.resolve([]); } preload() {} } };
            if (name.startsWith('@/') || name === '@mux/mux-video-react') return new Proxy({}, { get: () => noOp });
            return require(name);
        },
    };
    vm.runInNewContext(transpile('components/global-media-player.tsx'), context);
    function render() {
        index = 0; dirty = false;
        tree = context.exports.GlobalMediaPlayer({});
        checkSiblingKeys(tree);
        const video = find(tree, node => node.props?.src && node.props.onError && node.props.onLoadedMetadata)[0];
        if (video) {
            if (!renderedVideo || renderedVideo.key !== video.key) media = new Media();
            video.props.ref.current = media;
        } else if (renderedVideo) renderedVideo.props.ref.current = null;
        renderedVideo = video;
        while (effects.length) effects.shift()();
    }
    return {
        source, timers, events, toasts, dismissedToasts, published, routes, proxySource, proxyRequests,
        get savedMode() { return JSON.parse(storage.get(preferences.PLAYBACK_PREFERENCES_KEY)).mediaFlowMode; },
        get video() { return renderedVideo; },
        get media() { return media; },
        get streamFetches() { return streamFetches; },
        get errorPanel() { return find(tree, node => node.type === 'player-playback-error')[0]?.props; },
        get errorVisible() { return Boolean(this.errorPanel); },
        get statsMenu() { return find(tree, node => node.props?.stats !== undefined)[0]?.props.stats; },
        get statsPanels() { return find(tree, node => node.props?.videoRef && node.props?.onClose); },
        get selection() { return find(tree, node => node.props?.onEpisodeSelect && node.props?.onStreamSelect)[0]?.props; },
        async settle() {
            // Wait for simulated fetch bodies and playback promises as well as queued state updates.
            for (let i = 0; i < 8; i++) {
                if (dirty) render();
                await new Promise(resolve => setImmediate(resolve));
            }
        },
        fail(code = 4) {
            media.error = { code, message: 'MEDIA_ELEMENT_ERROR: Format error' };
            renderedVideo.props.onError({ currentTarget: media, target: media });
        },
        advance(seconds) { wallTime += seconds * 1000; media.currentTime += seconds; renderedVideo.props.onTimeUpdate(); },
        playing() {
            media.error = null;
            renderedVideo.props.onPlaying({ currentTarget: media, target: media });
        },
        runTimer() {
            assert.equal(timers.size, 1, 'Exactly one startup retry is scheduled');
            const [id, timer] = timers.entries().next().value;
            timers.delete(id); timer.callback();
        },
        close() { find(tree, node => node.props?.['data-player-close'] !== undefined)[0].props.onClick(); },
        retry() { this.errorPanel.onRetry(); },
        replace() { request = { ...request, id: 'another-movie', streamUrl: 'https://stream.example/another.mp4' }; dirty = true; },
    };
}

async function run() {
    const stats = harness();
    await stats.settle();
    const [panel] = stats.statsPanels;
    assert.equal(panel?.props.open, false, 'The player owns one hidden stats panel before opening it');
    assert.equal(stats.statsMenu.open, false);
    stats.statsMenu.onOpenChange(true);
    await stats.settle();
    assert.equal(stats.statsPanels.length, 1);
    assert.equal(stats.statsPanels[0].props.open, true);
    stats.statsPanels[0].props.onClose();
    await stats.settle();
    assert.equal(stats.statsPanels[0].props.open, false, 'Closing hides the panel');
    assert.equal(stats.statsMenu.open, false, 'Closing the panel also resets the Settings action');
    for (const open of [true, false, true, false]) {
        stats.statsMenu.onOpenChange(open);
        await stats.settle();
        assert.equal(stats.statsPanels.length, 1, 'Settings always controls a single panel');
        assert.equal(stats.statsPanels[0].key, panel.key, 'Showing and hiding keep the same panel key');
        assert.equal(stats.statsPanels[0].props.open, open);
    }

    const selection = harness({ episodePosition: 42, autoSelectWebStream: false });
    await selection.settle();
    assert.equal(selection.selection.media.id, 'buddy:1:2');
    assert.equal(selection.selection.playingEpisode.season, 1);
    assert.equal(selection.selection.playingEpisode.episode, 2);
    selection.media.currentTime = 598;
    const replacement = 'https://stream.example/replacement.mp4';
    selection.selection.onStreamSelect({ url: replacement });
    await selection.settle();
    assert.equal(selection.video.props.src, replacement);
    selection.video.props.onLoadedMetadata();
    assert.equal(selection.media.currentTime, 598, 'A stream switch retains the current position near the end of an episode');
    assert.equal(selection.routes.length, 1, 'A stream switch keeps the page behind the player');

    selection.selection.onEpisodeSelect({ id: 'buddy:2:4', season: 2, episode: 4, title: 'A new episode', resumePositionTicks: 12 });
    await selection.settle();
    assert.equal(selection.selection.media.id, 'buddy:2:4');
    assert.equal(selection.selection.playingEpisode.season, 2);
    assert.equal(selection.selection.playingEpisode.episode, 4);
    selection.video.props.onLoadedMetadata();
    assert.equal(selection.media.currentTime, 12, 'A new episode uses its own resume position');
    assert.equal(selection.routes.length, 1, 'An episode switch keeps the page behind the player');

    for (const native of [false, true]) {
        for (const [saved, expected] of [[650, 0], [599, 0], [42, 42]]) {
            const episode = harness({ native, episodePosition: saved, autoSelectWebStream: false });
            await episode.settle();
            if (native) assert.equal(episode.video.props.startPosition, 0, 'Load the episode before applying its resume position');
            episode.video.props.onLoadedMetadata();
            assert.equal(episode.media.currentTime, expected, 'Validate the episode offset against the selected file');
        }
    }
    for (const native of [false, true]) {
        const episode = harness({ native, episodePosition: 42 });
        await episode.settle();
        episode.media.currentTime = 282;
        episode.media.ended = true;
        episode.video.props.onEnded({ currentTarget: episode.media });
        await episode.settle();
        if (native) {
            assert.equal(episode.errorVisible, true, 'A premature native end shows a retry');
            episode.retry();
            await episode.settle();
            assert.equal(episode.video.props.src, episode.source);
        } else {
            assert.equal(episode.errorVisible, false);
            assert.equal(episode.video.props.src, 'https://stream.example/best.mp4', 'Web recovery switches streams');
        }
        episode.video.props.onLoadedMetadata();
        assert.equal(episode.media.currentTime, 282, 'Recovery resumes the same episode at the interruption');
        assert.equal(episode.selection.playingEpisode.episode, 2);
    }
    const interrupted = harness({ episodePosition: 42, streams: [{ url: 'https://stream.example/Buddy.2160p.mkv' }] });
    await interrupted.settle();
    interrupted.media.currentTime = 282;
    interrupted.media.ended = true;
    interrupted.video.props.onEnded({ currentTarget: interrupted.media });
    await interrupted.settle();
    assert.equal(interrupted.errorVisible, true, 'Show a retry when no replacement stream is available');
    interrupted.retry();
    await interrupted.settle();
    interrupted.video.props.onLoadedMetadata();
    assert.equal(interrupted.media.currentTime, 282, 'Manual retry retains the interruption position after fallback is exhausted');
    for (const automatic of [false, true]) {
        const direct = harness({ automatic, autoSelectWebStream: false });
        await direct.settle();
        assert.equal(direct.video.props.src, direct.source, 'With selection off, web uses the first stream or explicit choice');
        direct.fail(); await direct.settle();
        assert.equal(direct.errorVisible, true, 'With selection off, a decoder error is shown without switching files');
        assert.equal(direct.video.props.src, direct.source);
        assert.equal(direct.toasts.length, 0);
        assert.equal(direct.streamFetches, automatic ? 1 : 0, 'Disabled recovery never fetches alternatives');
    }
    const unverified = harness({ automatic: true, autoSelectWebStream: false });
    await unverified.settle();
    unverified.media.webkitVideoDecodedByteCount = 20000;
    unverified.media.webkitAudioDecodedByteCount = 0;
    unverified.media.volume = 1;
    unverified.media.paused = false;
    unverified.playing(); await unverified.settle();
    unverified.advance(4); await unverified.settle();
    assert.equal(unverified.video.props.src, unverified.source, 'With selection off, silent decoding does not switch streams');
    assert.ok(unverified.events.some(event => event.state === 'playing'), 'Disabled audio checking does not withhold playing reports');
    assert.equal(unverified.toasts.length, 0);
    for (const automatic of [false, true]) {
        const player = harness({ automatic });
        await player.settle();
        assert.equal(player.routes[0].path, '/movie/buddy');
        assert.equal(player.routes[0].options.scroll, false);
        assert.equal(player.video.props.src, automatic ? 'https://stream.example/best.mp4' : player.source);
        const original = player.video;
        player.fail(); player.fail();
        await player.settle();
        assert.equal(player.errorVisible, false, 'A failed source must advance before showing a fatal error');
        assert.notEqual(player.video.key, original.key, 'Fallback must mount a new source');
        assert.equal(player.video.props.src, automatic ? 'https://stream.example/next.mp4' : 'https://stream.example/best.mp4');
        assert.equal(player.toasts.length, 1, 'Duplicate decoder errors must show one recovery toast');
        assert.equal(player.toasts[0].message, 'Trying another stream…');
        player.video.props.onLoadedMetadata();
        assert.equal(player.media.currentTime, 42, 'Scene/resume position must survive switching files');
        player.playing(); await player.settle();
        player.media.currentTime = 123;
        player.fail(3); await player.settle();
        player.video.props.onLoadedMetadata();
        assert.equal(player.media.currentTime, 123, 'Errors after playback starts must resume the next file at the current position');
        assert.equal(player.streamFetches, 1, 'Fallback must reuse discovered candidates instead of fetching them repeatedly');
        assert.equal(player.routes.length, 1, 'Stream fallback must not navigate again');
        assert.equal(player.errorVisible, false);
        assert.equal(player.timers.size, 0, 'Web recovery must not waste time retrying the same failed file');
    }

    const silent = harness({ automatic: true }); await silent.settle();
    silent.media.webkitVideoDecodedByteCount = 20000;
    silent.media.webkitAudioDecodedByteCount = 0;
    silent.media.volume = 1;
    silent.media.paused = false;
    silent.playing(); await silent.settle();
    assert.ok(silent.events.some(event => event.state === 'playing'), 'A genuine playing event is acknowledged even without audio byte counters');
    silent.advance(4); await silent.settle();
    assert.equal(silent.video.props.src, 'https://stream.example/best.mp4', 'Advancing video with a zero audio counter must not trigger failover');
    assert.equal(silent.toasts.length, 0);
    const audible = harness({ automatic: true }); await audible.settle();
    audible.media.webkitVideoDecodedByteCount = 20000;
    audible.media.webkitAudioDecodedByteCount = 4000;
    audible.media.volume = 1;
    audible.media.paused = false;
    audible.playing(); await audible.settle(); audible.advance(4); await audible.settle();
    assert.ok(audible.events.some(event => event.state === 'playing'), 'Decoded audio confirms successful playback');
    assert.equal(audible.video.props.src, 'https://stream.example/best.mp4', 'Confirmed audio and video must not trigger a fallback');
    assert.equal(audible.toasts.length, 0);

    const permanent = harness({ streams: [{ url: 'https://stream.example/Buddy.2160p.mkv' }] });
    await permanent.settle();
    permanent.fail(); await permanent.settle();
    assert.equal(permanent.errorVisible, true, 'Exhausting unique streams must stop with a useful error');
    assert.match(permanent.errorPanel.error.message, /No compatible video and audio stream/);
    assert.equal(permanent.toasts.length, 1, 'The terminal error appears in the player only');
    assert.equal(permanent.dismissedToasts.at(-1), permanent.toasts[0].id);
    assert.equal(permanent.streamFetches, 1);
    permanent.retry(); await permanent.settle();
    assert.equal(permanent.errorVisible, false, 'Manual retry begins a fresh attempt');

    const proxy = harness();
    await proxy.settle();
    proxy.video.props.onLoadedMetadata();
    proxy.advance(10);
    const directVideo = proxy.video;
    proxy.media.dataset.webgpuFallback = 'network-failed';
    proxy.fail();
    await proxy.settle();
    assert.equal(proxy.savedMode, 'off', 'Showing the proxy suggestion does not save a preference');
    const action = find(PlayerPlaybackError(proxy.errorPanel), node => node.type === 'button'
        && node.props.children === 'Enable proxy and retry')[0];
    assert.ok(action, 'A WebGPU source error offers a proxy retry');
    action.props.onClick();
    assert.equal(proxy.savedMode, 'in-house', 'Clicking the button saves the preference immediately');
    await proxy.settle();
    assert.deepEqual(proxy.proxyRequests, [{
        path: '/api/playback/source', body: { url: proxy.source, mediaFlow: 'in-house' }, savedMode: 'in-house',
    }], 'Retry requests the same stream through MediaFlow after saving the preference');
    assert.equal(proxy.video?.props.src, proxy.proxySource, proxy.errorPanel?.error.message);
    assert.notEqual(proxy.video.key, directVideo.key, 'Retry mounts a new playback attempt');
    assert.equal(proxy.video.props.startPosition, 52, 'Retry keeps the current playback position');
    proxy.playing(); await proxy.settle();
    assert.equal(proxy.errorVisible, false);
    assert.equal(proxy.toasts.at(-1).message, 'In-house proxy enabled');
    proxy.replace(); await proxy.settle();
    assert.equal(proxy.proxyRequests[1].body.url, 'https://stream.example/another.mp4');
    assert.equal(proxy.proxyRequests[1].savedMode, 'in-house', 'Later playback uses the saved mode');

    const closed = harness(); await closed.settle();
    closed.fail(); closed.close(); await closed.settle();
    assert.equal(closed.video, undefined, 'Closing playback must prevent a pending fallback from reopening it');

    const switched = harness(); await switched.settle();
    const stale = switched.video, staleMedia = switched.media;
    switched.fail(); switched.replace(); await switched.settle();
    stale.props.onError({ currentTarget: staleMedia, target: staleMedia }); await switched.settle();
    assert.equal(switched.video.props.src, 'https://stream.example/another.mp4');
    assert.equal(switched.errorVisible, false, 'Old decoder errors cannot cover a new title');

    const native = harness({ native: true, automatic: true }); await native.settle();
    assert.equal(native.video.props.src, native.source, 'Native playback preserves the first add-on file');
    native.fail(); await native.settle();
    assert.equal(native.errorVisible, true, 'Native playback keeps its existing error handling');
    assert.equal(native.toasts.length, 0, 'Native playback must not show web fallback toasts');
    assert.equal(native.streamFetches, 1);
    console.log('PASS: compatibility ranking, stream recovery, saved proxy retry, toasts, resume positions, cancellation, and native ordering.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
