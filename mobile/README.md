# Navigator Mobile

A separate Expo application for iPhone, iPad and Android. Navigator web and desktop stay on Next.js. This project owns its native screens and components; it will use the existing backend through HTTP APIs rather than import Next.js server actions or DOM components.

## Development

The first batch is a native design-system preview, not a streaming app yet. It includes Navigator's appearance, typography, buttons, text fields, switches, cards and floating material.

```sh
cd mobile
npm ci
npm run typecheck
npm test
npm run dev
```

Use the Expo SDK 56 development environment. NativeWind 4 and React Native Reusables are paired intentionally with the upstream minimal template. Future native playback will require a custom development build, not Expo Go. Do not prebuild or install native packages from the repository root.

Add more local components with `npx @react-native-reusables/cli@0.7.1 add <component>` from this directory. Do not overwrite an adapted component without reviewing its changes. The template was downloaded from [upstream revision ecdc14b](https://github.com/founded-labs/react-native-reusables-templates/tree/ecdc14b50fa9ad4d905085dc394cf783d48ad66d/minimal). Registry and template code is MIT licensed; see `REUSABLES-LICENSE`. The bundled Sunghyun Sans fonts are decoded copies of the web app's original WOFF2 assets, with the original license included.

## Tests

- `npm test` checks theme synchronization and platform interaction policy.
- `npm run typecheck` checks native TypeScript independently of Next.js.
- `npm exec expo install -- --check` checks the installed SDK dependency versions.
- [Expo mobile checks](../.github/workflows/mobile-expo.yml) uses standard GitHub-hosted runners, an Android emulator, and iPhone/iPad simulators. Maestro drives the installed native app and captures screenshots, test reports and diagnostic logs. The Android suite also tests increased text size. Artifacts stay in GitHub Actions for seven days. No signing, deployment, or desktop build runs in this workflow.
- Emulator and simulator results check interaction behavior and layouts. They do not establish actual tactile feedback, hardware HDR, device playback quality, or frame pacing.

See [MOBILE-ROADMAP.md](MOBILE-ROADMAP.md) for the batches and platform-specific visual work.
