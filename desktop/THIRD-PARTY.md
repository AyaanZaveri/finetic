# Native playback source and libraries

The desktop shell is licensed under **AGPL-3.0-only**. Its copied/adapted code
comes from [Viren070/AIOStreams](https://github.com/Viren070/AIOStreams), commit
[`c358754b0ae4758d034badf8618de6fdb7fa9333`](https://github.com/Viren070/AIOStreams/tree/c358754b0ae4758d034badf8618de6fdb7fa9333/packages/desktop).
The original license is included in `licenses/AIOStreams-AGPL-3.0.txt`.

| Navigator file | Original | Changes |
| --- | --- | --- |
| `src/mpv.rs` | `core/src/mpv.rs` | Fail startup on rejected options; expose playlist entry IDs to associate events with playback sessions. |
| `src/render.rs` | `core/src/render.rs` | Module paths and attribution. |
| `src/platform/macos.rs` | `app/src/platform/macos.rs` | Retain the OpenGL compatibility renderer; remove other outputs and unrelated platform services; add GL resource cleanup and Navigator menu. |
| `src/platform/macos/hdr.rs`, `src/hdr.rs` | `app/src/platform/macos/video.rs` | Adapt OpenGL HDR/EDR handling, PQ/HLG detection, display headroom, and SDR restoration; retain no output selector or AVFoundation/Metal output; guard 8-bit surfaces and invalid display values. |
| `src/platform/windows.rs` | `app/src/platform/windows.rs` | Retain the embedded HWND; Navigator now owns its D3D11 swap chain through libmpv 2.6's render API. |
| `src/platform/linux.rs` | `app/src/platform/linux.rs` | Retain the GTK/OpenGL surface and native display integration; remove unrelated services. |
| `libs.json` | `libs.pin`, `libs-macos.pin` | Preserve pinned release and library archive SHA-256 values. |

The Windows fullscreen transition in `src/windows_shell.rs` also adapts the
maximize/restore workaround from AIOStreams commit
[`259e769414ba51fd8034971fb4fda37d7c9d316f`](https://github.com/Viren070/AIOStreams/blob/259e769414ba51fd8034971fb4fda37d7c9d316f/packages/desktop/app/src/shell/tao_shell.rs).
It restores a maximized frameless window before entering fullscreen and restores
its maximized placement on exit.

The rest of the native shell and the Navigator integration are newly written.
Distributing a desktop derivative requires preserving the AGPL license, notices,
and corresponding source. This file does not relicense unrelated Navigator files.

`npm run desktop:fetch-libs` downloads the pinned **AIOStreams/libs** distribution.
Keep its `licenses` directory with the binaries: it includes libmpv, FFmpeg,
libass, and the bundled codec/rendering dependencies' notices. Their licenses and
source/build information are published at [AIOStreams/libs](https://github.com/AIOStreams/libs).
Windows additionally uses the pinned LunarG Vulkan loader, with its license.
Linux uses the system libmpv and its dependencies.

Packaging downloads the official **Node.js 26.7.0** runtime from nodejs.org,
checks its SHA-256 against the official release manifest, and includes its
`LICENSE` and runtime version/checksum alongside the binary.

Rust dependencies are pinned in `Cargo.lock`; their package metadata declares
their licenses. The standalone web server contains the existing project's npm
dependencies. Review and include the complete dependency notices and sources
required for a public release, together with this file and the bundled notices.

The Windows startup document embeds the app's **Sunghyun Sans** regular and
semibold fonts. Their SIL Open Font License is included in
`licenses/SunghyunSans-OFL.txt`.

## Seek previews

Native keyframe previews depend on `aiostreams-container` and `aiostreams-thumbs`
from [AIOStreams/media](https://github.com/AIOStreams/media), pinned to commit
[`87dee2ccd7c39aa9baf1e739292e14fa9f0d8ec7`](https://github.com/AIOStreams/media/tree/87dee2ccd7c39aa9baf1e739292e14fa9f0d8ec7).
They read indexed keyframes with HTTP range requests and decode/scale/tone-map
using the bundled FFmpeg libraries. The crates are AGPL-3.0-only; the license is
included as `licenses/AIOStreams-media-AGPL-3.0.txt`. Navigator's session-bound
request adapter and thumbnail UI are newly written.

The new Windows renderer (`src/platform/windows_video.rs`) is Navigator code. It
uses the public libmpv D3D11 API added in upstream PR 17764; the upstream render
example and flutter-webview-windows texture bridge were studied as references.
No code from those example repositories is included in the new renderer.

## Windows update framework

Installed Windows builds bundle [WinSparkle 0.9.4](https://github.com/vslavik/winsparkle/releases/tag/v0.9.4),
under the MIT license. `scripts/fetch-winsparkle.mjs` verifies the pinned
archive and x64 DLL SHA256 values before packaging. The upstream `COPYING`
and `COPYING.expat` notices are included under `resources/licenses/WinSparkle`.
Navigator's Rust C-ABI adapter is newly written; no updater is bundled on other
platforms by this integration.

## Sparkle 2.10.1

macOS packages include the official Sparkle framework for signed app updates.
Source and license: https://github.com/sparkle-project/Sparkle/tree/2.10.1
The package includes its MIT-style license and third-party notices at
`Contents/Resources/licenses/Sparkle.txt`. The framework's original nested
signatures and symlinks are retained. The pinned SDK hashes are in
`scripts/fetch-sparkle.mjs`.

## AetherEngine (optional macOS engine)

Navigator embeds [AetherEngine 7.76.0](https://github.com/superuser404notfound/AetherEngine/tree/7.76.0)
on macOS 15 and later, through a newly written Swift adapter. AetherEngine is
LGPL-3.0 with its upstream App Store/DRM exception. The dynamic FFmpegBuild
frameworks have distinct Aether-prefixed install names so they do not replace
libmpv's FFmpeg libraries. The release package includes the exact upstream
source references and license notices for AetherEngine, FFmpegBuild, LibDovi,
and the embedded Anime4K shader.
Optional Dolby Vision FEL and object-audio package traits are not enabled.
