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

The lab can switch between AVPlayer and AetherEngine in an iOS development client built with `NAVIGATOR_IOS_AETHER=1`. Generate the iOS project with that environment variable in a clean checkout, then build the custom development client with Xcode 27. The opt-in client requires iOS 18 or later. The normal iOS and Android builds keep the Expo Video baseline.

The [Expo inline module](https://docs.expo.dev/modules/inline-modules-reference/) hosts AetherEngine’s UIKit player view and passes first-frame, native seek landing, clock, and chapter data to the shared lab controls. It stops the engine when the view leaves the window. Chapter times come from the source metadata. The build plugin links the same exact AetherEngine version as the desktop adapter, 7.76.0, with the default package traits. The hosted iOS job checks that the app embeds the dynamic FFmpeg frameworks. Review upstream redistribution requirements before shipping an Aether-enabled build.

Primary sources at the pinned revision:

- [Installation and toolchain requirements](https://github.com/superuser404notfound/AetherEngine/blob/7.76.0/docs/installation.md)
- [UIKit host guide and state](https://github.com/superuser404notfound/AetherEngine/blob/7.76.0/docs/guide.md)
- [API reference, including previews and chapters](https://github.com/superuser404notfound/AetherEngine/blob/7.76.0/docs/api.md)
- [Container/codec support](https://github.com/superuser404notfound/AetherEngine/blob/7.76.0/docs/formats.md)
- [License and redistribution](https://github.com/superuser404notfound/AetherEngine/blob/7.76.0/docs/licensing.md)

## Preview and chapter-image path

One pipeline per source keeps the visible playback clock unchanged. Expo Video 56.1.4 uses MediaMetadataRetriever on Android and AVAssetImageGenerator on iOS. AetherEngine uses a frame extractor for bundled files and the active playback cache for remote previews. All three paths send native image references directly to Expo Image. The lab limits images to 320 × 180, serializes extraction, shares duplicate requests and uses a 24-entry cache with an 8 MiB decoded-size budget. Scrub requests use one-second buckets and have priority over the eight available chapter slots. Source replacement disposes pending requests and ignores late results.

Expo Video uses the known fixture timestamps for the chapter test. AetherEngine reads the embedded chapter names and timestamps. The lab displays the elapsed time between the first preview request and image display, then repeats that measurement for a cache hit. The measurement includes UI work and provides a sample for the current runner.

- [Expo native thumbnails](https://docs.expo.dev/versions/v56.0.0/sdk/video/#generatethumbnailsasynctimes-options)
- [Android MediaMetadataRetriever](https://developer.android.com/reference/android/media/MediaMetadataRetriever)
- [Apple AVAssetImageGenerator](https://developer.apple.com/documentation/avfoundation/avassetimagegenerator)
- [Existing desktop preview session/cache](../../lib/desktop/mpv-controller.ts)
- [Existing desktop thumbnail worker](../../desktop/src/thumbnails.rs)

## Test coverage

The fixture job fully decodes the synthetic audio and video and verifies the test chapters. The native matrix checks each engine’s first frame, advancing clock, duration, pause/resume, seek and rendered preview. AetherEngine also checks embedded chapter discovery.

The tests do not establish physical device HDR or Dolby Vision, audio quality, HDMI passthrough, thermal performance, exact frame-accurate seeking, chapter extraction from unknown files, or authenticated stream handling. Follow up with physical iPhone/iPad and Android devices, HLS/DASH, multiple audio and subtitle tracks, HTTP range sources, stream interruption, audio focus, orientation changes and long-form media.
