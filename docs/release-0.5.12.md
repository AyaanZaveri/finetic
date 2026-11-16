# Navigator 0.5.12

Navigator 0.5.12 supports Windows and macOS. This update adds playback sleep prevention and improves seek previews, artwork delivery, and repeated catalog loading.

### New features and improvements

- **Stay awake during playback:** macOS and Windows prevent idle screen and system sleep while playback runs. Pausing, ending, or closing playback restores normal sleep behavior. Supported browsers request a screen wake lock while the player page is visible. Browser power policy can limit this feature. Manual Sleep and laptop-lid actions remain under system control.
- **Seek previews:** The previous image stays visible with an updating label while the next preview loads. Completed frames remain available when you move back along the timeline, and more thumbnails can stay cached.
- **Preview image processing:** Preview images decode before display. Black-bar detection runs separately so it does not hold a ready image hidden.
- **Direct artwork delivery:** Posters, backgrounds, logos, and episode stills load directly from image services across Home, search, title pages, and Ask Navigator.
- **Catalog reuse:** Repeated catalog requests reuse cached results and prepare artwork for the items being shown.

### Windows installation

Requires **Windows 11 on an x64 PC**.

Download and run the installer. Installed versions with in-app update support can update through Navigator. Portable ZIP copies require manual updates.

The installer does not have a Windows publisher signature. In-app updates use cryptographic signatures to verify downloads.

### macOS installation

Requires **Apple Silicon and macOS 13.5 or later**.

Extract the app ZIP and move Navigator to Applications. Navigator 0.5.3 and later can update in the app. Versions through 0.5.2 require a manual upgrade to enable in-app updates.

This build uses an ad hoc signature and is not notarized by Apple. macOS may require approval before you can open it. In-app updates use cryptographic signatures to verify downloads.

