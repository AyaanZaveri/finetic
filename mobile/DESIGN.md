# Navigator Mobile design and scope

Navigator Mobile is a separate Expo app. It shares the product identity and backend services with Navigator web and desktop. It does not replace those clients or their interfaces.

## Current goal

Build a native iOS and Android browsing and playback experience, with source-owned React Native Reusables components. Implement the mobile web design as a visual reference, not as a WebView. Prioritize the centered Home hero and media cards, native navigation and sheets, title details, library and playback.

Do not implement Ask Navigator, scene-assistant cards, AI provider setup or chat in this phase. Leave the vibrant-color extraction, persistent Aurora and decorative gradient background out. Use the existing neutral Navigator light/dark palette and Sunghyun Sans. Gradients for artwork legibility and progressive blur masks are still in scope.

## Home

- Full-bleed hero artwork with centered title wordmark (or centered text fallback), rating, year, genres and a striking white primary action. The white View button has a trailing arrow-right icon and opens the title page. Playback is not implemented yet.
- Progressive blur in the lower image area: several independently blurred versions of the same artwork, each with a gradient mask and a larger radius toward the bottom. This avoids private system filters and blurring unrelated UI. Fade into the theme background below the centered content. Preserve readable text and the original artwork aspect ratio.
- Native horizontal rails of 2:3 posters, rounded corners, one or two readable title lines, and muted year or release metadata. Use cached Expo Image artwork, fallback for failed images and subtle press scale instead of hover. Include Continue Watching only after account data is available.
- Use a real, explicit backend data contract for public TMDB catalogs. If the hosted service is unavailable or has no token, use Cinemeta's public catalog endpoints. Keep provider credentials on the server; never embed a shared TMDB key in Expo.
- Full movie and TV details are separate native stack pages. They include a native-style back action, poster, summary, facts, cast and seasons when available. Use sheets only for contextual actions such as a poster long press. Use Gorhom Bottom Sheet with Gesture Handler and Reanimated, plain legible theme surfaces and an optional public-API blur background on supported devices. Use iOS native glass only for compact floating controls.

## Native navigation

- iOS uses Expo Router’s standard native `Stack` with default interactive back gestures. Android uses the SDK 56 `ExperimentalStack` prototype, the documented native gamma stack with predictive back support. The manifest opts into predictive back on Android 13 and later. No WebView or custom JavaScript back-swipe handler is used.
- The Android experimental stack is an alpha API. It does not support stack-based sheets or custom navigation bar options, so use the separate Gorhom action sheet. Verify native Android gesture navigation and committed edge back in standalone CI; Expo Go does not apply the app’s Android manifest. Keep the experimental stack under review as Expo upgrades.
- References: [Expo Router Stack](https://docs.expo.dev/router/advanced/stack/), [SDK 56 ExperimentalStack](https://docs.expo.dev/versions/v56.0.0/sdk/router/experimental-stack/), [Android predictive back](https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture).

## Iteration and verification

Keep the component preview accessible at `/design-system`. Use Expo Fast Refresh on a compatible connected phone when available for rapid edits. Fast CI uses the prebuilt Expo Go SDK 56 runtime with Metro; native CI builds are the more complete check. CI builds the native app on GitHub-hosted runners and captures actual iPhone, iPad and Android screenshots, including the hero, rails, sheet, light/dark modes and increased Android text size. Test deterministic fixtures separately from live network requests. Keep screenshots as GitHub artifacts and share selected PNG files with the user for visual review. Compare native screenshots against the existing web design and check real interaction on devices where hardware behavior matters.

The following work remains deliberately out of scope: Ask Navigator, vibrant color extraction, Aurora, decorative gradient backgrounds, physical-device HDR tuning, and a web or desktop redesign.
