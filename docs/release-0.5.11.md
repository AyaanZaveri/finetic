# Navigator 0.5.11

Navigator 0.5.11 supports Windows and macOS. This update adds a direct stream loading option, browser playback controls, and artwork improvements.

### New features and improvements

- **Optional direct stream loading:** Launch the desktop app with `NAVIGATOR_PLAYBACK_SOURCE=direct` to open streams without the shared byte cache. Preview images remain cached. The existing loading mode stays enabled by default. This option lets you compare startup with the same manually selected stream.
- **Browser video playback:** Supported direct video files can use WebGPU playback with the existing player controls, audio track selection, and embedded text captions. Browser playback remains available as a fallback.
- **Browser HDR controls:** Settings includes WebGPU and HDR switches, plus a peak brightness setting for compatible browsers and displays.
- **Artwork and cards:** Media cards scale as one surface and use theme-aware artwork outlines. Repeated artwork requests reuse cached results.

### Windows installation

Requires **Windows 11 on an x64 PC**.

Download and run the installer. Installed versions with in-app update support can update through Navigator. Portable ZIP copies require manual updates.

The installer does not have a Windows publisher signature. In-app updates use cryptographic signatures to verify downloads.

### macOS installation

Requires **Apple Silicon and macOS 13.5 or later**.

Extract the app ZIP and move Navigator to Applications. Navigator 0.5.3 and later can update in the app. Versions through 0.5.2 require a manual upgrade to enable in-app updates.

This build uses an ad hoc signature and is not notarized by Apple. macOS may require approval before you can open it. In-app updates use cryptographic signatures to verify downloads.

### Checks completed

Playback, preview, resume, artwork, card interaction, and updater regression checks passed. Windows and macOS Rust tests, TypeScript checks, and frontend and native production builds passed. Packaged versions, archive integrity, checksums, and both platform update signatures were verified.
