# Navigator 0.6.12

Navigator 0.6.12 is a build for macOS and Windows. It adds customizable arrow-key skips, operating system playback controls, and improvements to player controls and desktop windows.

The first list covers changes since the last macOS and Windows build, 0.6.11. The second list covers the additional changes that apply if you update from 0.6.10, the last published release.

### New features and improvements

**Since the 0.6.11 build**

- **Custom arrow-key skips.** In Settings → Playback → Seeking, choose a separate amount for the left and right arrows. Each accepts 1 to 60 seconds and defaults to 10 seconds. The reset button restores both defaults. A saved shared skip amount carries over to both directions.
- **Playback settings layout.** Episodes and Audio come before Seeking. Loading and recovery and Video and HDR follow. The seek fields show their keyboard shortcuts, and the seek and HDR brightness labels match the other settings.
- **System playback controls.** See the current title and playback progress and control play, pause, and position from macOS Now Playing or Windows media controls. Where available, Navigator also supplies artwork.
- **Settings shortcut.** Use Command–Comma on macOS or Control–Comma on Windows to bring Navigator forward and open Settings. macOS also has a Settings item in the Navigator menu.
- **macOS menus and windows.** Use the native About Navigator, File, View, and Window menus. Closing the window stops playback and leaves the app running. Click the Dock icon to bring the window back. Navigator remembers the window's size and position.
- **Windows window controls.** The caption buttons reflect whether the window is active. Window dragging avoids interactive controls and editable fields.
- **Player controls.** Controls hide after inactivity over empty player space and stay available while you use a control or menu. Click blank areas of the player to play or pause.
- **Browsing.** The navigation bar stays in place when you scroll past the end of the page. Poster outlines and watched badges stay legible on hover, and macOS poster scaling is smoother.

**Also new if you update from 0.6.10**

- **macOS title bar.** Double-clicking the title bar follows the system's Fill or Zoom setting and restores the previous size without freezing the window.
- **Chapter previews.** Chapter thumbnails load progressively while the video plays.
- **Audio and subtitle switching.** The player shows feedback while the first audio or subtitle selection loads. Each press of the subtitle shortcut shows feedback, including when the change is immediate.
- **Temporary 2× playback.** Hold to play at 2× from a paused video. Releasing restores the original paused state and playback speed. The player also restores settings if playback changes engines during the hold.
- **Volume and subtitle controls.** The volume slider gives clearer adjustment and keyboard focus feedback. Keyboard focus stays visible in scrollable subtitle lists.

### Windows installation

Requires Windows 11 on an x64 PC. Run the setup installer to install or update Navigator. Extract the portable ZIP and launch Navigator if you use the portable version. The installer has no Windows publisher signature. These build artifacts are for manual installation. Official installations keep their existing update channel.

### macOS installation

Requires Apple silicon and macOS 13.5 or later. Extract the app ZIP and move Navigator to Applications. This build uses an ad hoc signature and lacks notarization, so macOS may ask you to approve it on first open. These build artifacts are for manual installation. Official installations keep their existing update channel.

### Checks completed

TypeScript checks passed. Automated checks passed for keyboard seeking, hold-to-scrub behavior, playback preference migration and reset, and Settings navigation.
