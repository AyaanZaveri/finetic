# Native mobile implementation roadmap

See [DESIGN.md](DESIGN.md) for the current scope and Home design.

## Architecture

Keep `app/`, `components/`, `desktop/`, `ios/` and `android/` as the existing product. New native screens live in `mobile/app/` with local React Native Reusables components. Do not copy server-only modules, Next.js server actions, WebView bridge calls, browser storage, or DOM rendering into the native bundle. Share type definitions and pure TypeScript logic through explicitly portable modules only. Keep signing, keys and backend credentials outside the mobile application.

## Batches

| Batch | Scope | Status |
|---|---|---|
| 1 | SDK and router, themes, fonts, locally owned components, haptics and native glass surface, component preview | Implemented, device verification pending |
| 2 | Artwork image, progressive blur, media cards, native tabs and navigation shell | Implemented, device verification pending |
| 3 | Public Cinemeta API client, Home hero and catalog rails; Continue Watching after account integration | Core Home implemented, remaining account features pending |
| 4 | Movie and series detail routes, search, episodes, seasons and people | Movie/series and episode pages, title search, season picker and episode rail implemented |
| 5 | Session and secure storage, library, watch history and add-ons | Direct Stremio sign-in, secure session storage and installed add-on discovery implemented. Library and watch history are pending. |
| 6 | Settings categories and provider connections | Pending |
| 7 | Native playback adapters, player chrome and lifecycle | Catalog stream picker opens direct HTTPS streams in ExoPlayer or AVPlayer. Opt-in AetherEngine lab and native fixture tests remain available. Physical device verification is pending. |
| 8 | End-to-end feature parity, screenshots on device classes, accessibility and physical device validation | Pending |

Every batch preserves the existing clients. Add focused tests and screenshots to the mobile CI suite as features arrive. Use real Cinemeta data in device previews and isolated mock responses in unit tests. Do not consider a batch device-verified until its tests have run on both platforms.

## Current execution priorities

Run the independent workstreams in parallel. The parent agent owns the shared
design contract, integration and final native device verification. Inherit the
parent model by default. Use a smaller model for a specific narrow task, not
for variety.

| Priority | Workstream | Deliverable and acceptance |
|---|---|---|
| P0 | Native visual and interaction QA | Standalone Android, iPhone and iPad screenshots from the same source revision, with live Cinemeta data. Keep the Android predictive-back test, dark/light screenshots, gesture recordings, and reliable emulator recovery. |
| P1 | Interaction and haptics | Finger-linked hero crossfade, circular dots, single native selection tick per committed snap, persistent haptics setting, and tactile poster press-to-native-page handoff. No vibration on canceled gestures. |
| P1 | Adaptive tablet layout | iPad and Android tablet layouts use sensible rail density, spacing and readable detail widths. Test portrait, landscape and compact phone layouts. |
| P1 | Search | Match the web mobile design, use native keyboard controls, adaptive results, filters, loading, retry and empty states, and native title navigation. |
| P2 | Metadata and episodes | Show release dates, ratings and certifications when Cinemeta supplies them. Keep season selection, the episode thumbnail rail and the focus ring. |
| P3 | Account and library | Native settings categories, library, likes, watch history and add-on configuration. Replace local-only like state with account-backed state when ready. |
| P4 | Playback | Verify Stremio sign-in and direct add-on stream playback on physical devices. |
| P5 | Final parity | Accessibility, responsiveness, device-specific animation feel, stability and release readiness. |

Keep the work batch-sized. Do not start Ask Navigator, decorative color
extraction, Aurora, or a web or desktop redesign. Do not treat simulated
haptics, playback, HDR or frame pacing as hardware verification.

## Visual and native translation inventory

| Existing implementation | Mobile direction and verification |
|---|---|
| `DESIGN.md`, `app/globals.css`, Arc tokens | NativeWind and source-owned Reusables. Use sRGB HSL equivalents of the existing OKLCH palette, not a generic theme. Check dark and light appearance, readable contrast, and text scaling. |
| Sunghyun Sans | Bundle original font shapes as native OTF weights. Use the shared `Text` and `Input`. |
| Button, Input, Switch, ChipGroup, SegmentedControl, Select, sliders and ruler | Reusables primitives and local adaptations. Use native text input, minimum touch targets, platform-specific press scaling and selection haptics. Prefer native controls for system pickers. Validate disabled, loading, selected and error states. |
| Header, account drawer, menus and dialog surfaces | Native stack, safe areas, native modal/sheet and a small owned glass surface. System Liquid Glass on supported iOS versions; solid fallback under Reduce Transparency or on unsupported devices. Use Expo Blur for ordinary backdrop materials after checking the correct Android blur target. |
| Progressive blur (`components/motion-primitives/progressive-blur.tsx`) | Four to six masked, differently blurred layers in the web code. For known hero artwork, stack differently blurred Expo Image layers with gradient masks (no private API). Skia is an alternative if device testing shows a performance problem. For live scrolling content prototype gradient-masked Expo Blur layers with capability/fallback checks. Android 12+ GPU blur can be evaluated separately. Do not call a gradient overlay a true variable blur. |
| Aurora, LightRays, dot field | Deferred by request. Use a neutral background. |
| Artwork palette worker and adaptive logo | Vibrant color extraction deferred. Keep text and icon contrast with controlled scrims. |
| Hero/poster reveal, episode still upgrades | Expo Image caching and transitions. Preserve 300ms artwork reveal and 150ms still upgrade where appropriate; avoid repeated fades on cache hits. |
| Horizontal catalog rails, hero slide controls | Native scroll and list virtualization. Gesture Handler and Reanimated for snap/transition effects when necessary. Preserve content and safe-area layouts on compact and tablet screens. |
| Web Framer Motion and hover feedback | Reanimated (transform/opacity), Gesture Handler, native navigation. Convert hover to touch feedback; remove desktop-only behaviors. Honor Reduced Motion. |
| Expandable search, keyboard and chat composer | Native TextInput, keyboard insets, native scrolling, focus and accessible labels. Preserve search debounce and query semantics. |
| Browser storage, auth and TanStack Query | Use native secure storage for the Stremio session key, ordinary storage for settings, and TanStack Query for metadata. Sign in and load add-ons directly from Stremio. Sign out clears the stored key. |
| Media player and native bridge | Use Expo Video as the initial Media3 ExoPlayer (Android) and AVPlayer (iOS) comparison baseline. Evaluate AetherEngine on iOS through an owned Expo native module. Preserve session-scoped commands, secure headers, track selection, resume, state relay, PiP capability flags, audio focus and lifecycle for production playback. See [native playback research and tests](docs/playback.md). |
| Timeline, seek previews, brightness and volume gestures | Reuse independent native preview workers and gesture logic. Use UI-thread animation for drag, commit once, preserve haptic detents and disable work when backgrounded. |
| Subtitles, delay, skip segments, next episode | Retain parsing, timing, playback reporting and continuation logic where platform-independent; bridge native engine capabilities and adapt overlay rendering. |
| HDR and glass over playback | Keep native video surfaces and avoid sampling or recompositing the playing video for cosmetic effects. Evaluate device-specific overlays separately; simulator screenshots cannot prove HDR presentation. |
| Ask Navigator messages and structured results | Explicitly out of scope for this mobile version. |

## Research decisions

- [Expo Glass Effect (SDK 56)](https://docs.expo.dev/versions/v56.0.0/sdk/glass-effect/) exposes `GlassView`, native availability checks and a supported iOS glass API. The batch 1 wrapper uses these and checks Reduce Transparency.
- [Expo Blur (SDK 56)](https://docs.expo.dev/versions/v56.0.0/sdk/blur-view/) supports Android blur targets. It is a uniform blur, not a variable-radius filter.
- [@sbaiahmed1/react-native-blur](https://github.com/sbaiahmed1/react-native-blur) offers a progressive blur component. Its [documented iOS implementation](https://github.com/sbaiahmed1/react-native-blur/blob/main/website/src/content/docs/progressive-blur-view.mdx) uses private Core Animation filters; its Android fallback uses a gradient mask. Do not adopt it as the default cross-platform implementation. Evaluate the owned layered/masked approach first. [Beautiful Expo](https://github.com/davidmokos/beautiful-expo/blob/main/registry/default/progressive-blur/progressive-blur.tsx) is a useful source-owned reference for layered public-API progressive blur. Its backdrop implementation requires Expo Blur targets on Android. For the hero, the artwork is known, so masked image copies avoid sampling live views. [Skia](https://shopify.github.io/react-native-skia/) can also render blur and masks if needed.
- [Libraries.dev](https://libraries.dev/) currently focuses on React AI-oriented effects and has no progressive-blur React Native registry component in its published index. Keep it in consideration for future suitable effects only.
- [Expo Haptics](https://docs.expo.dev/versions/v56.0.0/sdk/haptics/) provides selection/impact on iOS and system haptic actions on Android. Test the dispatch policy automatically; feel and vibration require physical hardware.
- [Expo Modules API](https://docs.expo.dev/modules/overview/) supports local Swift and Kotlin native views/modules, which is the intended bridge for the existing playback engines.
- Mobile uses Cinemeta and Stremio directly instead of the Navigator server.
