# WebGPU playback

Navigator uses WebGPU-Player for direct video files when the browser provides a
secure context, WebGPU, WebCodecs video decoding, and AudioWorklet. The engine
checks the actual file, browser, and GPU before it selects a decoding route.
API presence alone does not establish codec support.

The existing player controls stay in place. Play, pause, seek, volume, playback
speed, framing, external and embedded text subtitles, progress reporting, and episode continuation
use the same media element interface. The audio menu lists the file's audio
tracks and selects the saved language. Desktop playback continues to use mpv.

## Runtime assets

The npm lockfile pins the prebuilt embedding distribution at version 0.5.0.
`npm run prepare:webgpu` copies its complete `libraries` folder to
`public/webgpu-player/0.5.0/libraries`. `predev` and `prebuild` run this step.
The copy keeps the workers, WASM, probe files, license texts, and decoder source
links together. One reviewed adaptation in the embedding module reserves audio
ordinal `-1` for video-only playback. The published module normally treats every
request as an audio selection, so an unsupported audio track can reject a valid
video route. The adaptation removes audio from the metadata used for that one
negotiation. The engine's existing no-audio path then skips audio decoding and
output. Normal audio requests keep their original behavior.

`scripts/webgpu-runtime-patch.mjs` checks the pinned module's version and SHA-256
before applying this small change. A different runtime fails asset preparation
until the adaptation is reviewed. Workers and WASM stay byte-for-byte unchanged.
The runtime test exercises the shipped embedding function at its negotiation
boundary, including its original refusal and its video-only route.

The browser imports the embedding module only when playback needs it. The module
resolves workers and decoder packages relative to its own versioned URL.
There is no runtime CDN dependency. An upgrade must update the pinned npm
version, refresh the assets, and fully reload open pages. Deployment must copy
the public folder, as the existing standalone packaging does.

If dependencies were installed with scripts disabled and a server is already
running, run `npm run prepare:webgpu` before testing playback.

## Fallback and resource limits

An audio-route refusal or decode startup failure first retries the same file
through the GPU engine without audio. A successful retry shows a short notice
that audio is unavailable. Stream checks accept this route when it presents
video. The retry keeps the playback position and does not publish new initial
metadata that could reset a saved resume position.

A rejected video-only retry, module load failure, GPU failure, or setup timeout
restores the browser media API and loads the same URL through the existing
Mux or native path. Each route has a 30-second setup limit. A URL-free failure
code stays on `data-webgpu-fallback` for diagnosis and appears in the final
error if browser playback also fails. Position, volume, mute, speed, and pause state carry over.
If that path fails too, Navigator's existing stream recovery applies.
Source changes and close cancel adapter callbacks and release the presenter.
The engine owns the teardown of its workers and audio resources.

Stream selection uses the same playback session. Checks wait for presented
frames and an active audio path, rather than accepting metadata alone. Only
one GPU probe runs at a time. Its deadline includes queue time. Probes are
muted and removed on completion or cancellation. Native/Mux probes keep their
existing path on browsers without WebGPU and for playlists.

HLS and DASH URLs stay on the existing browser path. The WebGPU engine requires
fetchable direct files with byte-range support and suitable CORS responses.
It does not bypass CORS, authentication, custom request-header requirements,
or DRM. Unknown playlist URLs may be attempted and then fall back.

Native speculative video preloading is skipped for files that will use WebGPU.
This avoids downloading a buffer that the GPU engine cannot adopt. Playlist
preloading still reuses the existing Mux element and engine.

The video element keeps a layout box. The presenter draws a canvas over it and
reads its object-fit. External subtitle layers remain above this canvas.
Player glass samples the presented canvas, including its framing, without
starting another decoder. Paused frame callbacks sleep until playback or a
seek changes the picture.

## Current limits

- Codec and HDR tone-mapping support depend on the routes that the engine can
  qualify on the current device. This change does not enable HDR display output
  or claim HDR display accuracy.
- External SRT/VTT subtitles keep Navigator's appearance and timing settings.
  Matroska embedded SRT/UTF-8 and WebVTT captions are listed in the same menu.
  ASS/SSA tracks use a plain-text fallback. Track metadata uses bounded byte
  ranges, then cues come from the engine's subtitle-block events without a
  second video/cluster download. The caption index handles seeks, repeated
  clusters, overlaps, Off, and delayed metadata. It has fixed queue and text
  memory limits. Styling, fonts, PGS/image subtitles, and MP4 embedded subtitle
  extraction are not included. Embedded timing controls remain a follow-up.
- Picture in picture is disabled during WebGPU playback. The source-less video
  element cannot provide its picture to the browser's normal PiP API. A future
  integration can use the engine's `pictureStream` API.
- Shader controls, upscaling, background decoder warm-up, and GPU source
  prefetch are separate follow-ups. They need their own resource and UX checks.

## Verification

Run `npm run prepare:webgpu`, `npm run test:webgpu`, `npm run test:web-player`,
`npm run test:stream-selection`, `npm run test:episode-continuation`,
`npm run test:player-settings`, `npm run test:media-player-refs`, and
`npx tsc --noEmit --incremental false`.

The adapter tests use a controlled engine fixture. They check media commands,
audio language selection, video-only recovery, fallback state, stale opens,
timeouts, frame callback cleanup, probe serialization, the pinned runtime
adaptation, and byte-for-byte copies of the other assets. Subtitle checks cover
track headers, sparse range reads, text packet decoding, Off, overlapping cues,
backward seeks, repeated packets, and disposal. They do
not establish real-browser codec, visual, HDR, or performance results.

## References

- [WebGPU-Player embedding guide](https://github.com/alchemyyy/WebGPU-Player/blob/main/docs/src/embedding.md)
- [Supported formats](https://github.com/alchemyyy/WebGPU-Player/blob/main/docs/src/formats.md)
- [Eligibility and routes](https://github.com/alchemyyy/WebGPU-Player/blob/main/docs/src/routes.md)
- [Architecture and lifecycle](https://github.com/alchemyyy/WebGPU-Player/blob/main/docs/src/architecture.md)
- [Optional presentation passes](https://github.com/alchemyyy/WebGPU-Player/blob/main/docs/src/bundled-passes.md)

The original engine's main branch can differ from the pinned embedding package.
The integration uses the published package's `EmbeddedPlayer` API. The engine
has an MIT license. Some decoder packages have separate licenses. Their license
texts and corresponding-source links remain in the served runtime folder.
