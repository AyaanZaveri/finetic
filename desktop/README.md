# Navigator Desktop

Navigator's existing Next.js/React UI above native **libmpv** playback. Video
frames stay in the native GPU surface; a small JSON bridge carries commands and
state and bounded material samples. Browser playback continues to use the current Mux/HTML media player.

## Windows private build

Windows builds run only on the user's Zenbook via `ssh navigator-windows`,
from a reviewed source snapshot at `C:\Users\amanz\Code\navigator`. Do not
use GitHub Actions or Blacksmith for Windows builds. GitHub may host source and
private installer releases. Packaging produces `Navigator-<version>-windows-x64-setup.exe`
and `Navigator-<version>-windows-x64-portable.zip`. Builds target Intel/AMD
Windows 11 PCs. Windows code signing is not yet configured. Installed copies
support signed in-app updates; see [Windows updates](../docs/windows-updates.md)
for the bootstrap installation, signed feed and release procedure.

The installer runs per user, adds a Start menu shortcut and uninstall entry,
and installs Microsoft Edge WebView2 Evergreen if missing. The downloaded
bootstrapper must have a valid Microsoft Authenticode signature before it can
be included. The portable ZIP must be extracted in full and needs an installed
WebView2 runtime. Both variants retain sign-in/settings in
`%LOCALAPPDATA%\Navigator Desktop`; uninstalling keeps that profile.

To package on Windows x64, install Rust 1.92+, MSVC C++ build tools/Windows SDK,
Node 26.7.0 and NSIS (`makensis.exe` on PATH, or `NAVIGATOR_MAKENSIS` set to its
absolute path), install the web dependencies, then run:

```powershell
npm run desktop:fetch-libs
npm run desktop:package
```

Packaging builds the native EXE with the existing multi-size Windows icon,
version resources and a Per-Monitor V2 manifest. It also includes the standalone
Next server, pinned Node runtime and native libraries. The ZIP explicitly keeps
`.next/static`; no user credentials are bundled. Build on Windows for release
artifacts; cross-target `cargo check` skips Windows resource compilation. The
Windows packaging script uses an explicit x64 target and a static MSVC C runtime;
Release verification inspects imports so the release needs no separately installed Visual C++ runtime.

Windows draws minimize, app fullscreen and close inside the app, with no
separate system title bar. The middle caption control enters fullscreen for the
entire app, covering the taskbar. Native caption hit testing retains window
dragging, double-click maximize, Alt+Space, Alt+F4 and Snap hover (HTMAXBUTTON). Fullscreen keeps
the compact window buttons, with an Exit fullscreen action and F11/Escape behavior. Its minimum client size is 480×360 logical pixels; player controls
wrap in narrow windows. Normal window size/position and maximized state persist,
and saved placement is clamped onto an available display. A second launch
restores/activates the running window.

The Windows header uses the web's top spacing and trailing account placement.
Compact 32×24 caption controls use Lucide icons. A small vertical clearance
keeps the trailing avatar at the shared page gutter below the caption controls;
there is no extra caption row. The account menu aligns its trailing edge with the avatar and clamps to the viewport. The shared page scrollport uses
Radix's overlay thumb on every platform, preserving native scrolling without
reserving a scrollbar gutter.

After extraction, the installer runs the native `--prepare-install` mode once:
it verifies startup code/UI files against a SHA-256 manifest, starts and checks
the bundled local service on an ephemeral loopback port, then initializes a
headless video engine. The owned job cleans up the service and its descendants.
This creates no WebView profile, reads no sign-in cookies and changes no antivirus
settings. Errors abort installation with details in `installation.log`; timings
are recorded in `installation.jsonl` beside the normal startup log. The Start
menu shortcut points directly to the app without this flag. Portable users can
run `navigator-desktop.exe --prepare-install` once after extraction.

The first frame is a small native loading view. Backend and mpv initialization
run on a worker while the window remains responsive. WebView2 starts in parallel
and paints a bundled startup document that requires no server or network. The
document keeps the ship mark centered over static teal light fields throughout
startup, with no timer or service/player progress page. The same WebView
navigates as soon as the backend listens, while mpv continues
initializing. Up to 64 validated playback commands can wait for the player;
overflow reports a session error. A painted React readiness signal removes the
native loading view and synchronizes the caption theme. Closing during startup cancels the
backend wait. The backend is assigned to a kill-on-close Windows Job Object
atomically at creation, then resumes without a console; its descendants cannot
outlive Navigator. Playback frames stay native, and progress stays throttled
while control-state changes are delivered immediately.

Windows video uses libmpv 2.6's Direct3D 11 render API, with an app-owned flip
swap chain and the same device for hardware decoding. Its dedicated render thread
handles mpv frame callbacks and presentation; it never performs blocking client
property/command calls. Resize reuses compiled shaders. Minimized zero-size
surfaces consume pending frames without drawing. Device failures surface an error
and close the app cleanly rather than leaving a frozen video window.

Player glass is derived directly from that rendered texture, including its crop,
letterboxing and tone mapping. A GPU shader averages a 2×2 grid over each output
pixel footprint at up to 640×360, replacing the old 160×90 single bilinear sample.
The shader writes RGBA byte order, avoiding a CPU channel conversion. Three GPU
staging slots use nonblocking maps, and only completed small frames are read.
There is no screenshot command, full-resolution readback or second decoder.

Three read-only WebView2 shared buffers carry those pixels. The host never
modifies a slot until JS synchronously copies it to a canvas and acknowledges
its exact sequence. Pixel bytes never pass through JSON, base64 or image decoding;
only bounded metadata does. Pending frames are latest-only. Every send checks
the current trusted main-frame origin, and session/revision checks reject stale
GPU copies. Source/navigation/visibility changes invalidate pending work. JS
handles buffer/frame notifications arriving in either order and releases views
on pagehide. `capabilities.glassPixels` selects this additive protocol-1 path;
older native builds retain their existing image-glass fallback.

As on web, canvas applies a 12 CSS-pixel blur once at thumbnail resolution and
copies that frame to visible clipped controls. It does not schedule another rAF
or reparse CSS images per sample. Geometry updates only when controls move or
resize; tooltip positioning remains CSS-driven. Opening glass while paused
copies the cached video texture once; seek and resume update it normally.
Updates follow source/render cadence without synthesizing 120 frames for a
24 FPS video. Hidden/minimized controls stop sampling. Menus use a 68% tint in
both app themes; reduced-transparency menus remain opaque. The render target is
still SDR BGRA8; physical HDR presentation/color accuracy remain unverified.

Subtitles use the shared outlined text renderer, without a background box or
any glass demand. Settings → Subtitles provides UI Arc size/outline controls and
a live image preview on web and every desktop/mobile client. Preferences persist
on the current device. Menu and scrub-preview glass retain the existing path.

The Windows loading identity uses the same 24px content gutter as the playback
text. Back retains its independent 16px chrome gutter. Android/iOS camera and
safe-area handling are preserved.

The smoke fixture runs the production effect and real menu CSS, checks that its
canvas is visible and contains a blurred edge, and measures actual canvas draw
calls independently from delivery. It tests pause caching, paused-seek refresh,
resume and hidden-demand stop. `NAVIGATOR_GLASS_VIDEO` selects a local generated
clip. `RUST_LOG=navigator_desktop::windows_glass=debug` reports p95 elapsed time
from GPU sampling to the synchronous canvas-copy acknowledgment. This is a
pipeline-age metric, not physical display scanout or source PTS synchronization.
The fixture separately reports JavaScript canvas work and WebView rAF cadence.

Additional references: [WebView2 read-only shared buffers](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_17),
[Microsoft shared-buffer example](https://github.com/MicrosoftEdge/WebView2Samples/blob/main/SampleApps/WebView2APISample/ScenarioSharedBuffer.cpp),
[WebView2 synchronization contract](https://github.com/MicrosoftEdge/WebView2Feedback/blob/main/specs/SharedBuffer.md).
Context7's WebView2 documentation and Microsoft's examples informed this path.

References: [upstream D3D11 render API](https://github.com/mpv-player/mpv/pull/17764),
[public API contract](https://github.com/mpv-player/mpv/blob/master/include/mpv/render_d3d11.h),
[mpv rendering examples](https://github.com/mpv-player/mpv-examples/tree/master/libmpv),
[frame/texture sharing reference](https://github.com/jnschulze/flutter-webview-windows/blob/main/windows/texture_bridge_gpu.cc),
[Microsoft nonblocking map semantics](https://learn.microsoft.com/en-us/windows/win32/api/d3d11/ne-d3d11-d3d11_map_flag).
Context7's mpv and Microsoft Direct3D documentation were consulted alongside these
primary sources. The Direct3D backend was merged October 15, 2026; the pinned
October 29 mpv bundle reports client API 2.6 on the Zenbook.

Historical bitmap-path Release measurements (`da0e546`) on the Zenbook (2880×1800, 120 Hz, Balanced
power profile, local synthetic H.264): 1080p60 delivered 60.49 samples/sec and
60.09 material style updates/sec; 4K60 delivered 60.47 and painted 60.30/sec.
Their p95 material-update gaps were 18.2 and 25.7 ms. Both passed pause caching,
paused-seek refresh, resume and hidden-demand stop. The 4K exact seek took
1.087 seconds with the generated long-GOP clip; it is measured separately from
continuous playback. A foreground 1080p120 Release stress run delivered 97.25
and painted 84.30/sec (p95 paint gap 23.1 ms), below the test's 100 FPS target.
Other runs varied, including a Debug peak of 117 deliveries and 107 paints/sec.
This is adaptive high-refresh support, not a claim of sustained 120 FPS. The
paint metric observes the production effect's style changes, not physical scanout.
The fixture also reports WebView rAF cadence to distinguish background throttling.
The installed Release also passed physical WebView F11, physical caption-button
entry/F11 exit, bridge fullscreen, monitor/taskbar coverage, maximized restoration,
retained-page isolation, startup branding, Snap hit testing and normal shutdown.
A synthetic parent-window `WM_KEYDOWN` probe failed to enter fullscreen in this
Release run; physical F11 works through WebView2, and parent-only focus remains an
unverified diagnostic case. This probe must not be reported as a passed check.
Native renderer/runtime source: `da0e546`; shared packaged UI: `5c5a90e`.

The initial native frame contains no GDI text and shares the splash's base color.
The offline splash embeds the same regular and semibold Sunghyun Sans WOFF2 files
as the app. Its CSP permits only data fonts; its exact generated document remains
the navigation allowlist entry, without granting the splash a privileged origin.

### Windows verification and performance

```powershell
npm run test:windows-desktop
npm run desktop:check
$env:NAVIGATOR_TEST_NODE = (Get-Command node).Source
cargo test --manifest-path desktop/Cargo.toml --locked job_closes_backend_and_descendants -- --include-ignored
./scripts/windows-smoke.ps1 -Executable ./dist/desktop-win32-x64/navigator-desktop.exe
./scripts/windows-smoke.ps1 -Executable ./dist/desktop-win32-x64/navigator-desktop.exe -LaunchApp -StartupDelaySeconds 8
./scripts/windows-overlay-smoke.ps1 -Executable ./dist/desktop-win32-x64/navigator-desktop.exe
./scripts/windows-fullscreen-smoke.ps1 -Executable ./dist/desktop-win32-x64/navigator-desktop.exe -Trigger Caption
./scripts/windows-glass-smoke.ps1 -Executable ./dist/desktop-win32-x64/navigator-desktop.exe
node scripts/test-windows-install.cjs
./scripts/windows-install-smoke.ps1 -Executable ./dist/desktop-win32-x64/navigator-desktop.exe
./scripts/windows-performance.ps1 -AppProcessId <NavigatorPID> -Seconds 30
```

The smoke check starts no server, uses generated color bars and a separate
`Navigator Desktop\smoke` profile, verifies native playback progress and the
WebView bridge, captures the compositor output, checks visible bars, and closes
normally. Keep screenshots and timing logs as local compositor diagnostics.
It does not establish hardware decoding, HDR accuracy or physical-display behavior.
The installed-app check deliberately blocks Node startup for eight seconds and
checks a screenshot of the bundled startup screen before the backend is ready.
It then verifies the hydrated app, caption hit testing and normal shutdown.
The overlay regression uses the production native-playback and wordmark CSS
over a local test video. It checks that a descendant with explicit visibility
cannot leak out of the retained browsing page. Run screenshot checks in the
signed-in desktop session, not SSH session zero. The Windows page's opacity is
suppressed during playback, preserving layout/scroll state while hiding the
entire composed surface, including wordmarks and backdrop effects.

`startup.jsonl` in the local data directory records elapsed milliseconds for
`window-visible`, `backend-starting`, `backend-ready`, `player-starting`,
`player-ready`, `webview-starting`, `startup-view-created`, `startup-page-loaded`,
`navigation-starting`, `page-loaded` and `app-ready` (`webview-created` in the
video-only smoke test). The visibility mark records the native show call, not a measured
display scanout; readiness records the painted hydrated shell, not completion
of remote catalog requests. Logs rotate at 1 MiB and contain no media URLs or
credentials. First-window and interactive-startup goals are 300 ms and
1 second warm / 2.5 seconds cold respectively; these are goals until measured
on the target PC. Compare repeated cold and warm Release launches separately.

New Windows shells advertise `capabilities.timings`. Their log also records
`client-interface-hydrated`, `client-play-requested`, `client-player-mounted`,
`client-stream-resolving`, `client-stream-resolved`, `playback-load-received`,
`playback-open-started`, `playback-file-loaded`, `playback-seek-requested`, and
the first `playback-ready` for each load. These distinguish deferred JavaScript,
stream resolution, native opening and resume seeks without logging URLs or titles.
Older shells receive none of the new diagnostic requests. Windows preloads the
player chunk while idle so its download/evaluation need not wait for first Play.

Before installation preparation, one measured Windows cold launch took 24.6 seconds: the backend listened at
6.8 seconds, navigation started immediately, and the hydrated interface was
ready at 24.6 seconds. The player initialized in parallel and was ready at
9.5 seconds. Showing the bundled startup document quickly did not establish
fast application readiness; this prompted the installation preparation work.
The Zenbook's subsequent log showed a 26.4-second cold launch followed by two
warm launches at 1.9 and 1.8 seconds. The cold backend took 7.9 seconds and the
interface another 18.4 seconds. No dependencies are installed at app launch.

A November 2 Defender recording attributed 11.3 seconds of cumulative scan time
to the bundled Node process and 4.8 seconds to the native app. These durations can
overlap. A controlled reinstall followed by installation preparation reduced the
first normal launch from 22–26 seconds to 2.1 seconds on the Zenbook. Targeted
preparation took 28.3 seconds during the prototype installation. The completed
installer (`df53deb`) then measured 1.988 seconds for its first normal launch and
1.949 seconds warm; preparation took 28.782 seconds within a 45.180-second total
installation. This measures first launch after installation, not launch after an
OS reboot or every antivirus configuration.
The installer is not rerun by the shortcut. After app-wide caption fullscreen
and native glass were added (`c672185`), a later run measured 4.804 seconds first
launch, 4.369 seconds warm and 2.420 seconds on a subsequent warm check. Its
installation took 65.282 seconds, including 38.595 seconds of preparation.
These are individual samples on the shared Zenbook, not a statistically controlled
benchmark or a guarantee of a fixed launch time.

The fullscreen transition restores a maximized frameless window before entering
borderless fullscreen, then remaximizes it on exit. F11 is handled in the WebView
capture phase and by the native parent when it has keyboard focus; held keys do
not repeatedly toggle. The native fullscreen regression measures physical monitor
and client bounds and checks that the bottom screen pixel belongs to Navigator,
without setting the app topmost (which would hide a taskbar regression).

The performance script records the complete Navigator/Node/WebView2 process
tree's summed working sets, private bytes, CPU and available GPU engine counters.
Working-set sums may count shared pages more than once. GPU columns sum the
matching engines and remain blank when counters are unavailable/localized.
Use WebView2 DevTools' Performance panel (`--devtools`) for long tasks and frame
stalls, and Windows Performance Recorder/Analyzer for native scheduling and GPU
investigation. Measure idle browsing and playback separately.

Before accepting a private build on physical Windows hardware, check:

- Installation, upgrade and uninstall on a PC without Node or developer tools;
  sign-in survives upgrade and uninstall leaves settings intact.
- Snapping, 480×360 controls, keyboard focus, second-launch activation,
  maximize/fullscreen restoration and moving between 100/150/200% DPI displays.
- Transparent controls, subtitles, pause/seek/volume feedback, expired streams,
  rapid replacements, minimize/restore, sleep/resume and audio-device changes.
- Closing during backend startup and playback leaves no owned Node process.
- SDR playback and HDR-to-SDR fallback. Validate HDR on a physical HDR display,
  including SDR→HDR→SDR, Windows HDR toggles and moving between SDR/HDR monitors,
  before making HDR claims.

ARM64 release artifacts, OS media controls,
public signing and Store distribution remain later milestones.

The renderer is adapted from AIOStreams; see [THIRD-PARTY.md](THIRD-PARTY.md)
for exact provenance and the AGPL license.

## Development

Requirements:

- **Rust 1.92 or newer**, Cargo, and the platform's native compiler tools.
- The web project's dependencies installed normally.
- macOS 13.5+: Xcode command line tools and `libmpv.2.dylib` (`brew install mpv`), or
  the verified libraries downloaded below. The standard OpenGL compatibility
  output works with stock libmpv; special patched output drivers are not required.
- Windows: MSVC build tools and the WebView2 runtime. Run
  `npm run desktop:fetch-libs` to install pinned native libraries.
- Linux: GTK 4.14+, WebKitGTK 6, libmpv 0.38+, and their development packages
  (for example `libgtk-4-dev libwebkitgtk-6.0-dev libmpv-dev` on a recent Ubuntu).

Keep the existing Next development server running, then start only the shell:

```sh
npm run desktop:dev
# Alternate existing server:
NAVIGATOR_DESKTOP_URL=http://localhost:3001 npm run desktop:dev
# Explicit library override:
NAVIGATOR_LIBMPV=/absolute/path/libmpv.2.dylib npm run desktop:dev
```

`desktop:dev` never starts another Next server. It compiles/runs the Rust shell
and loads the specified server. The bridge is injected only into the top-level
page on that exact origin (including the port). Use a trusted Navigator server.
Other HTTP(S) navigation opens the system browser; arbitrary schemes are denied.

Native library lookup order: `NAVIGATOR_LIBMPV`/`--libmpv`, packaged
`resources/lib`, `desktop/vendor/<os>-<arch>`, then standard system locations.
OS/architecture folder names use Rust's names (`macos-aarch64`, `windows-x86_64`).

For a manual stream startup comparison on macOS or Windows, set
`NAVIGATOR_PLAYBACK_SOURCE=direct` in the native app's environment before launch.
mpv then opens the supplied URL with the original request headers. The preview
decoder also reads the original URL. Decoded preview images remain cached, but
playback and previews no longer share downloaded bytes. Set the value to
`shared-cache`, or unset it, to restore the existing shared byte cache. Restart
the native app after changing the value. Other values retain the existing mode.

On macOS, launch a newly compiled app executable from a terminal with
`NAVIGATOR_PLAYBACK_SOURCE=direct /path/to/Navigator.app/Contents/MacOS/navigator-desktop`.
On Windows PowerShell, set `$env:NAVIGATOR_PLAYBACK_SOURCE = 'direct'` before
launching the newly compiled EXE from that shell. This switch requires a binary
that includes this change. It does not change an already installed release.

Compare the same manually selected stream and resume position. This switch
bypasses the Rust byte relay only. A supplied URL from the separate optional
next-episode preload endpoint still uses that endpoint, so use a manually
selected original stream for the comparison. No startup speed improvement has
been measured yet.

Only one native instance may use a profile. Cookies and web storage are kept in
the platform's local data directory under `Navigator Desktop/webview`.
Restarting with a different server origin starts that origin's own session.

Configure provider keys in **Settings → Navigator**. For desktop browsing, search,
title details and artwork, get your own **API Read Access Token** from
[TMDB’s API settings](https://www.themoviedb.org/settings/api). Open
**Settings → Connections → TMDB**, paste it into **TMDB read access token**, and
select **Save token**. Tokens are validated before
saving, persist in the WebView's HttpOnly cookie storage for a year, and can
be replaced or removed in Settings. Desktop artwork does not read environment
credentials. Rejected replacements preserve the working token.

## Verification

```sh
npm run test:desktop
npm run test:image-layout  # macOS: real WKWebView card sizing regression
npx tsc --noEmit
npm run desktop:check
```

The JavaScript tests exercise state/events, volume preferences, metadata before
resume, invalid URLs, stale sessions, teardown, and bridge origin/frame checks.
The native checks run formatting plus Rust protocol tests. Neither check starts
Next or launches a browser. The image layout check renders the actual React
cards and Tailwind utilities in an isolated, nonpersistent WKWebView using local
fixture images. It verifies poster, continue-watching, and episode image bounds,
including the nested percentage-height issue that can otherwise crop images in
WebKit. It starts no server and does not use Navigator's saved profile.

An optional integration test exercises an actual libmpv instance headlessly
(load, metadata, pause, seek, volume, rapid file replacement, and shutdown):

```sh
NAVIGATOR_TEST_LIBMPV=/absolute/path/libmpv.2.dylib \
  cargo test --manifest-path desktop/Cargo.toml --locked headless_library_playback -- --include-ignored
```

Manual native checks, on each target OS:

For a standalone compositor check, run `npm run desktop:dev -- --smoke-test`.
It generates local color-bar video beneath a transparent HTML control panel,
with working pause, seek, and native fullscreen. It starts no server and needs
no sign-in or external media. This diagnostic uses the native bridge directly;
the full React player should still be checked against the web app below.

1. Sign in and play a direct HTTP(S) MP4/MKV/HLS stream, including one requiring
   addon request headers. Confirm video appears beneath the React controls.
2. Pause, seek, change volume/speed, choose embedded audio/subtitles, then select
   external subtitles. Confirm playback position and progress reporting agree.
3. Enter/exit fullscreen using the control, F11, Escape, and macOS's window
   button; resize, minimize, restore, and move the window between displays.
4. Switch titles quickly and close during loading; confirm stale events do not
   close the new player, and audio stops on close/reload/logout.
5. Try an expired URL and an unsupported source; confirm the error and retry UI.
6. Quit the app; packaged runs must also terminate their owned Node server.

## Packaging

```sh
npm run desktop:fetch-libs  # macOS/Windows; SHA-256 checked pinned release
npm run desktop:package
# Repackage existing native release + Next standalone builds:
npm run desktop:package -- --skip-build
```

Packaging is an explicit action: it runs Next's build and Cargo's release build,
then copies the Next standalone server **plus `public` and `.next/static`**.
It downloads an official, checksum-verified Node runtime so a Homebrew-linked
Node binary is not accidentally shipped. `.env*` files and the runtime response
cache are excluded. Users configure their provider and artwork credentials in
Settings. A pre-provisioned portable library bundle can be supplied with
`NAVIGATOR_LIBS_DIR`.

Output is `dist/desktop-<platform>-<arch>`; macOS produces `Navigator.app` with
an ad hoc development signature. Packaging generates the macOS icon from
`public/logo/desktop/navigator.png`, includes all standard/Retina sizes in
`Contents/Resources/Navigator.icns`, and registers it in `Info.plist`.
The web logo remains `public/logo/navigator.png`.
Public distribution still needs release
signing/notarization, installers, and a full dependency license review.
Packaging refuses to overwrite an existing output directory.

The packaged shell owns its standalone server, binds it to **127.0.0.1:37371**,
waits for startup, and stops/reaps it on exit. An occupied port is an error; it
never silently attaches the privileged bridge to a different running server.
`--port <port>` changes this stable origin. `--resources <folder>` overrides
the server/runtime/lib resource folder; `--url <url>` uses an existing server
and does not start a backend.

## Implementation

### Background and delta updates

The desktop shell checks at launch and hourly when automatic downloads are on.
It downloads updates while the app remains open. The header and Settings show
`Restart to update` after preparation. The local Next.js server, routes, sign-in
profile, and settings locations are unchanged. A manual check also prepares a
download; installation needs a separate restart action.

macOS uses Sparkle with a custom user driver. Sparkle verifies the archive,
extracts it, and waits for the restart choice. Normal quit cancels a pending
installation. It can use signed binary deltas and falls back to the full ZIP
when a delta cannot apply. The native shutdown handoff still stops mpv and the
owned server before replacement.

Windows uses the bundled Node runtime for update downloads, separately from
the local server. Both the JSON release manifest and the installer bytes are
verified with the existing pinned Ed25519 key. A delta installer contains changed
files and a complete target manifest. It copies and checks unchanged files into
a new staging directory. It never modifies the active installation in place.
A mismatched base triggers the signed full-installer fallback. The existing
NSIS preparation, atomic activation, and recovery checks still apply.

The manual `desktop-build.yml` workflow accepts `delta_base_tag`. If empty, it
tries the latest stable release in the current repository. It requires GitHub's
SHA256 asset digest and otherwise builds full packages. Windows bases must have
`release-manifest.json`, so existing users need one full update to install this
updater and establish a reusable base. Deltas are kept only when smaller than
90% of the full package. CI collects them with the ordinary artifacts and hashes.
No signing key is uploaded to CI.

Release signing stays separate from building and publishing. Pass generated
`.delta` files after the output XML argument to `macos-update-feed.mjs`. Pass
Windows `-delta.exe` files after the output XML argument to
`windows-update-feed.mjs`. That script emits the legacy XML and a signed JSON
feed. Publish the JSON as `updates/windows.json` with the XML feeds, and upload
every payload named by those feeds before advancing them. Keep both full
packages available for fallback and for older updater versions. Do not publish
unsigned CI output as an update feed.

`npm run test:app-updates` checks signatures, tampering, cache reuse, base
selection, reconstruction, removed files, path confinement, and full fallback
with fixture files. It does not install or launch a desktop app.

| Platform | Native surface | React overlay |
| --- | --- | --- |
| macOS | libmpv render API into `CAOpenGLLayer` | Transparent WKWebView in the same window |
| Windows | mpv Direct3D 11 into a child HWND | Transparent WebView2 above the child |
| Linux | libmpv render API into `GtkGLArea` | Transparent WebKitGTK 6 inside `GtkOverlay` |

Blocking mpv commands run on a worker thread; the render thread never waits on
them. State updates are throttled to 250 ms, with important state changes sent
immediately. Playlist entry IDs associate file events with frontend sessions.
The web document stays transparent from first paint; the app's normal backdrop
is a separate element hidden during native playback.

`MpvController` and `<navigator-mpv>` implement the media-element contract used
by the existing Media Chrome controls. Native fullscreen is supplied through a
custom MediaStore mediator, keeping the video and controls in one native window.
Picture-in-picture is hidden for native playback. Embedded text subtitle cues
come from mpv's `sub-text` property and use the same React overlay as addon
subtitles. Native drawing is disabled for text tracks to avoid duplicates.
Native text clears on track changes, replacement, loading, errors and playback
end. Selected PGS, VobSub/DVD, DVB and XSUB bitmap tracks instead use mpv's native
image compositor. Their authored typography and placement are preserved; custom
text appearance and the downloaded-cue timing control do not apply to bitmaps.
No OCR or lossy image-to-text conversion is performed. Switching Off or to an
external/text track disables native bitmap drawing. The UI chooses a matching
embedded track before falling back to external downloads, once metadata is ready.
This decoder routing is shared by macOS and Windows. Browser playback prefers
in-stream text tracks exposed through `TextTrackList`; late text-track discovery
can replace an automatic external fallback, but never a manual selection or Off.
Browsers do not gain PGS decoding from this native change. PGS-only browser
streams continue using matching external SRT/VTT captions when available;
there is no OCR, new browser PGS demuxer, or server transcoder in this release.

On macOS, windowed playback ties standard window-button visibility to player
controls. Leaving playback restores the buttons; fullscreen restores AppKit's
ownership of top-edge titlebar reveal. Older native builds ignore this UI feature
through a bridge capability check.

The Ask Navigator launcher hides as soon as playback starts loading. Starting a
title from Ask closes its panel, and home/Ask gradient backgrounds unmount for
the entire visible-player lifetime. They return after playback is closed.

The bridge exposes only load/play/pause/seek/volume/mute/rate/track/stop and
native fullscreen. It validates message sizes, numbers, header syntax, and URL
schemes. The player disables user scripts/config, reference following, and
unsafe playlists, and constrains FFmpeg's stream protocols.

### Playback sleep prevention

The native player holds an idle-display sleep request only while its current
file is playing, including buffering. Pause, stop, end, source replacement, and
shutdown release it. macOS uses an IOKit `PreventUserIdleDisplaySleep` assertion,
which also prevents idle system sleep. Windows uses `SetThreadExecutionState`
with continuous display and system requirements on the player thread. The guard
stays on that thread and releases its request before shutdown. These requests
respect manual Sleep, lid close, and system emergency power policy.

Browser playback uses Screen Wake Lock when the API and browser policy permit
it. The request is released on pause, end, errors, page hiding, or player cleanup.
Returning to a visible playing page requests a fresh lock. Unsupported browsers,
denied requests, and low-power restrictions do not block playback or cause a
retry loop. Native macOS/Windows playback uses the OS guard independently of
WebView support.

References: [Apple power assertions](https://developer.apple.com/library/archive/qa/qa1340/_index.html),
[Windows execution state](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setthreadexecutionstate),
and [Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).

### Scrubber previews on web and desktop

Hovering the timeline shows the existing Dice UI preview card, timestamp, and a
Skeleton until the requested frame is ready. Supplied VTT/sprite thumbnails and
`tooltipThumbnailSrc` still take priority. `MediaPlayerSeek previewFrames`
enables on-demand extraction when a stream supplies no storyboard.

- Desktop preloads the file index after playback loads, then uses the pinned
  AIOStreams/media library to read selected keyframes with HTTP ranges. It keeps
  up to 256 JPEGs within a 16 MiB memory budget, decodes with two background
  workers, and fetches at most two frames concurrently. It never seeks the
  playback decoder. Stream request headers are reused. A session-scoped,
  token-protected loopback endpoint serves generated JPEGs from memory. It
  cannot open media URLs or files. The page retains bounded Blob copies so
  native eviction cannot break an image it has cached. Older runtimes and an
  unavailable local image endpoint retain base64 compatibility.
  Useful late frames populate the cache. During continuous scrubbing, each
  completed frame can update the picture even if the cursor has passed its
  keyframe interval. A cached frame for the current target takes priority.
  Image transfers that finish out of order cannot replace a newer preview.
  Hover exit suppresses display, and replaced sessions are ignored. Requests
  start immediately and coalesce every 60 ms without waiting for the mouse to
  stop. The previous picture stays visible with a quiet pending overlay until
  the next picture is ready. Replacement images decode before display. Black-bar analysis
  runs in an optional worker and never blocks showing an otherwise ready image.
- Web uses a separate muted HTML video decoder (Mux/MSE for manifest streams),
  preloads metadata, uses `fastSeek` where supported, and captures small sRGB
  JPEGs into a 96-frame LRU. Late seek errors cannot overwrite cached frames;
  canplay/progress events finish frames that were not ready at seeked. Progressive
  streams can retry once without anonymous CORS and display the decoded video
  directly when canvas readback is forbidden. Loading timeouts remain loading,
  while actual media errors can report unavailable.
  Requests use two-second buckets and a leading/trailing 60 ms throttle. Rapid
  movement skips obsolete work; hover exit cancels publication and source
  changes reset caches. The last frame stays under the loading skeleton.
- HLS uses the browser/WebView decoder. Native extraction requires indexed
  MKV/WebM or MP4/MOV and byte-range support. Unsupported streams show a preview
  unavailable state while normal playback and seeking remain usable. No server
  transcoding or extra backend is needed.
- Native JPEG previews of HDR10/HLG sources are tone-mapped to SDR. Browser
  previews also prefer cached sRGB snapshots, including on HDR-capable displays;
  a display capability alone no longer disables the thumbnail cache. Capture
  restrictions fall back to a visible video frame. Main HDR playback is unchanged.

`npm run test:desktop` checks caching, cancellation, stale sessions, and both
preview backends' scheduling. `npm run test:webkit-previews` runs actual video →
canvas capture/cache checks in an isolated WebKit view with a generated local
H.264 fixture; it starts no server or user browser. The optional native tests
also decode real PQ/HLG/SDR keyframes and verify cache reuse.

### HDR on macOS

HDR10/PQ and HLG video automatically use HDR on an HDR-capable display with a
16-bit float OpenGL surface. This follows AIOStreams' compatibility renderer:
mpv converts the input to PQ with matching BT.2020/P3 primaries, Core Animation
uses the matching PQ colorspace and EDR, and `target-peak` tracks the display's
brightness headroom (203 nits reference white). Small changes below 5% avoid
rebuilding mpv's shaders. Window/display changes coalesce over 250 ms; brief gaps
between files retain EDR for 1.5 seconds only while metadata is unavailable.
Known SDR switches immediately to an explicitly tagged sRGB layer with matching
`target-prim=bt.709`, `target-trc=srgb`, and full-range RGB output. Core Animation
performs display-profile conversion; mpv's ICC transform remains disabled to avoid
double conversion. This same SDR setup applies on startup, SDR displays,
unsupported HDR metadata/colorspaces, and 8-bit surfaces; mpv tone-maps HDR to SDR
when the display/surface cannot present HDR. The React controls stay in their existing WebView.

Playback settings on supported Mac builds offer a manual HDR tone-mapping
target for the next video. Automatic is the default. The manual target is
limited by the display's reported potential headroom. macOS controls the
display's actual output. Browser WebGPU preferences are separate.

Native HDR tests use local, tagged `pq.mkv`, `hlg.mkv`, and `sdr.mkv` fixtures:

```sh
node scripts/generate-hdr-fixtures.mjs /path/fixtures  # ffmpeg + libx265
NAVIGATOR_TEST_LIBMPV=/path/libmpv.2.dylib NAVIGATOR_TEST_HDR_DIR=/path/fixtures \
  cargo test --manifest-path desktop/Cargo.toml --locked -- --include-ignored
cargo run --manifest-path desktop/Cargo.toml --example hdr-check -- \
  /path/libmpv.2.dylib /path/fixtures
```

The native check renders SDR → PQ → SDR → HLG → SDR → PQ → SDR through the actual OpenGL layer,
checks the initial/return sRGB tag and EDR/colorspace state, and exercises fullscreen without a backend or
saved account. It reports whether the display and surface support HDR; an SDR
machine verifies fallback rather than HDR brightness. Use known HDR test patterns
on an HDR display for final visual/color validation.

The mpv manual's [`cocoa-cb-output-csp` guidance](https://mpv.io/manual/stable/#options-cocoa-cb-output-csp)
requires the layer tag to match the VO's target primaries/transfer. Navigator owns
its OpenGL layer, so it configures that tag directly rather than using mpv's
Cocoa window option. A related [upstream SDR gamma report](https://github.com/mpv-player/mpv/issues/14648)
concerns Windows HDR mode; its configuration is not applied to our Windows backend.

### HDR on Windows

Playback settings on supported Windows builds offer the same manual target.
Automatic uses the peak reported by DXGI for the active HDR display. A manual
value is capped at that peak and takes effect on the next video. SDR video and
SDR displays use the existing SDR output path.

This version does not include AIOStreams' custom Metal/AVFoundation outputs or
Dolby Vision output, native PiP, macOS automatic updates, or torrent resolution.
It plays the HTTP(S) stream URLs Navigator already obtains from addons.

## Documentation consulted

### Next-episode preloading

Shared playback discovers the following episode immediately, then prepares its
stream within five minutes of the end (or known credits), capped at a quarter of
the runtime for short episodes. Only one following episode is prepared. Video
preloading waits for 20 seconds of current playback to be buffered. It yields
when fewer than five seconds remain buffered, on pause/seek, while hidden, or
with Save-Data/2G. Disabling **Preload next episode**, changing titles or closing
the player cancels speculative work. Preparations expire after six minutes.

Desktop direct files use a memory prefix cache in the existing loopback Next
server, not a second mpv decoder. The prefix targets eight seconds using the
file-size/current-episode-duration estimate, or 8 MiB if unavailable; the hard
cap is 32 MiB. mpv reads that same cached prefix, with remaining ranges streamed
under backpressure. Range/validator checks prevent joining different file
versions. The cache retains at most the current file and one speculative file,
expires unused entries, and is released when playback closes. A cache error
falls back once to the original URL/headers and current playback position.
HLS/DASH, unsupported Range responses, missing validators and remote hosted
servers retain stream preparation without this direct-file byte cache. The
loopback endpoint requires authentication and a matching Origin for creation or
deletion; reads use an unguessable per-preload capability token.

Web/Mux retains a paused media element and its Mux playback-core engine, then
adopts the exact element into the player without resetting its source. HLS
standby configuration targets eight seconds and a 32 MiB buffer-size setting;
loading stops after the opening buffer or a 20-second loading deadline. HLS
limits are segment-granular, not a strict transferred-byte cap. Native browser
preload is a hint: it is reduced to metadata after the opening buffer/deadline,
so neither an exact duration nor a strict byte ceiling is promised for it.
Normal HLS buffering budgets resume on adoption. No speculative element plays
audio, and unused elements/engines are destroyed. Custom-header web streams
keep stream preparation without speculative browser loading.

mpv's [`prefetch-playlist`](https://mpv.io/manual/stable/#options-prefetch-playlist)
only opens the next entry once the current URL is fully read. Its
[loadfile implementation](https://github.com/mpv-player/mpv/blob/master/player/loadfile.c)
also ties reusable demuxers to matching URLs/options; simply fetching bytes in
WebKit cannot populate mpv's cache. The loopback design gives the explicit
earlier schedule without replacing the native renderer or creating a parallel
decoder. Its tradeoff is a local streaming hop during adopted playback; CPU and
transition latency still need measurement on actual media before claiming an
improvement. Mux lifecycle and preload behavior follow its
[playback-core implementation](https://github.com/muxinc/elements/tree/main/packages/playback-core)
and [browser preload semantics](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preload).

### Window integration

The macOS window uses Tao's transparent titlebar, hidden title and full-size
content view, keeping the native traffic lights in the app header. Blank header
space starts a native window drag through the origin-checked bridge; links,
inputs and menus keep their normal mouse behavior. The header reserves space
for the traffic lights; the player back button sits below them at the left
gutter. Both restore the normal inset in fullscreen. macOS resets the standard scrollbar properties to `auto` so WebKit
can apply the same 6px scrollbar and transparent track used by the site.

- [Tao macOS window extensions](https://docs.rs/tao/0.37.2/tao/platform/macos/trait.WindowBuilderExtMacOS.html):
  transparent titlebar, full-size content and traffic light inset (also consulted
  through Context7); [native window dragging](https://docs.rs/tao/0.37.2/tao/window/struct.Window.html#method.drag_window).
- [WebKit scrollbar precedence](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/::-webkit-scrollbar):
  non-auto standard scrollbar properties override the WebKit pseudo-elements.
- [wry 0.57 WebViewBuilder](https://docs.rs/wry/0.57.0/wry/struct.WebViewBuilder.html):
  transparency, initialization, IPC, origin checks, and child views.
- [mpv client API](https://github.com/mpv-player/mpv/blob/master/include/mpv/client.h)
  and [render API](https://github.com/mpv-player/mpv/blob/master/include/mpv/render.h):
  ABI, event lifetimes, playlist IDs, GL context/thread rules, and teardown.
- [mpv manual](https://mpv.io/manual/stable/): embedding options, stream protocols,
  header quoting, playback properties, and commands.
- Context7: [Apple EDR](https://developer.apple.com/documentation/quartzcore/caopengllayer/wantsextendeddynamicrangecontent),
  [display headroom](https://developer.apple.com/documentation/appkit/nsscreen/maximumextendeddynamicrangecolorcomponentvalue),
  and the mpv manual's `target-trc`, `target-prim`, `target-peak`, and tone mapping.
- [Media Chrome media elements](https://www.media-chrome.org/docs/en/media-element)
  and [React hooks](https://www.media-chrome.org/docs/en/react/hooks), together
  with the installed 4.12.0 MediaStore implementation/types.
- [Dice UI Media Player](https://diceui.com/docs/components/base/media-player):
  seek tooltip, thumbnail source/sprite support, and preview slot layout.
- Context7: [Media Chrome preview thumbnails](https://www.media-chrome.org/docs/en/components/media-time-range#preview-thumbnails),
  [HTML fastSeek](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/fastSeek),
  and [canvas origin restrictions](https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image).
- [Next standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output):
  server packaging, static/public assets, HOSTNAME, and PORT.
- [Next cookies](https://nextjs.org/docs/app/api-reference/functions/cookies):
  persistent HttpOnly cookies in Server Actions and rendering after updates.
- [TMDB application authentication](https://developer.themoviedb.org/docs/authentication-application)
  and [token validation](https://developer.themoviedb.org/reference/authentication-validate-key):
  API Read Access Tokens, Bearer headers, and validation before saving.
- [shadcn dropdown menus](https://ui.shadcn.com/docs/components/radix/dropdown-menu):
  existing Radix menus, radio groups, portal containers, and accessible labels.
- [Node official release artifacts](https://nodejs.org/dist/v26.7.0/): portable
  platform binaries, LICENSE, and SHA-256 manifests.
- [Node 26 supported platforms](https://github.com/nodejs/node/blob/v26.7.0/BUILDING.md#platform-list):
  the packaged runtime requires macOS 13.5+ and Windows 10+.

### Experimental AetherEngine playback on macOS

On macOS 15 and later, Navigator can use AetherEngine 7.76.0 through a
Swift/AppKit adapter. The existing Rust shell and React controls remain shared.
Settings > Playback > Playback engine offers libmpv, Automatic and AetherEngine.
libmpv remains the default until the alternative has completed physical-device
validation. Automatic tries AetherEngine and retries once through libmpv at the
current position if AetherEngine reports a playback error. Explicit AetherEngine
selection reports its own playback error.

Streams requiring custom request headers keep using libmpv. This prevents an
AVPlayer remote-HLS redirect or playlist from forwarding credentials to another
origin. Automatic also uses libmpv for a manually configured HDR target.
AetherEngine manages HDR brightness through Apple's native presentation path.

The Swift package is pinned in `macos/aether/Package.resolved`. Build it with
Xcode 27 and Swift 6.4, the upstream supported toolchain. For development, set
`NAVIGATOR_AETHER_BRIDGE` to the built dynamic library's absolute path.
Release packaging includes the ad-hoc signed dynamic bridge and its FFmpeg frameworks
under Contents/Frameworks while leaving the shell deployment target at macOS
13.5. Older macOS versions do not load the Swift library.

AetherEngine uses a bounded temporary fMP4 segment cache and a separate source
clock for subtitle cue timing. Seek previews use its timestamped cache-backed
API; targets outside the retained cache may have no preview yet. Stats for
nerds reports the selected engine, decoder route, video/audio decoder names,
source and presented HDR formats, and available drop counters. Counters unavailable on a
route are omitted rather than fabricated. Audio delay is limited to two seconds
in either direction on AetherEngine, and is unavailable on the direct remote
HLS path. The existing subtitle timing overlay follows the engine's source clock.
Explicit HDR output on a physical display, Dolby Vision, Atmos and PiP require
hands-on device testing; this experimental adapter does not yet expose PiP.

References:
- [Host guide](https://github.com/superuser404notfound/AetherEngine/blob/7.76.0/docs/guide.md)
- [API](https://github.com/superuser404notfound/AetherEngine/blob/7.76.0/docs/api.md)
- [Installation](https://github.com/superuser404notfound/AetherEngine/blob/7.76.0/docs/installation.md)
- [Formats and limitations](https://github.com/superuser404notfound/AetherEngine/blob/7.76.0/docs/formats.md)
- [Licensing](https://github.com/superuser404notfound/AetherEngine/blob/7.76.0/docs/licensing.md)
- [Moonfin macOS native view integration](https://github.com/Moonfin-Client/Moonfin-Core/blob/d1e22735d90489dec59bd331a7b5e51f491a39ac/macos/Runner/Playback/MacosAetherVideoPlatformView.swift)
- [Rivulet macOS engine integration](https://github.com/l984-451/Rivulet/blob/01265d25affcac3913515c945353845d6d30e753/RivuletMac/Player/AetherPlayer.swift)
