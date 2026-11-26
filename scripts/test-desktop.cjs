const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const ts = require("typescript");
function languageRequire(name) {
    if (name === './preview-images') return require('./test-support/react-hooks.cjs').load('lib/desktop/preview-images.ts', {}, { URL });
    if (!['@/lib/media/audio-language', '@/lib/media/playback-preferences'].includes(name)) return require(name);
    const context = { exports: {}, require: languageRequire };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(name.slice(2)+'.ts', 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, context);
    return context.exports;
}


function load(file, globals = {}) {
    const context = { exports: {}, require: languageRequire, Event, EventTarget, CustomEvent, DOMException, URL, crypto, setTimeout, clearTimeout, ...globals };
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        fileName: file,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInNewContext(code, context);
    return context.exports;
}

async function testController(platform) {
    const { MpvController } = load("lib/desktop/mpv-controller.ts");
    const sent = [];
    const listeners = new Set();
    const bridge = {
        platform,
        capabilities: platform === "ios" ? { systemVolume: true } : { audioTiming: platform === "windows" || platform === "macos" },
        send: (message) => sent.push(message),
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    };
    const receive = (message) => [...listeners].forEach((listener) => listener(message));
    const media = new MpvController(bridge);
    media.volume = 0.6;
    media.muted = true;
    media.playbackRate = 1.5;
    assert.equal(sent.length, 0, "Preference restoration before load must not send commands without a session");
    const headers = { Referer: "https://example.test", "X-Test": "a,b" };
    media.load("https://example.test/video.mkv", headers, 123.4);
    assert.equal(sent.find(m => m.type === 'load').startPosition, 123.4, `${platform} must receive resume time before it prepares its first frame`);
    const first = sent.find((m) => m.type === "load").session;
    const audioSupported = platform === "macos" || platform === "windows";
    assert.equal(media.supportsAudioTiming, audioSupported);
    for (const [value, expected] of [[.16, .2], [-.36, -.4], [31, 30], [NaN, 0]]) {
        const count = sent.length;
        media.setAudioDelay(value);
        if (audioSupported) {
            assert.equal(sent.at(-1).type, "audio-delay");
            assert.equal(sent.at(-1).session, first);
            assert.equal(sent.at(-1).seconds, expected);
        } else assert.equal(sent.length, count, "Unsupported native hosts never receive audio delay");
    }
    const frames = [];
    media.addEventListener("previewframe", event => frames.push(event.detail));
    receive({ type: "thumbnail-frame", session: "old-session", position: 2, src: "data:image/jpeg;base64,AA==" });
    receive({ type: "thumbnail-frame", session: first, position: 2, src: "javascript:bad" });
    receive({ type: "thumbnail-frame", session: first, position: NaN, src: "data:image/jpeg;base64,AA==" });
    assert.equal(frames.length, 0, "Stale sessions and invalid streamed thumbnails never enter the web preview");
    receive({ type: "thumbnail-frame", session: first, position: 2, src: "data:image/jpeg;base64,AA==" });
    assert.equal(frames.length, 1, "Completed native frames stream independently of latest request cancellation");
    assert.equal(frames[0].position, 2);
    let subtitleChanges = 0;
    media.addEventListener("subtitlechange", () => subtitleChanges++);
    receive({ type: "subtitle", session: first, text: "First line\nSecond line" });
    assert.equal(media.subtitleText, "First line\nSecond line");
    receive({ type: "subtitle", session: first, text: "First line\nSecond line" });
    assert.equal(subtitleChanges, 1, "Repeated cues must not trigger redundant React renders");
    media.selectTrack("subtitle", "no");
    assert.equal(media.subtitleText, "", "Turning subtitles off must clear the overlay immediately");
    receive({ type: "subtitle", session: first, text: "Current cue" });
    assert.equal(sent[0].headers, headers);
    if (platform === "ios") {
        assert.equal(sent.some(m => m.type === "volume" || m.type === "muted"), false, "Starting iOS playback must preserve the current hardware volume");
        media.volume = 0.45;
        media.muted = true;
        assert.equal(sent.find(m => m.type === "volume").volume, 0.45, "Explicit UI volume commands still reach the native device-volume controller");
        assert.equal(sent.find(m => m.type === "muted").muted, true);
    } else {
        assert.equal(sent.find((m) => m.type === "volume").volume, 0.6);
        assert.equal(sent.find((m) => m.type === "muted").muted, true);
    }
    assert.equal(sent.find((m) => m.type === "rate").rate, 1.5);
    const audioTracks = [{ id: 1, type: "audio", lang: "rus", selected: true }, { id: 2, type: "audio", lang: "eng" }];
    receive({ type: "tracks", session: first, tracks: audioTracks });
    assert.equal(sent.filter(m => m.type === "track" && m.kind === "audio").at(-1).id, "2");
    media.selectTrack("audio", "1");
    const afterManual = sent.length;
    receive({ type: "tracks", session: first, tracks: audioTracks });
    assert.equal(sent.length, afterManual, "Do not override a later manual language selection");
    let ended = 0;
    media.addEventListener("ended", () => ended++);
    let observedDuration;
    let metadataEvents = 0;
    media.addEventListener("loadedmetadata", () => { observedDuration = media.duration; metadataEvents++; });
    const state = { position: 12, duration: 120, paused: false, volume: 0.6, muted: true, rate: 1.5, buffering: false, seeking: false, buffered: 40, width: 1920, height: 1080 };
    receive({ type: "state", session: first, state });
    receive({ type: "loaded", session: first });
    receive({ type: "ready", session: first });
    assert.equal(observedDuration, 120, "Resume handlers need real metadata at loadedmetadata");
    assert.equal(media.currentTime, 12);
    const preview = media.preview(20);
    const requested = sent.at(-1);
    assert.equal(requested.type, "thumbnail");
    assert.equal(media.currentTime, 12, "Hover preview requests must never seek the playback decoder");
    receive({ type: "thumbnail", session: first, request: requested.request - 1, src: "data:image/jpeg;base64,old", position: 0 });
    receive({ type: "thumbnail", session: first, request: requested.request, src: "data:image/jpeg;base64,frame", position: 20 });
    assert.equal(await preview, "data:image/jpeg;base64,frame");
    const cachedCount = sent.length;
    assert.equal(media.cachedPreview(20), "data:image/jpeg;base64,frame", "A cached thumbnail must be readable synchronously before gesture settle");
    assert.equal(await media.preview(20), "data:image/jpeg;base64,frame");
    assert.equal(sent.length, cachedCount, "Returning to an existing thumbnail cannot cross the native bridge again");
    receive({type:"thumbnail-frame", session:first, position:22, src:"data:image/jpeg;base64,WARM"});
    assert.equal(media.cachedPreview(22), "data:image/jpeg;base64,WARM", "Proactively generated frames are cached before hover mounts");
    const cancelled = media.preview(40);
    media.cancelPreview();
    assert.equal(await cancelled, null, "Leaving hover must cancel pending preview publication");
    assert.equal(media.readyState, 4);
    assert.equal(media.buffered.end(0), 40);
    assert.equal(media.seekable.end(0), 120);
    assert.throws(() => media.buffered.start(1), { name: "IndexSizeError" });
    media.currentTime = 45;
    assert.equal(sent.at(-1).position, 45);
    assert.equal(media.currentTime, 45, "Relative keys can read the requested seek before native acknowledgement");
    const count = sent.length;
    media.currentTime = -1;
    media.currentTime = Number.NaN;
    media.volume = Number.POSITIVE_INFINITY;
    assert.equal(sent.length, count, "Invalid numbers must never reach the native boundary");
    receive({ type: "state", session: first, state: { ...state, position: 45, buffering: true } });
    assert.ok(media.readyState < 3, "Buffering must drive the existing loading indicator");
    let playing = 0;
    media.addEventListener("playing", () => playing++);
    receive({ type: "state", session: first, state: { ...state, position: 45 } });
    assert.equal(playing, 1, "Recovery from buffering must notify Media Chrome that playback resumed");
    receive({ type: "loading", session: first });
    receive({ type: "state", session: first, state: { ...state, position: 65, paused: true } });
    receive({ type: "ready", session: first });
    assert.equal(metadataEvents, 1, "Android codec recreation must not rerun the initial resume/autoplay handler");
    assert.equal(media.currentTime, 65, "Foreground recovery preserves the native session's current position");
    assert.equal(media.paused, true, "Foreground recovery preserves a deliberately paused session");
    for (let at=1000; at<1300; at++) receive({type:"thumbnail-frame",session:first,position:at,src:"data:image/jpeg;base64,"+at});
    assert.equal(media.cachedPreview(1000),undefined,"Thumbnail cache must be bounded while watching long videos");
    assert.ok(media.cachedPreview(1299));
    media.load("https://example.test/second.mkv");
    assert.equal(media.cachedPreview(1299),undefined,"A new media session cannot show thumbnails from the previous file");
    const second = sent.filter((m) => m.type === "load").at(-1).session;
    assert.notEqual(first, second);
    if (audioSupported) {
        media.setAudioDelay(-1);
        assert.equal(sent.at(-1).session, second, "Delay applies only to the replacement session");
    }
    assert.equal(media.subtitleText, "", "Replacing a stream must clear its last cue");
    receive({ type: "subtitle", session: first, text: "Stale cue" });
    assert.equal(media.subtitleText, "", "Old sessions must not display subtitles on the new stream");
    receive({ type: "subtitle", session: second, text: "New cue" });
    assert.equal(media.subtitleText, "New cue");
    receive({ type: "ended", session: first });
    receive({ type: "error", session: first, message: "Previous file failed" });
    receive({ type: "state", session: first, state });
    assert.equal(ended, 0, "Stale EOF must not close the next title");
    assert.equal(media.error, null, "Stale failures must not replace the next title");
    assert.equal(media.currentTime, 0);
    receive({ type: "error", session: second, message: "HTTP 403" });
    assert.equal(media.error.message, "HTTP 403");
    assert.equal(media.subtitleText, "", "Playback errors must clear the subtitle overlay");
    await assert.rejects(media.play(), /HTTP 403/);
    media.dispose();
    media.dispose();
    assert.equal(sent.filter((m) => m.type === "stop" && m.session === first).length, 1, "Replacing a source stops its old session");
    assert.equal(sent.filter((m) => m.type === "stop" && m.session === second).length, 1, "Disposing twice stops the active session only once");
    assert.equal(listeners.size, 0);
    const unsafe = new MpvController(bridge);
    let errors = 0;
    unsafe.addEventListener("error", () => errors++);
    for (const url of ["file:///tmp/video", "edl://unsafe", "not-a-url"]) unsafe.load(url);
    assert.equal(errors, 3);
    assert.equal(sent.filter((m) => m.type === "load").length, 2, "Only HTTP(S) loads may be sent");
    unsafe.dispose();
}

function testAetherController() {
    const { MpvController } = load("lib/desktop/mpv-controller.ts");
    const sent = [];
    let listener;
    const controller = new MpvController({
        platform: "macos", capabilities: { aetherPlayback: true, initialSeek: true, audioTiming: true, subtitleTiming: true },
        send: value => sent.push(value), subscribe(callback) { listener = callback; return () => {}; },
    });
    controller.load("https://example.test/fixture.mkv", {}, 4);
    assert.equal(sent[0].type, "native-engine");
    assert.equal(sent[0].engine, "mpv", "The experimental engine is opt-in");
    const session = sent.find(message => message.type === "load").session;
    const state = { position: 20, duration: 120, paused: true, volume: 0.5, muted: false, rate: 1, buffering: false, seeking: false, buffered: 40, width: 320, height: 180 };
    let metadata = 0;
    controller.addEventListener("loadedmetadata", () => metadata++);
    listener({ type: "state", session, state: { ...state, engine: "aether", route: "loopback", hdr: "hdr10", videoDecoder: "VideoToolbox", engineVersion: "7.76.0" } });
    listener({ type: "loaded", session });
    listener({ type: "ready", session });
    listener({ type: "tracks", session, tracks: [
        { id: 2, type: "audio", lang: "eng", title: "English", codec: "aac", selected: true },
        { id: 4, type: "sub", lang: "eng", title: "English", codec: "subrip", selected: true },
    ] });
    assert.equal(controller.playbackStats.path, "AetherEngine");
    assert.equal(controller.playbackStats.videoDecoder, "VideoToolbox");
    listener({ type: "engine-fallback", session, reason: "AetherEngine playback failed" });
    assert.equal(controller.currentTime, 20);
    assert.equal(controller.paused, true);
    listener({ type: "state", session, state: { ...state, engine: "mpv" } });
    listener({ type: "tracks", session, tracks: [
        { id: 5, type: "audio", lang: "eng", title: "English", codec: "aac", selected: false },
        { id: 7, type: "sub", lang: "eng", title: "English", codec: "subrip", selected: false },
    ] });
    listener({ type: "loaded", session });
    listener({ type: "ready", session });
    assert.equal(metadata, 1, "An in-playback fallback must not rerun the initial resume/autoplay callback");
    assert.equal(controller.currentTime, 20);
    assert.equal(controller.paused, true);
    assert.equal(controller.playbackStats.path, "libmpv");
    assert.equal(controller.playbackStats.fallback, "AetherEngine playback failed");
    assert.ok(sent.some(message => message.type === "track" && message.id === "5"));
    assert.ok(sent.some(message => message.type === "track" && message.id === "7"));
    controller.dispose();
}

function testBridge() {
    let listener;
    let keydown;
    const sent = [];
    const events = new Map();
    const document = { documentElement: { dataset: {}, style: { setProperty() {} } }, addEventListener(type, callback) { events.set(type, callback); } };
    const window = { ipc: { postMessage: (value) => sent.push(JSON.parse(value)) }, addEventListener(type, callback, options) { if (type === "pagehide") listener = callback; if (type === "keydown") { keydown = callback; assert.equal(options.capture, true); } } };
    window.top = window;
    const script = fs.readFileSync("desktop/src/bridge.js", "utf8").replace("__PROTOCOL__", "1").replace("__ORIGIN__", JSON.stringify("http://localhost:3000")).replace("__PLATFORM__", JSON.stringify("macos"));
    vm.runInNewContext(script, { window, document, location: { origin: "http://localhost:3000" }, console });
    assert.equal(window.navigatorDesktop.protocol, 1);
    assert.equal(window.navigatorDesktop.capabilities.nativePreviews, true, 'The real desktop bridge must enable continuous native thumbnail delivery');
    assert.ok(Object.isFrozen(window.navigatorDesktop));
    assert.equal(document.documentElement.dataset.nativePlatform, "macos");
    assert.equal(document.documentElement.dataset.desktopFullscreen, "false");
    const mouse = events.get("mousedown");
    let prevented = 0;
    const press = (options = {}) => mouse({
        isTrusted: true, button: 0, clientY: 40,
        target: { closest: selector => selector === "[data-window-drag-region]" ? {} : null },
        preventDefault() { prevented++; }, ...options,
    });
    press();
    assert.equal(sent.at(-1).type, "window-drag", "Blank header space starts a native window drag");
    const count = sent.length;
    press({ isTrusted: false });
    press({ button: 2 });
    press({ target: { closest: () => ({}) } });
    press({ target: { closest: () => null }, clientY: 200 });
    assert.equal(sent.length, count, "Synthetic/right clicks, interactive controls and page content never drag");
    assert.equal(prevented, 1, "Only dragging consumes the mousedown event");
    let received = 0;
    const remove = window.navigatorDesktop.subscribe(() => received++);
    window.__navigatorDesktopReceive({ type: "fullscreen", value: true });
    assert.equal(window.navigatorDesktop.fullscreen, true);
    assert.equal(document.documentElement.dataset.desktopFullscreen, "true", "Native fullscreen updates the header's traffic light clearance");
    press();
    assert.equal(sent.length, count, "Fullscreen must leave all content gestures alone");
    assert.equal(received, 1);
    remove();
    window.__navigatorDesktopReceive({ type: "fullscreen", value: false });
    assert.equal(document.documentElement.dataset.desktopFullscreen, "false");
    assert.equal(received, 1);
    window.navigatorDesktop.send({ type: "load", session: "example", url: "https://example.test/video" });
    listener();
    assert.equal(sent.at(-1).type, "stop", "Reload must stop its old playback session");
    keydown({ key: "F11", repeat: false, preventDefault() {} });
    assert.deepEqual(sent.at(-1), { type: "fullscreen", value: true });
    const keyCount = sent.length;
    keydown({ key: "F11", repeat: true, preventDefault() {} });
    assert.equal(sent.length, keyCount, "Holding F11 cannot repeatedly toggle the native window");
    window.__navigatorDesktopReceive({ type: "fullscreen", value: true });
    keydown({ key: "Escape", repeat: false, preventDefault() {} });
    assert.deepEqual(sent.at(-1), { type: "fullscreen", value: false });
    const foreign = { top: null };
    foreign.top = foreign;
    vm.runInNewContext(script, { window: foreign, location: { origin: "https://untrusted.example" } });
    assert.equal(foreign.navigatorDesktop, undefined);
    const iframe = { top: {} };
    vm.runInNewContext(script, { window: iframe, location: { origin: "http://localhost:3000" } });
    assert.equal(iframe.navigatorDesktop, undefined);
    for (const platform of ["windows", "linux"]) {
        const handlers = new Map();
        const otherDocument = { documentElement: { dataset: {}, style: { setProperty() {} } }, addEventListener(type, callback) { handlers.set(type, callback); } };
        const otherWindow = { ipc: window.ipc, addEventListener() {} };
        otherWindow.top = otherWindow;
        vm.runInNewContext(script.replace('const platform = "macos"', `const platform = "${platform}"`), {
            window: otherWindow, document: otherDocument, location: { origin: "http://localhost:3000" }, console,
        });
        assert.equal(handlers.has("mousedown"), platform === "windows", "Frameless macOS and Windows support blank-header dragging; Linux keeps its system frame");
        assert.equal(otherDocument.documentElement.dataset.nativePlatform, platform);
        assert.equal(otherWindow.navigatorDesktop.capabilities.nativePreviews, true, `${platform} advertises the real native preview producer`);
    }
}

function testAskPlayback() {
    const { createStore } = require("jotai/vanilla");
    const artwork = load("lib/artwork.ts");
    const atoms = load("lib/atoms.ts", { require: name => name === "@/lib/artwork" ? artwork : name === "@/lib/media/playback-context" ? require("./test-support/playback-context.cjs") : name === "@/lib/desktop/bridge" ? load("lib/desktop/bridge.ts") : require(name) });
    const store = createStore();
    store.set(atoms.isAIAskOpenAtom, true);
    const item = { id: "tt123", name: "Fixture", type: "movie" };
    store.set(atoms.playMediaAtom, item);
    assert.equal(store.get(atoms.isAIAskOpenAtom), false, "Starting playback through Ask Navigator must close its panel");
    assert.equal(store.get(atoms.isPlayerVisibleAtom), true, "Launcher and gradients must hide before stream loading completes");
    assert.equal(store.get(atoms.currentMediaAtom), item);
}

Promise.all([testController("android"), testController("ios")]).then(() => {
    testAetherController();
    testBridge();
    require("./test-desktop-drag.cjs");
    testAskPlayback();
    console.log("Desktop playback adapter and bridge tests passed.");
}).catch((error) => { console.error(error); process.exitCode = 1; });
