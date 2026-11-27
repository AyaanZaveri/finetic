# Navigator Mobile

A separate Expo application for iPhone, iPad and Android. Navigator web and desktop stay on Next.js. This project owns its native screens and components; it will use the existing backend through HTTP APIs rather than import Next.js server actions or DOM components.

## Development

Home now loads guest discovery catalogs, renders the centered progressive-blur hero and media cards, and opens separate native movie and series details routes. Home, Search and Settings use native bottom tabs. On iOS 26 the tab bar uses system Liquid Glass. Movie and TV pages match the artwork-led web phone layout. Playback and authentication are not implemented yet. The design-system preview is accessible from Settings.

```sh
cd mobile
npm ci
npm run typecheck
npm test
npm run dev
```

Use the Expo SDK 56 development environment. Fast Refresh avoids rebuilding the native application for JavaScript-only changes. NativeWind 4 and React Native Reusables are paired intentionally with the upstream minimal template. Future native playback will require a custom development build, not Expo Go. Do not prebuild or install native packages from the repository root.

Add more local components with `npx @react-native-reusables/cli@0.7.1 add <component>` from this directory. Do not overwrite an adapted component without reviewing its changes. The template was downloaded from [upstream revision ecdc14b](https://github.com/founded-labs/react-native-reusables-templates/tree/ecdc14b50fa9ad4d905085dc394cf783d48ad66d/minimal). Registry and template code is MIT licensed; see `REUSABLES-LICENSE`. The bundled Sunghyun Sans fonts are decoded copies of the web app's original WOFF2 assets, with the original license included.

## Tests

- `npm test` checks theme synchronization and platform interaction policy.
- `npm run typecheck` checks native TypeScript independently of Next.js.
- `npm exec expo install -- --check` checks the installed SDK dependency versions.
- [Expo mobile checks](../.github/workflows/mobile-expo.yml) uses standard GitHub-hosted runners to compile and install the standalone app on Android, iPhone and iPad simulators. Actual screenshots use ADB and simctl before the Maestro interaction suite. CI uses live Cinemeta data, not fixture media. The Android suite tests increased text size and a system edge-back gesture. The native predictive stack is experimental in SDK 56. Artifacts stay in GitHub Actions for seven days. No signing, deployment or desktop build runs in this workflow.
- Emulator and simulator results check interaction behavior and layouts. They do not establish actual tactile feedback, hardware HDR, device playback quality, or frame pacing.

Home, Search and title details default to live public Cinemeta endpoints. Select TMDB in Settings to use the Navigator metadata service. Set `EXPO_PUBLIC_NAVIGATOR_API_ORIGIN` to an authorized HTTPS deployment if needed. No provider key or sample catalog is embedded in the app.

See [DESIGN.md](DESIGN.md) for current scope and [MOBILE-ROADMAP.md](MOBILE-ROADMAP.md) for the batches and platform-specific visual work.
