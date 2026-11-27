# Native mobile implementation roadmap

## Architecture

Keep `app/`, `components/`, `desktop/`, `ios/` and `android/` as the existing product. New native screens live in `mobile/app/` with local React Native Reusables components. Do not copy server-only modules, Next.js server actions, WebView bridge calls, browser storage, or DOM rendering into the native bundle. Share type definitions and pure TypeScript logic through explicitly portable modules only. Keep signing, keys and backend credentials outside the mobile application.

## Batches

| Batch | Scope | Status |
|---|---|---|
| 1 | SDK and router, themes, fonts, locally owned components, haptics and native glass surface, component preview | Implemented, device verification pending |
| 2 | Artwork and native effects library, navigation shell, loading states and catalog cards | Pending |
| 3 | API client, Home hero, catalog rails and Continue Watching | Pending |
| 4 | Search, movie, series, episodes, seasons and people | Pending |
| 5 | Session and secure storage, library, watch history and addons | Pending |
| 6 | Settings categories and provider connections | Pending |
| 7 | Native playback adapters, player chrome and lifecycle | Pending |
| 8 | Ask Navigator, structured cards, scene and subtitle workflows | Pending |
| 9 | End-to-end feature parity, screenshots on device classes, accessibility and physical device validation | Pending |

Every batch preserves the existing clients. Add focused tests and screenshots to the mobile CI suite as features arrive. Keep fixtures deterministic and leave live-service checks separate. Do not consider a batch device-verified until its tests have run on both platforms.

## Visual and native translation inventory

| Existing implementation | Mobile direction and verification |
|---|---|
| `DESIGN.md`, `app/globals.css`, Arc tokens | NativeWind and source-owned Reusables. Use sRGB HSL equivalents of the existing OKLCH palette, not a generic theme. Check dark and light appearance, readable contrast, and text scaling. |
| Sunghyun Sans | Bundle original font shapes as native OTF weights. Use the shared `Text` and `Input`. |
| Button, Input, Switch, ChipGroup, SegmentedControl, Select, sliders and ruler | Reusables primitives and local adaptations. Use native text input, minimum touch targets, platform-specific press scaling and selection haptics. Prefer native controls for system pickers. Validate disabled, loading, selected and error states. |
| Header, account drawer, menus and dialog surfaces | Native stack, safe areas, native modal/sheet and a small owned glass surface. System Liquid Glass on supported iOS versions; solid fallback under Reduce Transparency or on unsupported devices. Use Expo Blur for ordinary backdrop materials after checking the correct Android blur target. |
| Progressive blur (`components/motion-primitives/progressive-blur.tsx`) | Four to six masked, differently blurred layers in the web code. For known hero artwork, implement a Skia image blur ramp (no private API). For live scrolling content prototype gradient-masked Expo Blur layers with capability/fallback checks. Android 12+ GPU blur can be evaluated separately. Do not call a gradient overlay a true variable blur. |
| Aurora, LightRays, dot field | Translate WebGL shader math to Skia RuntimeEffect where useful; prefer static gradients for low-value or reduced-motion contexts. Reuse palette-selection and interpolation math rather than the Canvas/DOM rendering. |
| Artwork palette worker and adaptive logo | Native image palette extraction; reuse palette selection, contrast and luminance math with a latest-result guard. Verify contrast across different artwork. |
| Hero/poster reveal, episode still upgrades | Expo Image caching and transitions. Preserve 300ms artwork reveal and 150ms still upgrade where appropriate; avoid repeated fades on cache hits. |
| Horizontal catalog rails, hero slide controls | Native scroll and list virtualization. Gesture Handler and Reanimated for snap/transition effects when necessary. Preserve content and safe-area layouts on compact and tablet screens. |
| Web Framer Motion and hover feedback | Reanimated (transform/opacity), Gesture Handler, native navigation. Convert hover to touch feedback; remove desktop-only behaviors. Honor Reduced Motion. |
| Expandable search, keyboard and chat composer | Native TextInput, keyboard insets, native scrolling, focus and accessible labels. Preserve search debounce and query semantics. |
| Browser storage, auth and TanStack Query | Native secure storage for credentials, ordinary persisted storage for settings, TanStack Query for data. Replace relative fetch and server actions with explicit HTTP contracts. Check signin/session, logout, account isolation, and the hosted API's challenge behavior; do not bypass bot protection. |
| Media player and native bridge | Reuse ExoPlayer on Android and VLC on iOS via Expo Modules API. Preserve session-scoped commands, secure header transport, track selection, exact resume, state relay, PiP capability flags, audio focus and lifecycle. Do not replace the existing engines with generic Expo video without validating format and feature coverage. |
| Timeline, seek previews, brightness and volume gestures | Reuse independent native preview workers and gesture logic. Use UI-thread animation for drag, commit once, preserve haptic detents and disable work when backgrounded. |
| Subtitles, delay, skip segments, next episode | Retain parsing, timing, playback reporting and continuation logic where platform-independent; bridge native engine capabilities and adapt overlay rendering. |
| HDR and glass over playback | Keep native video surfaces and avoid sampling or recompositing the playing video for cosmetic effects. Evaluate device-specific overlays separately; simulator screenshots cannot prove HDR presentation. |
| Ask Navigator messages and structured results | Existing backend tools, prompts and schemas. Native transcript, cards, rich text, scene jump and playback controls. Check stream transport and cancellation on React Native. |

## Research decisions

- [Expo Glass Effect (SDK 56)](https://docs.expo.dev/versions/v56.0.0/sdk/glass-effect/) exposes `GlassView`, native availability checks and a supported iOS glass API. The batch 1 wrapper uses these and checks Reduce Transparency.
- [Expo Blur (SDK 56)](https://docs.expo.dev/versions/v56.0.0/sdk/blur-view/) supports Android blur targets. It is a uniform blur, not a variable-radius filter.
- [@sbaiahmed1/react-native-blur](https://github.com/sbaiahmed1/react-native-blur) offers a progressive blur component. Its [documented iOS implementation](https://github.com/sbaiahmed1/react-native-blur/blob/main/website/src/content/docs/progressive-blur-view.mdx) uses private Core Animation filters; its Android fallback uses a gradient mask. Do not adopt it as the default cross-platform implementation. Evaluate the owned layered/masked approach first. For known artwork, [Skia](https://shopify.github.io/react-native-skia/) can render blur and masks without sampling the live view hierarchy.
- [Expo Haptics](https://docs.expo.dev/versions/v56.0.0/sdk/haptics/) provides selection/impact on iOS and system haptic actions on Android. Test the dispatch policy automatically; feel and vibration require physical hardware.
- [Expo Modules API](https://docs.expo.dev/modules/overview/) supports local Swift and Kotlin native views/modules, which is the intended bridge for the existing playback engines.
- The hosted discovery API returned a Vercel challenge for a direct unauthenticated HTTP check on 2026-11-27. This must be resolved as part of the mobile API work with an authorized backend configuration, not circumvented in the client.
