# Native playback implementation and test plan

## First playback batch

Playback lab in Settings opens synthetic local clips or a user-supplied HTTPS video URL. It does not resolve catalog titles, add-ons, credentials or watch history. Those require the account and stream selection integration.

The SDK 56-compatible `expo-video` 56.1.4 dependency supplies:

- Android: AndroidX Media3 ExoPlayer 1.9.0, with Media3 HLS, DASH and OkHttp data sources. The visible view uses SurfaceView instead of a composited texture. A player is released on unmount by the Expo hook.
- iOS: AVFoundation AVPlayer. This is a comparison baseline, not a decision to replace VLC or AetherEngine for broad container and codec support.

The lab reports the first rendered-frame event, native duration and clock updates, play/pause state, seek position, extraction errors and displayed preview images. It pauses on background and releases the source session on navigation away. Local test clips loop until paused so automation does not depend on simulator speed. A cached development client without the native video module reports the need to rebuild.

References:

- [Expo Video SDK 56](https://docs.expo.dev/versions/v56.0.0/sdk/video/)
- [Expo Video upstream code](https://github.com/expo/expo/tree/main/packages/expo-video)
- [Expo Asset SDK 56](https://docs.expo.dev/versions/v56.0.0/sdk/asset/)
- [Media3 getting started](https://developer.android.com/media/media3/exoplayer/hello-world)
- [Media3 supported formats](https://developer.android.com/media/media3/exoplayer/supported-formats)
- [Media3 surface selection](https://developer.android.com/media/media3/ui/playerview#surfacetype)
- [Expo development builds](https://docs.expo.dev/develop/development-builds/use-development-builds/)

## AetherEngine on iOS

The desktop adapter pins 7.76.0 in [Package.swift](../../desktop/macos/aether/Package.swift). Reuse that research and pin for mobile evaluation. The upstream requirements are iOS 18 or later and Xcode 27 / Swift 6.4; Xcode 26.3 compatibility is best-effort. This is stricter than Expo's baseline deployment support. AetherEngine exposes a UIKit `AetherPlayerView`, a reusable engine with `bind(view:)`, asynchronous loading and seeking, Combine state, native and software video routes, media chapters and thumbnail APIs. It remuxes compatible files to local HLS for AVPlayer and uses its own decode path for other files. The format table includes MKV, WebM, H.264, HEVC, AV1 and multiple audio formats. The documentation is not evidence that those work on a specific device.

Use an owned [Expo Modules API native view](https://docs.expo.dev/modules/native-view-tutorial/) to bind the engine and report session-scoped transport, tracks, chapters and preview results. The generated iOS project needs reproducible SPM package and product linkage, deployment-target handling, dynamic FFmpeg dependency embedding, simulator/device build verification and exact source/license notices. Do not enable patented optional traits by default. Evaluate the LGPL-3 App Store exception and dependent license requirements before distribution. Keep a distinct AVPlayer baseline and Aether adapter, so the same tests can measure both engines without changing catalog or UI code.

Primary sources at the pinned revision:

- [Installation and toolchain requirements](https://github.com/superuser404notfound/AetherEngine/blob/7.76.0/docs/installation.md)
- [UIKit host guide and state](https://github.com/superuser404notfound/AetherEngine/blob/7.76.0/docs/guide.md)
- [API reference, including previews and chapters](https://github.com/superuser404notfound/AetherEngine/blob/7.76.0/docs/api.md)
- [Container/codec support](https://github.com/superuser404notfound/AetherEngine/blob/7.76.0/docs/formats.md)
- [License and redistribution](https://github.com/superuser404notfound/AetherEngine/blob/7.76.0/docs/licensing.md)

## Preview and chapter-image path

One pipeline per source uses the native `generateThumbnailsAsync` API and keeps the visible playback clock unchanged. Android uses MediaMetadataRetriever and iOS uses AVAssetImageGenerator in Expo Video 56.1.4. Resolve bundled assets to local cache file URIs before extraction. Use a 320 × 180 maximum output size, one extraction at a time, one-second scrub buckets, exact millisecond chapter times, shared requests and a bounded LRU (24 entries / 8 MiB estimated decoded bytes). Render native SharedRef images directly with Expo Image, not base64 strings or JavaScript pixel buffers. Chapter requests run behind interactive requests; the lab loads at most eight. Source replacement disposes pending requests and ignores late native outputs. Native extraction itself is not cancellable through this API.

This is the first version of the desktop-style preview pipeline. It does not yet preserve a persistent demuxer/decoder, use keyframe range aliases, prefetch adjacent frames, or extract arbitrary container chapter metadata. The chapter fixture has known embedded chapters and matching sidecar timestamps. Expo Video exposes no chapter enumeration in its SDK 56 API. A future engine adapter must enumerate chapters from the media and supply those timestamps. Measure cold/warm extraction time, peak memory, playback frame pacing and network reads before selecting a production preview strategy.

- [Expo native thumbnails](https://docs.expo.dev/versions/v56.0.0/sdk/video/#generatethumbnailsasynctimes-options)
- [Android MediaMetadataRetriever](https://developer.android.com/reference/android/media/MediaMetadataRetriever)
- [Apple AVAssetImageGenerator](https://developer.apple.com/documentation/avfoundation/avassetimagegenerator)
- [Existing desktop preview session/cache](../../lib/desktop/mpv-controller.ts)
- [Existing desktop thumbnail worker](../../desktop/src/thumbnails.rs)

## Test coverage

Use FFmpeg-generated local video and audio to remove catalog/network dependencies. The fixtures include MP4 H.264/AAC, MKV H.264/AAC, WebM VP9/Opus, MP4 HEVC/AAC and an MP4 with three embedded chapters. The native CI test checks first frame, advancing native clock, duration, pause/resume, seek, a displayed preview and displayed chapter images. Codec capability failures on baseline platforms belong in the compatibility results, not in the successful playback count.

The tests do not establish physical device HDR or Dolby Vision, audio quality, HDMI passthrough, thermal performance, exact frame-accurate seeking, chapter extraction from unknown files, or authenticated stream handling. Follow up with physical iPhone/iPad and Android devices, HLS/DASH, multiple audio and subtitle tracks, HTTP range sources, stream interruption, audio focus, orientation changes and long-form media.
