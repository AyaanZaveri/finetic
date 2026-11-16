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
