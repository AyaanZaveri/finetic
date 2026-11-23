const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { load } = require("./test-support/react-hooks.cjs");

const { MpvController } = load("lib/desktop/mpv-controller.ts", {
  "@/lib/media/audio-language": { preferredAudioTrack: () => undefined },
  "@/lib/media/playback-preferences": { readPlaybackPreferences: () => ({}) },
}, { Event, EventTarget, URL, crypto, setTimeout, clearTimeout });

let receive;
const sent = [];
const controller = new MpvController({
  platform: "windows",
  send: message => sent.push(message),
  subscribe: listener => { receive = listener; return () => {}; },
});
const delay = () => new Promise(resolve => setTimeout(resolve, 450));

async function main() {
  controller.load("https://example.test/video.mkv");
  const session = controller.previewSession;
  const emit = message => receive({ session, ...message });
  const tracks = (audio, subtitle) => emit({ type: "tracks", tracks: [
    ...[1, 2].map(id => ({ id, type: "audio", selected: id === audio })),
    { id: 3, type: "sub", selected: subtitle === 3 },
  ] });
  let state = { position: 5, paused: false, buffering: false, seeking: false };
  const playback = change => {
    state = { ...state, ...change };
    emit({ type: "state", state });
  };
  playback({});
  emit({ type: "ready" });
  tracks(1);

  controller.selectTrack("audio", "2");
  assert.equal(controller.fetchingTrack, null);
  playback({ buffering: true });
  tracks(2);
  await delay();
  assert.equal(controller.fetchingTrack, "audio");
  playback({ buffering: false });
  assert.equal(controller.fetchingTrack, "audio");
  playback({ position: 5.25 });
  assert.equal(controller.fetchingTrack, null);

  const events = [];
  controller.addEventListener("trackloadingchange", () => events.push(controller.fetchingTrack));
  controller.selectTrack("audio", "1");
  tracks(1);
  playback({ position: 5.5 });
  playback({ position: 5.75 });
  await delay();
  assert.deepEqual(events, [], "Fast switches do not flash the pill");

  playback({ paused: true });
  controller.selectTrack("subtitle", "3");
  await delay();
  assert.equal(controller.fetchingTrack, "subtitle");
  tracks(1, 3);
  assert.equal(controller.fetchingTrack, null, "A paused switch only needs track confirmation");
  assert.equal(controller.paused, true);
  assert.ok(sent.every(message => !["pause", "play", "seek"].includes(message.type)));

  controller.selectTrack("audio", "2");
  await delay();
  assert.equal(controller.fetchingTrack, "audio");
  controller.selectTrack("audio", "1");
  playback({});
  assert.equal(controller.fetchingTrack, "audio", "A state update alone cannot confirm a track");
  tracks(2);
  assert.equal(controller.fetchingTrack, "audio", "An older selection cannot finish the new one");
  tracks(1);
  assert.equal(controller.fetchingTrack, null);

  controller.selectTrack("audio", "2");
  await delay();
  assert.equal(controller.fetchingTrack, "audio");
  controller.load("https://example.test/other.mkv");
  assert.equal(controller.fetchingTrack, null);

  for (const platform of ["macos", "windows", "linux", "android", "ios"]) {
    let receive;
    const player = new MpvController({ platform, send() {}, subscribe: listener => { receive = listener; return () => {}; } });
    try {
      player.load("https://example.test/first-switch.mkv");
      const emit = message => receive({ session: player.previewSession, ...message });
      let position = 5;
      const clock = (at, buffering = false) => emit({ type: "state", state: { position: at, paused: false, buffering, seeking: false } });
      clock(position);
      emit({ type: "loaded" });
      emit({ type: "ready" });
      for (const [kind, type] of [["subtitle", "sub"], ["audio", "audio"]]) {
        emit({ type: "tracks", tracks: [{ id: 2, type, selected: false }] });
        player.selectTrack(kind, "2");
        emit({ type: "tracks", tracks: [{ id: 2, type, selected: true }] });
        clock(position += 0.25); // An advancing clock sample can already be queued.
        clock(position, true);
        assert.equal(player.fetchingTrack, kind, `${platform} shows the first ${kind} stall despite an early clock sample`);
        clock(position, false);
        assert.equal(player.fetchingTrack, kind, "Canplay without playback progress must keep the indicator");
        clock(position += 0.25);
        assert.equal(player.fetchingTrack, null);
      }
    } finally { player.dispose(); }
  }
  console.log("PASS: native track loading, playback confirmation, paused switches, and source cleanup");
}

function testBrowserAudio() {
  const timers = new Map();
  const { watchBrowserAudioSwitch } = load("lib/media/browser-audio-switch.ts", {}, {
    setTimeout: (run, delay) => { timers.set(delay, run); return delay; },
    clearTimeout: delay => timers.delete(delay),
  });
  const media = Object.assign(new EventTarget(), { currentTime: 5, readyState: 4, paused: false });
  const list = new EventTarget();
  let selected = false;
  const states = [];
  const watch = () => watchBrowserAudioSwitch(media, list, () => selected, state => states.push(state));
  const clock = position => { media.currentTime = position; media.dispatchEvent(new Event("timeupdate")); };
  watch();
  selected = true;
  list.dispatchEvent(new Event("change"));
  clock(5.25);
  media.dispatchEvent(new Event("waiting"));
  assert.deepEqual(states, [true], "The first browser audio stall shows the indicator after a queued clock update");
  clock(5.25);
  assert.deepEqual(states, [true]);
  clock(5.5);
  assert.deepEqual(states, [true, false]);
  selected = false;
  watch();
  timers.get(400)();
  clock(6);
  assert.deepEqual(states, [true, false, true], "An async browser audio decoder is still fetching until the track is selected");
  media.dispatchEvent(new Event("emptied"));
  assert.deepEqual(states, [true, false, true, false]);
  assert.equal(timers.size, 0);
  console.log("PASS: browser and asynchronous audio switching, buffering and source cleanup");
}

main().then(testBrowserAudio).finally(() => controller.dispose()).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
