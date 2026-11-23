const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const crypto = require("node:crypto");
function load(file, extra = {}) {
  const context = { exports: {}, require: name => name === './preview-images' ? require('./test-support/react-hooks.cjs').load('lib/desktop/preview-images.ts', {}, { URL }) : ["@/lib/media/audio-language", "@/lib/media/playback-preferences"].includes(name) ? load(name.slice(2)+".ts") : require(name), Event, EventTarget, CustomEvent, DOMException, URL, crypto, setTimeout, clearTimeout, ...extra };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  return context.exports;
}

(async () => {
  for (const platform of ["windows", "macos", "android"]) {
    for (const timings of [false, true]) {
      const sent = [];
      const { recordDesktopStage } = load("lib/desktop/bridge.ts", {
        window: { navigatorDesktop: { protocol: 1, platform, capabilities: { timings }, send: message => sent.push(message) } },
      });
      recordDesktopStage("play-requested");
      assert.equal(sent.length, ["windows", "macos"].includes(platform) && timings ? 1 : 0, "Diagnostics must be opt-in and must not send new commands to older native builds");
      if (sent.length) assert.equal(sent[0].type, "client-stage");
    }
  }
  let clock = 1000;
  let listener;
  const sent = [];
  const { MpvController } = load("lib/desktop/mpv-controller.ts", { Date: { now: () => clock } });
  for (const systemMedia of [false, true]) {
    const commands = [];
    const client = new MpvController({ platform: 'windows', capabilities: { systemMedia },
      send: message => commands.push(message), subscribe: () => () => {} });
    const metadata = { title: 'Episode', subtitle: 'Series' };
    client.setMediaMetadata(metadata);
    assert.equal(commands.length, 0, 'Never publish without a session');
    client.load('https://example.test/one');
    client.setMediaMetadata(metadata);
    client.setMediaMetadata({ ...metadata });
    client.load('https://example.test/two');
    client.setMediaMetadata(metadata);
    const loads = commands.filter(command => command.type === 'load');
    assert.deepEqual(commands.filter(command => command.type === 'media-metadata').map(command => command.session),
      systemMedia ? loads.map(command => command.session) : [], 'Publish once per source and only to supported Windows hosts');
    client.dispose();
  }
  const media = new MpvController({ platform: "windows", send: message => sent.push(message), subscribe(fn) { listener = fn; return () => {}; } });
  media.load("https://example.invalid/video.mkv");
  const session = sent.find(m => m.type === "load").session;
  const state = { position: 10, duration: 120, paused: false, volume: 1, muted: false, rate: 1, buffering: false, seeking: false, buffered: 40, width: 1920, height: 1080 };
  const receive = value => listener({ type: "state", session, state: { ...state, ...value } });
  receive({}); listener({ type: "loaded", session }); listener({ type: "ready", session });
  media.pause();
  assert.equal(media.paused, true, "Pause feedback cannot wait for IPC");
  receive({});
  assert.equal(media.paused, true, "An in-flight state snapshot cannot undo a pending pause");
  receive({ paused: true });
  let playing = 0;
  media.addEventListener("playing", () => playing++);
  await media.play();
  assert.equal(media.paused, false);
  receive({ paused: true });
  assert.equal(media.paused, false);
  assert.equal(playing, 0, "Optimistic play does not claim frames are playing before native confirmation");
  receive({});
  assert.equal(playing, 1, "Native confirmation still emits playing after an optimistic resume");
  media.currentTime = 45;
  assert.equal(media.currentTime, 45, "Seeking updates the visible timeline synchronously");
  assert.equal(media.seeking, true);
  receive({ position: 10 });
  assert.equal(media.currentTime, 45);
  receive({ position: 45.1 });
  assert.equal(media.seeking, false);
  assert.equal(media.currentTime, 45.1);
  media.volume = 0.4;
  receive({ volume: 1 });
  assert.equal(media.volume, 0.4);
  clock += 1100;
  receive({ volume: 0.8 });
  assert.equal(media.volume, 0.8, "Native truth wins when a request isn't acknowledged before its bound");
  media.currentTime = 90;
  media.load("https://example.invalid/replacement.mkv");
  assert.equal(media.currentTime, 0, "Replacement clears pending optimistic state");
  media.dispose();

  for (const platform of ['windows', 'macos', 'linux', 'android', 'ios']) {
    const commands = [];
    let handleMessage, fireHold;
    const native = new MpvController({ platform, send: message => commands.push(message),
      subscribe(fn) { handleMessage = fn; return () => {}; } });
    const { createPlaybackSpeedHold } = load('lib/media/playback-speed-hold.ts', {
      setTimeout(fn) { fireHold = fn; return 1; }, clearTimeout() {},
    });
    native.load('https://example.invalid/paused.mkv');
    const session = commands.find(command => command.type === 'load').session;
    const receive = (rate, paused = true) => handleMessage({ type: 'state', session, state: { ...state, paused, rate } });
    receive(1.25); handleMessage({ type: 'loaded', session }); handleMessage({ type: 'ready', session });
    const boost = createPlaybackSpeedHold({ currentMedia: () => native, canBoost: () => true,
      onActive() {}, onTap() { assert.fail('A long press must not tap'); } });

    boost.press('space'); fireHold();
    receive(1.25);
    assert.equal(native.playbackRate, 2, 'A pre-boost snapshot cannot erase the active rate');
    boost.releaseSpace();
    assert.deepEqual(commands.slice(-4).map(command => [command.type, command.rate]),
      [['rate', 2], ['play', undefined], ['pause', undefined], ['rate', 1.25]],
      `${platform}: pause is sent even when play has not been acknowledged`);
    assert.equal(native.paused, true, 'Release updates the visible transport immediately');
    receive(2, false);
    assert.equal(native.paused, true, 'A stale play snapshot cannot undo release');
    assert.equal(native.playbackRate, 1.25, 'A stale boost snapshot cannot erase the restored rate');
    receive(1.25);

    boost.press('space'); fireHold();
    native.load('https://example.invalid/replacement.mkv');
    const stop = commands.findIndex(command => command.type === 'stop');
    assert.equal(commands[stop - 2].type, 'pause');
    assert.equal(commands[stop - 2].session, session, 'Stop temporary playback on the outgoing session');
    assert.equal(commands.at(-1).rate, 1.25, 'The replacement inherits the restored rate');
    boost.releaseSpace();
    native.dispose();
  }

  // Exercise readiness after hydration, cancellation, and platform gating.
  for (const platform of ["windows", "macos", "android"]) {
    const frames = new Map(); let index = 0; let effect;
    const messages = [];
    const { DesktopAppReady } = load("components/desktop/app-ready.tsx", {
      requestAnimationFrame(fn) { frames.set(++index, fn); return index; },
      cancelAnimationFrame(id) { frames.delete(id); },
      require(name) {
        if (name === "react") return { useEffect(fn) { effect = fn; } };
        if (name === "next-themes") return { useTheme: () => ({ resolvedTheme: "dark" }) };
        if (name === "@/lib/desktop/bridge") return { desktopBridge: () => ({ platform, send: m => messages.push(m) }), recordDesktopStage() {} };
        throw new Error(name);
      },
    });
    DesktopAppReady(); const cleanup = effect();
    assert.equal(messages.length, 0);
    if (platform === "windows") {
      frames.get(1)(); assert.equal(messages.length, 0);
      frames.get(2)(); assert.equal(messages[0].type, "app-ready"); assert.equal(messages[0].dark, true);
      cleanup(); assert.equal(frames.size, 0);
      DesktopAppReady(); const cancel = effect(); cancel();
      assert.equal(frames.size, 0, "Unmount before paint cannot signal readiness");
    } else assert.equal(frames.size, 0, "Existing native clients never receive the Windows readiness command");
  }
  console.log("Windows immediate controls, native reconciliation, and painted app readiness passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
