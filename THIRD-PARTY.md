# Licensing and third-party code

Navigator's web application is GPL-3.0-only; see [LICENSE](LICENSE). The native
desktop shell is AGPL-3.0-only, including its adapted AIOStreams code; see
[desktop/THIRD-PARTY.md](desktop/THIRD-PARTY.md), its file-by-file provenance and
bundled AGPL texts. This does not relicense upstream components under Navigator's
license. Preserve each upstream notice when copying or distributing its files.

| Material | Source and license | Included notice |
| --- | --- | --- |
| Free Arc components in `components/arc/` | [Arc UI](https://uiarc.dev/license), MIT, copyright 2026 Elia Kuratli | [UI-Arc-MIT.txt](licenses/UI-Arc-MIT.txt) |
| Vendored skills from `emilkowalski/skills` | [Upstream MIT license](https://github.com/emilkowalski/skills/blob/main/LICENSE) | [Emil-Kowalski-skills-MIT.txt](licenses/Emil-Kowalski-skills-MIT.txt) |
| Vendored skills from `jakubkrehel/skills` | [Upstream MIT license](https://github.com/jakubkrehel/skills/blob/main/LICENSE) | [Jakub-Krehel-skills-MIT.txt](licenses/Jakub-Krehel-skills-MIT.txt) |
| Vendored `teach` and `wait-what` skills from `mattpocock/skills` | [Upstream MIT license](https://github.com/mattpocock/skills/blob/main/LICENSE) | [Matt-Pocock-skills-MIT.txt](licenses/Matt-Pocock-skills-MIT.txt) |
| Vendored `explain-code` skill from `petalas/skills` | [Plugin metadata declares MIT](https://github.com/petalas/skills/blob/main/plugins/explain-code/.codex-plugin/plugin.json), Nick Petalas | [Nick-Petalas-skills-MIT.txt](licenses/Nick-Petalas-skills-MIT.txt); preserve the additional [pstack notice and provenance](.agents/skills/explain-code/THIRD_PARTY_NOTICES.md) |
| Sunghyun Sans / Pretendard | SIL Open Font License | [Font license](app/fonts/sunghyun-sans/LICENSE) |
| Country flags | Respective upstream licenses | [3x2](public/flags/3x2/LICENSE), [circle](public/flags/circle/LICENSE) |
| Subtitle preview photograph | Simon Berger / Pexels | [Photo notice](public/images/subtitle-preview.LICENSE.txt) |
| Stremio sign-in mark in `public/logo/stremio.svg` | [Official Stremio brand assets](https://github.com/Stremio/stremio-brand/blob/master/logos/SVG/stremio-logo-800px.svg) | Stremio trademark; identifies the connected account provider |
| Tomatometer score marks in `public/logo/tomatometer-*.svg` | Rotten Tomatoes public [Fresh](https://www.rottentomatoes.com/assets/pizza-pie/images/icons/tomatometer/tomatometer-fresh.149b5e8adc3.svg) and [Rotten](https://www.rottentomatoes.com/assets/pizza-pie/images/icons/tomatometer/tomatometer-rotten.f1ef4f02ce3.svg) SVGs | Rotten Tomatoes trademarks; used to identify the review source and score. See [licensing information](https://www.rottentomatoes.com/help_desk/licensing). |
| IMDb wordmarks in `public/logo/imdb-*.svg` | [Official IMDb brand toolkit, June 2025](https://brand.imdb.com/imdb) | IMDb, IMDbPro, STARmeter, and all related logos are trademarks of IMDb.com, Inc. or its affiliates. |
| Mobile icons | Lucide ISC / Feather MIT | [Android notice](android/app/src/main/assets/third-party-licenses/lucide.txt), [iOS notices](ios/Navigator/Resources/ThirdPartyNotices.txt) |

`skills-lock.json` maps every installed skill to its source and content hash.
The `.claude/skills/` entries are links to the same vendored skills, with the same
licenses. Arc source used here is from the free MIT catalog; no Arc Pro source
is licensed or redistributed through this repository.

Native libmpv/FFmpeg distributions retain their upstream license directories.
iOS embeds MobileVLCKit under LGPL-2.1-or-later, documented with source and
relinking information in its notices. Node.js runtime packages retain their
upstream LICENSE. npm dependencies retain their own licenses: packaging collects
license and notice files from the installed dependencies alongside the app's
license and this inventory. Distribute the exact corresponding source snapshot
with binary releases; a binary package is not a substitute for source.

## Simple Icons GitHub mark

The GitHub mark in the app-update section comes from Simple Icons, licensed
under CC0 1.0: https://github.com/simple-icons/simple-icons
GitHub's name and logo remain trademarks of their respective owner.
