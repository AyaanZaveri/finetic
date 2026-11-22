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
const delay = () => new Promise(resolve => setTimeout(resolve, 300));

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
  console.log("PASS: native track loading, playback confirmation, paused switches, and source cleanup");
}

main().finally(() => controller.dispose()).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
