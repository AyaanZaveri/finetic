# macOS app updates

Navigator uses Sparkle 2.10.1 for macOS updates. Sparkle verifies archives,
extracts full or delta packages, replaces Navigator, and relaunches it. The app's
user driver reports progress and waits for an explicit restart choice. The app
does not accept update URLs or file paths from JavaScript.

## User controls

Settings → About has a manual check button and an automatic-download switch.
When enabled, the native shell checks on launch and hourly. It downloads and
prepares eligible updates in the background. The header and Settings show
“Restart to update” when preparation is complete. A manual check also prepares
an update; a second action installs it and restarts the app.

Normal quit cancels a pending installation. If extraction has already started,
the event loop waits for the ready callback so it can cancel safely. It does
not install a prepared update just because the user closes the app.

Web shows the app version and GitHub release button. It shows no desktop
update message or native update controls.

Playback and the owned local server stop before Sparkle continues a relaunch.
Sparkle's `updaterWillRelaunchApplication:` callback then ends the native event
loop. The post-cleanup loop continues to accept Cmd-Q and window-close events;
it does not ignore quit requests while waiting for Sparkle. The update-available
indicator clears when installation starts.

The app keeps its bundle identifier and user-data location, so updates do not
replace sign-in data or settings.

## First installation

Versions through 0.5.2 have no Sparkle framework or macOS update key. Users must
manually install the first build with this feature. Later signed releases can
update that build through Sparkle. Install Navigator in Applications before
using in-app updates. Sparkle handles write permissions and app translocation.

Archive signatures do not replace Apple Developer ID signing or notarization.
The current app uses an ad hoc signature. Gatekeeper approval can still be
required for the first manual installation.

## Trust and packaging

`scripts/fetch-sparkle.mjs` pins the official SDK archive and framework hashes.
Packaging copies Sparkle to `Contents/Frameworks` with symlinks intact. It keeps
the framework's existing nested signatures and signs the outer app. The
framework license is included in the package.

The public key is in `desktop/macos/update-public-key.txt`. Its private key
stays in the login Keychain under account `app.navigator.desktop.sparkle`.
Never export it to the repository or release artifacts. Do not generate a new
key for each release. An ad hoc app cannot rely on Developer ID for key rotation.

The native updater checks the bundle's feed URL and public key before starting.
The feed is `updates/macos.xml` on GitHub main. The initial feed is empty until
the first signed macOS release is published.

## Release steps

1. Update package, Cargo and bundle versions together. Use the same release
   version and tag on both platforms.
2. Build through the manual `desktop-build.yml` GitHub Actions workflow on
   standard GitHub-hosted runners. Download the verified ZIP and any `.delta`
   artifacts. Keep the signing key out of CI and artifacts. Sign the immutable
   ZIP and deltas on the approved Mac using the command below.
3. Verify the package version, framework signatures, archive integrity and
   update signature. Run the basic update checks below.
4. Upload the immutable ZIP and signed appcast to that GitHub release. A DMG
   can also be offered for manual installation. Do not alter the ZIP after signing.
5. Verify the uploaded sizes and hashes, then publish the release.
6. Copy the generated appcast to `updates/macos.xml` and push it only after
   the archive's public download URL works. Never advertise a draft release.

To sign an existing release ZIP:

```sh
node scripts/macos-update-feed.mjs \
  dist/Navigator-X.Y.Z-macos-arm64.zip X.Y.Z release-vX.Y.Z \
  dist/Navigator-X.Y.Z-macos-arm64-appcast.xml \
  dist/Navigator-X.Y.Z-macos-arm64-from-A.B.C.delta
```

Omit the last argument when no delta was generated. Keep the full ZIP in the feed
for automatic fallback.

The tool checks the archive's bundle version, app identifier and public key.
It verifies the resulting signature against the public key before writing the
feed. It rejects a different platform, release tag, signing key or modified bytes.

Basic checks:

```sh
node scripts/test-app-updates.cjs
node scripts/test-macos-update-feed.mjs
node scripts/test-windows-update-feed.mjs
cargo check --manifest-path desktop/Cargo.toml --locked
rustc --edition 2024 --test desktop/src/macos_updater/status.rs -o /tmp/navigator-update-status-tests
/tmp/navigator-update-status-tests
```

The user performs hands-on update, relaunch and playback checks. No new release
is published as part of adding this integration.

## Sources

- [Sparkle setup and signing](https://sparkle-project.org/documentation/)
- [Updater delegate and relaunch callbacks](https://sparkle-project.org/documentation/api-reference/Protocols/SPUUpdaterDelegate.html)
- [Sparkle 2.10.1](https://github.com/sparkle-project/Sparkle/releases/tag/2.10.1)
