# Windows in-app updates

Navigator downloads signed updates in the background. In Settings → About,
you can turn automatic downloads off or check manually. When Navigator has
verified the download, **Update ready** in the header and **Review update** in
Settings open the same dialog. It shows notes from the matching GitHub release.
Choose **Restart to update** in the dialog to install the prepared update.
**What’s new** in About opens the installed version’s notes.
Closing the app normally does not install a pending update.

The background helper runs outside the installation folder. It tells Navigator
to close through its normal shutdown path. NSIS waits for the old process,
builds a staging directory, verifies startup, activates the new files, and
reopens Navigator. The delta worker runs without a visible console. When the
delta base cannot be rebuilt, the helper tries the signed full installer.
The helper reopens the retained installation after an installation failure
and reports that failure in About. Its log is under
`%LOCALAPPDATA%\Navigator Desktop\updates\update.log`.

Portable ZIPs and development sessions do not initialize the updater.
WinSparkle 0.9.4 remains available for legacy installations.

## Trust and distribution

- The signed background feed is `updates/windows.json`. The legacy WinSparkle appcast is `updates/windows.xml`. Both are read from the repository’s `main` branch.
- Packages: public GitHub release assets under `AyaanZaveri/navigator`.
- Every update installer must have an Ed25519 signature. Its public key is compiled into the native shell from `desktop/windows/update-public-key.txt`. The private key must never be committed, copied into an app package or uploaded to GitHub.
- The pinned WinSparkle ZIP and extracted x64 DLL both have SHA256 checks in `scripts/fetch-winsparkle.mjs`. Its license notices are packaged alongside the application. The installer manifest also covers the updater DLL.
- This feature does not add Windows Authenticode signing. Ed25519 update verification and Windows publisher identity are separate mechanisms.
- No arbitrary URL, installer path, release command or signing key is accepted from the renderer. The existing origin gate and strict IPC parser also apply to update requests.

The initial bootstrap build must be installed manually. Previously installed versions have no updater. The empty initial feed intentionally advertises no update until a tested, signed installer is published. An unpublished feed produces a visible check error, never an unverified installation.

## Publishing a Windows update

1. Build from a clean release snapshot with the approved [manual desktop Actions workflow](desktop-actions-builds.md). Use standard GitHub-hosted runners. Never use the Zenbook for builds, tests, signing, key retrieval, or SSH.
2. Sign the immutable installer on this Mac with the existing private key at `~/.navigator-signing/windows-ed25519.pem` (owner-only permissions). The key was retrieved with explicit user authorization and verified against the shipped public key. Keep it outside source control and release artifacts. Do not generate a replacement key. Future releases do not need the Zenbook. The manual build workflow does not contain the official signing key.
3. After packaging, run on this Mac:

   ```sh
   node scripts/windows-update-feed.mjs dist/Navigator-X.Y.Z-windows-x64-setup.exe X.Y.Z release-vX.Y.Z "$HOME/.navigator-signing/windows-ed25519.pem" dist/windows.xml
   ```

4. Upload and publish the **exact signed installer bytes** to that GitHub tag. Verify the uploaded SHA256 and size. Never repackage/re-sign the installer after generating the appcast without regenerating its signature.
5. The user performs hands-on update tests on their chosen Windows device. Preserve sign-in/settings; verify shutdown, restart, native version, frontend Build ID and removal of obsolete chunks. Do not run interactive tests without a current explicit request.
6. Only after the asset exists and is validated, replace both Windows feeds on `main` with the generated signed files. Commit/push the feeds through the normal release review. No GitHub API token is shipped to users. A GitHub prerelease is offered only if deliberately included in this stable feed; `/releases/latest` is not used, so a macOS-only release cannot accidentally replace the Windows target.

Windows deltas and the full installer must use the same release version. Generate the signed JSON feed with `makeWindowsBackgroundFeed` in `scripts/windows-update-feed.mjs` using the immutable full installer and the matching delta assets. Publish an incremented numeric version.

## Validation

Run TypeScript plus:

```sh
node scripts/test-app-updates.cjs
node scripts/test-windows-update-feed.mjs
node scripts/test-settings-navigation.cjs
node scripts/test-desktop.cjs
node scripts/test-windows-install.cjs
node scripts/test-windows-install-readiness.cjs
node scripts/test-windows-package.mjs
```

Optional Windows fixture checks, only when explicitly requested for the current task:

```powershell
$env:RUSTFLAGS='-C target-feature=+crt-static'
cargo test --manifest-path desktop/Cargo.toml --target x86_64-pc-windows-msvc --release --locked
node scripts/windows-updater-smoke.mjs
powershell -NoProfile -File scripts/windows-updater-install-smoke.ps1
```

The native DLL fixture test uses an ephemeral loopback server and ephemeral signing keys. Production code has no feed/key override. It checks an older version, a valid signed download, tampering, missing signatures, an incorrect key, and missing/malformed feeds. A test-only callback intercepts payload execution **after** WinSparkle signature verification. This establishes download verification, not a visual/end-to-end production GitHub update claim.

The installer fixture compiles the actual NSIS source with only registry/shortcut/window-class identity substitutions and a tiny preparation executable. It exercises complete replacement, failed preparation preservation, retained interrupted backups, and update relaunch without altering the real Navigator installation or profile.

For a packaged-app UI check without opening or changing the installed app’s profile, use a separate extracted QA copy and `navigator-desktop.exe --profile <qa-profile-path> --port 37382`. This CLI option does not change the normal profile location. Do not repack a distribution after running it with real sign-in data.

## Recovery boundaries

A populated target must contain the Navigator executable, uninstaller and resources before whole-directory replacement is allowed. Unrelated populated folders and prior staging folders are left untouched. A preparation/extraction failure leaves the existing installed folder untouched. A failed activation attempts to restore the prior folder. An interrupted backup is retained at `<InstallDir>.update-backup`; a later installer refuses to delete it automatically and reports recovery is needed. This is not automatic rollback after a newly installed app crashes or fails its first ordinary launch. User profile data remains outside the replaced installation tree.
