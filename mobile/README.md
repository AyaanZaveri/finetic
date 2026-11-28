# Navigator Mobile

A separate Expo application for iPhone, iPad and Android. Navigator web and desktop stay on Next.js. This project owns its native screens and components; it will use the existing backend through HTTP APIs rather than import Next.js server actions or DOM components.

## Development

Home now loads guest discovery catalogs, renders the centered progressive-blur hero and media cards, and opens separate native movie and series details routes. Home, Search and Settings use native bottom tabs. On iOS 26 the tab bar uses system Liquid Glass. Movie and TV pages match the artwork-led web phone layout. Account playback and authentication are not implemented yet. A native playback lab in Settings tests local media and direct HTTPS videos. The design-system preview is accessible from Settings.

```sh
cd mobile
npm ci
npm run typecheck
npm test
npm run dev
```

Use the Expo SDK 56 development environment. Fast Refresh avoids rebuilding the native application for JavaScript-only changes. NativeWind 4 and React Native Reusables are paired intentionally with the upstream minimal template. The playback lab uses native Expo Video and requires an updated custom development build. Do not prebuild or install native packages from the repository root.

Add more local components with `npx @react-native-reusables/cli@0.7.1 add <component>` from this directory. Do not overwrite an adapted component without reviewing its changes. The template was downloaded from [upstream revision ecdc14b](https://github.com/founded-labs/react-native-reusables-templates/tree/ecdc14b50fa9ad4d905085dc394cf783d48ad66d/minimal). Registry and template code is MIT licensed; see `REUSABLES-LICENSE`. The bundled Sunghyun Sans fonts are decoded copies of the web app's original WOFF2 assets, with the original license included.

## Fast native UI iteration

Use Navigator's custom Expo development client, not Expo Go. It includes the
native modules needed for the app. On a device with the client installed,
`npm run dev:client` serves current JavaScript through Metro and enables Fast
Refresh. Rebuild the client when its native fingerprint changes.

[Expo mobile visual previews](../.github/workflows/mobile-development.yml)
runs automatically for mobile changes on development branches. Its first run
builds Android and iPhone development clients. It stores the native APK and
simulator app archive in GitHub Actions artifacts keyed by platform-specific
Expo Fingerprint and native toolchain compatibility. Subsequent runs restore the
matching native client and connect it to Metro using that run's current source.
No native compilation is needed on a verified cache hit. The walkthroughs
capture native H.264 videos and screenshots after the actual Home UI renders.
The cache expires after 30 days; a miss rebuilds the client. Cached binaries
are only restored from the same trusted workflow, repository and branch.

Use the [standalone release checks](../.github/workflows/mobile-expo.yml) for
final verification. They run on mobile changes merged to main or when
manually dispatched. They check release builds on Android, iPhone and iPad.
Development-client recordings are useful for visual iteration, but do not
establish release animation performance or physical haptic feel.

References: [Expo development builds](https://docs.expo.dev/develop/development-builds/use-development-builds/),
[SDK 56 DevClient](https://docs.expo.dev/versions/v56.0.0/sdk/dev-client/),
[Expo Fingerprint](https://docs.expo.dev/versions/v56.0.0/sdk/fingerprint/).

## Tests

- `npm test` checks theme synchronization and platform interaction policy.
- `npm run typecheck` checks native TypeScript independently of Next.js.
- `npm exec expo install -- --check` checks the installed SDK dependency versions.
- [Expo mobile checks](../.github/workflows/mobile-expo.yml) uses standard GitHub-hosted runners to compile and install the standalone app on Android, iPhone and iPad simulators. Actual screenshots use ADB and simctl before the Maestro interaction suite. CI uses live Cinemeta data, not fixture media. The Android suite tests increased text size and a system edge-back gesture. The native predictive stack is experimental in SDK 56. Artifacts stay in GitHub Actions for seven days. No signing, deployment or desktop build runs in this workflow.
- Emulator and simulator results check interaction behavior and layouts. They do not establish actual tactile feedback, hardware HDR, device playback quality, or frame pacing.

Home, Search and title details use live public Cinemeta endpoints. Missing metadata is omitted. Play opens the stream selector. Sign-in and the installed add-on list use Stremio directly, and stream requests go directly to those add-ons. The app stores the Stremio session key in SecureStore and never sends it to add-ons. No Navigator server, provider key or sample catalog is required.

Existing development clients from before SecureStore was added need one native rebuild. Later JavaScript-only changes can reuse the matching client.

See [DESIGN.md](DESIGN.md) for current scope and [MOBILE-ROADMAP.md](MOBILE-ROADMAP.md) for the batches and platform-specific visual work.

See [Native playback implementation and test plan](docs/playback.md) for engine research, codec fixtures, preview cache behavior and native CI scope.
