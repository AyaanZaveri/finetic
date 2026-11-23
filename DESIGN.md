---
version: alpha
name: Navigator
description: An artwork-led streaming client with compact controls, neutral surfaces, and targeted translucency.
colors:
  light:
    background: "oklch(1 0 0)"
    foreground: "oklch(0.145 0 0)"
    card: "{colors.light.background}"
    card-foreground: "{colors.light.foreground}"
    popover: "{colors.light.card}"
    popover-foreground: "{colors.light.foreground}"
    primary: "oklch(0.60 0.10 185)"
    primary-foreground: "oklch(0.98 0.01 181)"
    secondary: "oklch(0.967 0.001 286.375)"
    secondary-foreground: "oklch(0.21 0.006 285.885)"
    muted: "oklch(0.97 0 0)"
    muted-foreground: "oklch(0.50 0 0)"
    accent: "{colors.light.muted}"
    accent-foreground: "oklch(0.205 0 0)"
    destructive: "oklch(0.58 0.22 27)"
    destructive-foreground: "oklch(0.985 0 0)"
    border: "oklch(0.922 0 0)"
    input: "{colors.light.border}"
    ring: "{colors.light.primary}"
    image-outline: "oklch(0 0 0 / 0.1)"
    control-on: "oklch(23% 0 0)"
    control-track: "oklch(89.5% 0 0)"
    control-thumb: "oklch(100% 0 0)"
    control-thumb-on: "{colors.light.control-thumb}"
    control-fill: "{colors.light.control-on}"
  dark:
    background: "oklch(0.145 0 0)"
    foreground: "oklch(0.985 0 0)"
    card: "oklch(0.205 0 0)"
    card-foreground: "{colors.dark.foreground}"
    popover: "{colors.dark.card}"
    popover-foreground: "{colors.dark.foreground}"
    primary: "oklch(0.70 0.12 183)"
    primary-foreground: "oklch(0.28 0.04 193)"
    secondary: "oklch(0.274 0.006 286.033)"
    secondary-foreground: "{colors.dark.foreground}"
    muted: "oklch(0.269 0 0)"
    muted-foreground: "oklch(0.708 0 0)"
    accent: "{colors.dark.muted}"
    accent-foreground: "{colors.dark.foreground}"
    destructive: "oklch(0.704 0.191 22.216)"
    destructive-foreground: "oklch(0.637 0.237 25.331)"
    border: "oklch(1 0 0 / 10%)"
    input: "oklch(1 0 0 / 15%)"
    ring: "{colors.dark.primary}"
    image-outline: "oklch(1 0 0 / 0.1)"
    control-on: "oklch(93% 0 0)"
    control-track: "oklch(33% 0 0)"
    control-thumb: "oklch(97% 0 0)"
    control-thumb-on: "oklch(19% 0 0)"
    control-fill: "oklch(62% 0 0)"
typography:
  catalog-heading:
    fontFamily: Sunghyun Sans
    fontSize: 1.5rem
    fontWeight: 600
    lineHeight: 2rem
  settings-title:
    fontFamily: Sunghyun Sans
    fontSize: 1.5rem
    fontWeight: 600
    lineHeight: 1.22
    letterSpacing: -0.02em
  button:
    fontFamily: Sunghyun Sans
    fontSize: 0.875rem
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: -0.01em
  settings-description:
    fontFamily: Sunghyun Sans
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.5
  navigator-message:
    fontFamily: Sunghyun Sans
    fontSize: 15px
    lineHeight: 1.5rem
rounded:
  sm: 0.375rem
  md: 0.5rem
  lg: 0.625rem
  xl: 0.875rem
  pill: 9999px
spacing:
  space-1: 0.25rem
  space-2: 0.5rem
  space-3: 0.75rem
  space-4: 1rem
  space-5: 1.25rem
  space-6: 1.5rem
  space-8: 2rem
  base:
    page-gutter: "{spacing.space-4}"
  sm:
    page-gutter: "{spacing.space-6}"
  lg:
    page-gutter: "{spacing.space-8}"
motion:
  artwork-hover:
    duration: 120ms
    timingFunction: cubic-bezier(.23,1,.32,1)
  dialog-enter:
    duration: 240ms
    timingFunction: cubic-bezier(.23,1,.32,1)
  dialog-exit:
    duration: 160ms
    timingFunction: cubic-bezier(.23,1,.32,1)
  header-blur-fade:
    duration: 180ms
    timingFunction: linear
components:
  button-primary-light:
    backgroundColor: "{colors.light.foreground}"
    textColor: "{colors.light.background}"
    typography: "{typography.button}"
    rounded: 12px
    height: 2.25rem
    padding: "{spacing.space-3}"
  button-primary-dark:
    backgroundColor: "{colors.dark.foreground}"
    textColor: "{colors.dark.background}"
    typography: "{typography.button}"
    rounded: 12px
    height: 2.25rem
    padding: "{spacing.space-3}"
  text-input:
    rounded: 12px
    height: 2.75rem
    padding: "{spacing.space-3}"
  catalog-poster:
    width: 9rem
    rounded: "{rounded.md}"
  media-secondary-light:
    backgroundColor: "{colors.light.secondary}"
    textColor: "{colors.light.secondary-foreground}"
  media-secondary-dark:
    backgroundColor: "{colors.dark.secondary}"
    textColor: "{colors.dark.secondary-foreground}"
  card-metadata-light:
    textColor: "{colors.light.muted-foreground}"
  card-metadata-dark:
    textColor: "{colors.dark.muted-foreground}"
  arc-dialog-light:
    backgroundColor: "{colors.light.popover}"
    textColor: "{colors.light.foreground}"
  arc-dialog:
    backgroundColor: "{colors.dark.popover}"
    textColor: "{colors.dark.foreground}"
    width: 440px
    rounded: 16px
    padding: "{spacing.space-6}"
---

## Overview

Navigator is a streaming client for finding a title, choosing a stream, and watching it. Posters, stills, and title wordmarks carry the color and personality. The ship mark, quiet Sunghyun Sans typography, and subtle emerald dot field give the app its own identity. On home, artwork palettes can color the field as the user explores titles. Catalog rails start directly below the header, with compact labels and little card chrome. Detail routes give the artwork room to breathe, then use a readable title, a few facts, and a clear play action. Settings use smaller, tightly grouped controls. Ask Navigator stays close to the current task as a compact composer with actionable results.

The YAML records selected values from the implementation. Use the referenced components and CSS variables in code. When a value drifts, check the source and update this reference with the relevant UI change.

## Colors

The keys in `colors.light` and `colors.dark` map to CSS custom properties of the same name, with a `--` prefix. `@app/globals.css` sets app colors, with dark mode under `.dark`. `@app/layout.tsx` sets both the class and `data-theme`, defaults to dark, and supports the system preference. Colors from the layered Arc foundation yield to Navigator’s unlayered declarations where the names overlap. `--surface`, `--surface-raised`, and `--surface-muted` resolve to `--card`, `--popover`, and `--muted`. Both `--text-secondary` and `--text-muted` resolve to `--muted-foreground`.

- **Surfaces and actions.** Use `--foreground` on `--background` for reading and invert that pair for the primary Button. `--primary` is teal and supplies `--ring`, links, and selected app treatments such as the Navigator message tint. `--accent` is a neutral emphasis surface. Arc switches and sliders use the neutral `--control-*` values from `@components/arc/foundation.css`. Arc’s bundled accent presets and lavender-to-peach gradients are upstream options. Keep them out of app-wide styling.
- **Edges and inputs.** Use a 1px `--border` for structural edges and `--image-outline` for the inset edge over artwork. Text fields use `--text-input-fill` (90% light or 70% dark `--background` mixed with transparency) and `--text-input-border` (`--border` or dark `rgb(255 255 255 / .12)`). Use the Button’s tinted destructive variant for destructive actions. Check contrast against the actual composited fill before choosing any new foreground and background pair.
- **Artwork color.** Keep title-aware color in the home palette, adaptive logo, and detail artwork. Reuse `@components/home-gradient-background.tsx`, `@components/home-palette-provider.tsx`, and `@components/adaptive-header-logo.tsx`. Keep labels and controls legible as the artwork changes.

## Typography

Sunghyun Sans ships locally in weights 100–900. `--font-sans`, `--font-body`, and the historical `font-poppins` utility all use it. `--font-mono` maps to Geist Mono for monospace content. Prefer the effective app family over the upstream Arc font defaults. See `@app/layout.tsx` and `@app/globals.css`.

- Catalog section headings use semibold Tailwind `text-xl sm:text-2xl` (20px → 24px at a 16px root). Card titles use 14px medium and supporting metadata uses 12px muted. Keep the full title available to assistive technology when the visual label truncates. See `@components/media-section.tsx` and `@components/media-card.tsx`.
- Give media titles room to balance and wrap. The movie title scales from Tailwind `text-3xl` to `text-4xl` and `text-5xl` at container breakpoints. The synopsis uses 16px with relaxed leading and `max-w-prose`. See `@app/(main)/movie/[id]/page.tsx`.
- Settings use 24px semibold page titles, 16px semibold section headings, 14px medium labels, and 13px muted descriptions. Navigator message text uses 15px with 24px leading. Use tabular numerals for clocks, counts, and changing values. See `@app/(main)/settings/settings.module.css`, `@components/navigator/focus.tsx`, and `@components/player-mobile.css`.

## Layout

Start with `--page-gutter` (1rem, 1.5rem from 40rem, 2rem from 64rem) and the existing `--space-*` rhythm. The shell keeps the header outside the `[data-page-scroll]` viewport. Media routes can paint behind the header. Preserve native scrolling, the skip link, and safe-area and window-control insets. The header aligns the ship mark and search at the leading edge, with the account action at the trailing edge. See `@components/layout-content.tsx`, `@components/layout-content.module.css`, and `@components/app-header.tsx`.

| Surface | Pattern to reuse |
| --- | --- |
| Home | Full-width rails with 9rem-wide 2:3 posters, 1rem gaps, and 4px track padding for focus. Continue Watching uses 20rem-wide 16:9 artwork. Use native horizontal scroll and show arrow buttons from `md` when the rail overflows. See `@app/(main)/page.tsx` and `@components/media-section.module.css`. |
| Search and people | Search and filmography grids use auto-fill columns with an 8.5rem minimum (capped at the container width) and a 9rem desktop minimum from 64rem. Keep 1rem column gaps and 1.5rem row gaps. Filters and facts wrap. Person profiles shift from a single column to a portrait and text from 40rem. See `@components/search-page.module.css` and `@components/person-page.module.css`. |
| Add-ons | Keep the search and filter toolbar at the page gutter and fit the catalog below it. The toolbar reuses Arc SearchField and ChipGroup with scoped 36px control heights and a 12px blur. Narrow layouts allocate 44px to search and its adjacent action. See `@components/addons-list.module.css`. |
| Title detail | The full-bleed hero is 19rem high on narrow web viewports and `min(62vh, 40rem)` from 48rem. Center a contained wordmark in its reserved area, then fade into the theme background before the body copy. Content overlaps the hero by 6rem or 13.5rem respectively. Movie details stack a centered poster and title on narrow widths and switch to a 14rem poster column at the `@3xl` container breakpoint. Keep episode stills at 16:9. See `@components/media-page/backdrop-transition.module.css` and `@components/episode-card.tsx`. |
| Settings | Center a 56rem workspace with a sticky 10rem category rail, 2rem column gap, and one content panel. At 760px and below, use the existing category Select above the panel. Group related fields under section headings. Use container width for paired fields (32rem in Settings). See `@components/settings/settings-shell.tsx` and `@app/(main)/settings/settings.module.css`. |
| Player and Ask Navigator | Player chrome overlays the video with Back at the leading top edge and a bottom title, timeline, and toolbar. Narrow or coarse-pointer layouts wrap titles and tool groups and give toolbar buttons a 2.75rem minimum hit area. Native window insets and the Android volume exception come from the existing shell styles. Ask Navigator centers a bottom-aligned panel up to `max-w-xl` (36rem) with bounded transcript scrolling. See `@components/player-control-bar.tsx`, `@components/player-mobile.css`, and `@components/navigator/focus.tsx`. |

## Elevation & Depth

Use tonal separation and hairlines on content. Artwork sits close to the page. `--shadow-artwork` gives light-theme thumbnails a small edge lift (`0 1px 2px rgb(0 0 0 / .03), 0 6px 16px -8px rgb(0 0 0 / .08)`). Dark artwork relies on the inset edge. `--shadow-resting` supports small raised selections. Reserve `--shadow-floating` for menus and dialogs (`0 20px 48px oklch(0% 0 0 / .105), 0 3px 10px oklch(0% 0 0 / .045)` light, `0 22px 55px oklch(0% 0 0 / .34)` dark). See `@components/arc/foundation.css` and `@components/media-page/detail-artwork.module.css`.

Reuse the shared floating material for menus: 12px blur and a `--popover` tint at 98% in light mode or 90% in dark mode. Scoped player styles can use sampled-video glass. Keep the clipping and positioning boundary on the surface itself, and use the solid fallback for reduced transparency. Use the existing progressive header blur and hero fade to maintain context while protecting legibility. Use the named `--layer-*` variables for stacking, including `--layer-overlay` (50), `--layer-tooltip` (60), and `--layer-toast` (70). See `@components/arc/floating-surface.module.css`, `@components/app-header.module.css`, and `@components/player-mobile.css`.

## Shapes

The base `--radius` is 0.625rem. Tailwind radius utilities use that base: sm is −4px, md is −2px, lg is the base, and xl is +4px. YAML records their equivalents at a 16px root. Keep the related but distinct shapes already in use: 8.5px poster frames, 12px standard buttons and text fields, 14px Arc dropdowns with 8px rows, and 16px Arc dialogs. Pills mark playback actions, compact badges, tracks, and switches. Arc’s default `--radius-control` is 1.125rem and can be scoped by a component. Use the radius of the component you are extending and preserve the clipping edge around moving artwork.

## Motion & Micro-interaction

CSS timings from `@components/arc/foundation.css` run at 120ms (`--duration-instant`), 160ms (fast), 240ms (standard), and 480ms (considered). The shared Motion presets in `@components/arc/motion-tokens.ts` give indicators and thumbs a no-bounce 0.26s visual spring and panel or width changes a no-bounce 0.40–0.42s spring. Keep quick feedback on the control and reserve larger moves for changes in structure. Prefer opacity and transforms for local feedback. The dialog, artwork, and header values in YAML are concrete examples.

- **Hover and press.** Keep the media hit plane stable. The poster image scales to 1.02 on fine-pointer hover, the thumbnail surface presses to 0.98, and the shared Button presses to 0.97. Reveal Play on hover and keyboard focus, and keep it visible on touch. Keep open, pressed, selected, checked, and disabled states distinct. See `@components/media-card.module.css` and `@components/ui/button.tsx`.
- **Focus and navigation.** The global keyboard treatment uses a 1px `--ring` outline and a 3px halo at 22% ring color. Bordered controls put the ring on the border, compound fields put it on the visible shell, and forced colors use a 2px `Highlight` outline. `@components/input-modality.tsx` and `@app/globals.css` suppress decorative pointer rings while retaining editable-control focus. Preserve native keyboard behavior, focus return, accessible names, and announcements. Use the shared skip link. Keep route headings focusable programmatically and outside the Tab order.
- **Keyboard shortcuts and selection.** The header search supports `/` and uses a combobox with arrow navigation and active-descendant announcements. Ask Navigator uses Cmd/Ctrl+K when enabled. Segments expose `aria-pressed` and use roving Tab focus with arrow keys. Preserve Radix dismissal and focus behavior in menus and dialogs. Keep player shortcuts scoped so editing and open controls get their own keystrokes. See `@components/arc/expanding-search/expanding-search.tsx`, `@components/arc/segmented-control/segmented-control.tsx`, and `@components/keyboard-shortcuts.tsx`.
- **Preferences.** Honor `prefers-reduced-motion` in CSS and `useReducedMotion` in Motion. Shared controls use immediate state changes or short fades where appropriate. Remove scale, sliding indicators, and smooth scrolling when they convey no essential information. Where surfaces use blur, preserve existing reduced-transparency and higher-contrast fallbacks. Keep progress, focus, and status readable with effects disabled.

## Voice & Content Strategy

Write short, calm labels that name the action: “Sign in to play”, “Skip intro”, and “Reset to defaults”. Use sentence case for controls and messages, existing category names for navigation, and original capitalization for titles. Use “Continue Watching”, “Ask Navigator”, “Add-ons”, “Audio”, “Subtitles”, and “Streams” where the product uses them. Keep title metadata compact, such as `2026` and `2h 39m`. Use plain units in settings and tabular time during playback. Describe the current state and offer a specific next action when an empty result or error can be resolved. Use the existing delayed `LoadingPlaceholder` for brief waits and preserve accessible status text. See `@components/ui/loading-placeholder.tsx` and `@components/navigator/request-error.tsx`.

## Components

| Use | Implementation |
| --- | --- |
| Buttons and links | Use `Button` from `@components/ui/button.tsx`: `primary` for the main action, `secondary` for a framed alternative, `ghost` for low-emphasis icon actions, and `danger` for destructive actions. Use `asChild` for navigation links and give icon-only buttons an accessible name. Use the existing media Play action for title routes. |
| Form fields | Compose `Field`, `Input`, and `InputGroup` from `@components/ui/field.tsx`, `@components/ui/input.tsx`, and `@components/ui/input-group.tsx`. Use Arc `Select` for a known list, `Combobox` for searchable choices, and `Switch`, `Slider`, or `NumberField` for the matching value type. See `@components/playback-settings.tsx` and `@components/playback-language-settings.tsx`. |
| Menus, popovers, and dialogs | For new peers of current Arc surfaces, use `@components/arc/dropdown-menu/dropdown-menu.tsx`, `@components/arc/popover/popover.tsx`, or `@components/arc/dialog/dialog.tsx`. Use checkmarked radio rows for one choice, a popover for anchored editing, and a titled dialog for tasks that need modal focus. Arc dialogs cap at 440px and leave a 2rem total viewport-width allowance. Pass the player’s portal container in fullscreen. Keep existing `components/ui/` and `components/account-ui/` wrappers where feature flows already depend on them. |
| Segments and settings | Use Arc `SegmentedControl` for a short set of mutually exclusive options and `ChipGroup` for filter chips. Keep the selected item visible in a scrollable strip. For a concrete pairing of labeled settings, segments, slider, and preview, see `@components/subtitle-settings.tsx`. |
| Navigation and media | Use `AppHeader`, its Arc `UserMenu`, and `SearchBar` for the top shell, and `SettingsShell` for settings categories. Reuse `MediaSection`, `MediaCard`, and `ArtworkImage` for browse rails and grids. Keep a details link and a separate Play button, with stable image ratios and explicit loading and missing-artwork states. See `@components/search-component.tsx` and `@components/artwork-image.tsx`. |
| Playback | Compose the shared player from `@components/ui/media-player.tsx`, `@components/player-control-bar.tsx`, and the selection and settings controls in `@components/player-selection-controls.tsx` and `@components/player-settings-menu.tsx`. Reuse scrollable menus and the responsive selection drawer. Keep subtitle text centered and outlined via `@components/subtitle-text.module.css` and keep timing editing in `@components/subtitle-timing-popover.tsx`. Preserve the shared browser and native player paths. |
| Ask Navigator | Extend the launcher, focus panel, and composer in `@components/navigator/launcher.tsx`, `@components/navigator/focus.tsx`, and `@components/navigator/composer-input.tsx`. Use `ResultCard` from `@components/navigator/result-card.tsx` for tools that return destinations or actions. Pair compact leading artwork or an icon with a title, muted metadata, and a semantic link or button. Use the existing activity and retry UI. |

## Do's and Don'ts

- **Do** start with the closest live route and reuse its components, CSS variables, and interaction states. Treat local exceptions and older duplicate primitives as implementation context. Read production components before copying examples from `app/states/`.
- **Do** let artwork and the main action establish hierarchy. Give labels, status, and focus a predictable position across loading, selection, and narrow layouts.
- **Do** preserve scrolling and native insets. For new UI, check long titles, missing artwork, both themes, keyboard access, touch targets, and preference fallbacks using the project’s existing validation workflow.
- **Don’t** surround every poster, row, or settings section with a framed card. Avoid heavy shadows, a fixed movie-style hero on browsing pages, and saturated fills on routine controls.
- **Don’t** add a new font, global token, fixed-width wrapper, or parallel component kit to solve a local variation. Avoid hover-only actions, layout-shifting press feedback, and decorative motion on controls used repeatedly.
