# ADR-011 · Desktop companion (Ink pet)

**Status**: Accepted (amended 2026-05-29)
**Date**: 2026-05-29

## Amendment (2026-05-29) — image-based character themes + prominent alerts

After building the Canvas2D ink-blob (Axis-2 Option 2A below), user testing
rejected it on aesthetics: a programmatic blob reads as "a shape with two eyes,"
not a character. We pivoted the **rendering** and **theme** model while keeping
every load-bearing invariant intact.

- **Drawing — supersedes Axis-2 2A.** The creature is now a real character
  rendered from a **transparent PNG** (AI-generated, background removed locally
  with a chroma-key pass), composited in Canvas2D. Data still drives pixels: a
  **two-tone progress ring** is drawn on the character's body (robot chest /
  ink-beast scroll) — purple arc = AI share, blue arc = you. "Form-is-data"
  (sub-decision 1) is preserved but its carrier moves from the blob's radial
  gradient to an overlaid ring. This is **not** Option 2D (pre-baked frames
  driven by nothing): the ring, the whole-body tint, and the shake are all
  live-data-driven; the PNG is only the skin.
- **Information layer locked harder — sub-decision 1 strengthened.** The two
  semantic colours `INK_AI` (purple) / `INK_YOU` (blue) are now **global
  constants**, not per-theme slots — a character theme cannot pick the ring
  colours at all, only the skin and the ring's position. Stronger than the
  original "theme fills two slots" contract.
- **Themes are now characters, not palettes — supersedes sub-decision 6.** v1
  ships three **form** themes — `robot3d` (3D 机器人), `robotflat` (扁平机器人),
  `inkbeast` (水墨灵兽) — each a set of 4 pose images (idle / happy / sleep /
  alert) + a ring position. The 7 logical states map onto the 4 poses plus
  programmatic effects (tint / shake / pulse), via the pure `visualForState`.
- **Alerts are now prominent + configurable — supersedes sub-decision 5.** The
  original "only `daemon_unhealthy` may notify, everything else is silent ink"
  restraint was reversed on explicit user request ("alerts must be obvious — on
  attribution failure the whole robot turns red"). Abnormal states now tint the
  **whole character** (`attribution_failed` = red, `daemon_unhealthy` = grey,
  `hook_missing` = yellow), shake, and show a **persistent text bubble**, and
  re-pulse on a **user-configurable interval** (`pet.alert_interval_sec`, 0 =
  announce once, no repeat). Restraint is preserved as a *setting* rather than a
  hard rule: the user can lengthen the interval or disable repeats. Honesty is
  unchanged — a failed attribution is shown as the alert pose + red wash, never
  prettied over.
- **Settings shape grows — extends sub-decision 7.** `pet` now also carries
  `size` (small / medium / large), `opacity`, and `alert_interval_sec`; the pet
  window applies size via `setSize` (new `core:window:allow-set-size` grant).

The original text below is retained as decision history; the asset-pipeline
trade-off in Axis-2 2A/2D is the part this amendment revisits.

## Context

`git-ai` is silent infrastructure. The hook, the daemon, and the per-commit
attribution all run in the background; the user never *feels* them working.
Whether the hook is installed, whether the daemon is alive, whether the last
commit was attributed, what this week's AI share is — all of it is invisible
unless the user actively opens the Studio Dashboard and goes looking. The long
tail never looks.

We want an **opt-in, always-on desktop companion** that surfaces git-ai's
*attribution health* in the corner of the screen — ambient, quiet, glanceable —
so the user knows the system is working (or not) without opening anything.

The form is an **ink-drop creature ("墨 / Ink pet")**: a soft, translucent blob
with two inks slowly diffusing inside it. This is not decoration grafted onto a
status indicator. The form **is** the data:

- **Purple ink = AI**, rendered in the **outer halo / upper region**.
- **Blue ink = you (human)**, rendered in the **inner core / lower region**.
- The **ratio of the two ink fields = the live AI share**.

A glance at the blob tells you this week's human/AI split without reading a
number. This "form-is-data" property is the entire differentiator and the one
invariant the rest of this ADR exists to protect.

**Scope guard.** The pet is a *cosmetic, optional layer*. It is off by default,
toggled in Settings, and **removing it changes no core Studio behaviour**. It
adds **no** network calls, **no** telemetry, **no** upstream coupling — it
consumes only data the existing watchers already compute locally. This keeps it
inside the PR-FAQ positioning (local-only, single-developer, not affiliated with
the upstream Git AI commercial product). If upstream ships an official GUI, the
pet is the first thing we can drop without touching the core.

**Prior art we explicitly do NOT copy.** `clawd-on-desk` is an Electron desktop
pet that reacts to AI-agent *session* state. It is **AGPL-3.0**, and its artwork
is *all rights reserved*. We treat it as category prior art only — **no code,
no assets, no character design is borrowed**. Our creature, its ink metaphor,
and its form-is-data behaviour are original. The thing clawd does *not* do —
make the mascot's appearance encode the underlying data — is precisely our
design center.

## Options considered

Two orthogonal axes had genuine multi-way trade-offs: **where the pet renders**
and **how the blob is drawn**.

### Axis 1 — Rendering surface

#### Option 1A · A second, transparent `WebviewWindow` *(chosen)*

A dedicated `pet` window: `transparent: true`, `decorations: false`,
`alwaysOnTop: true`, `skipTaskbar: true`, declared statically in
`tauri.conf.json` with `visible: false` and shown on demand.

- Pros: true floating overlay anywhere on screen; independent of the main
  window's show/hide/tray state; the canonical Tauri desktop-pet shape (see
  WindowPet, CrabNebula tutorial below).
- Cons: a second webview = a second JS context; naive implementation would
  re-run every watcher query (solved by Axis-3 data-flow decision); the existing
  single-window `CloseRequested` handler must grow a multi-window match.

#### Option 1B · An overlay layer inside the main window

A floating element rendered inside the existing `main` window.

- Pros: zero new window, zero IPC, shares the React tree and react-query cache.
- Cons: cannot float over *other* apps — it dies the moment the user alt-tabs
  away or minimises Studio to tray, which is the exact moment the ambient signal
  is most useful. Defeats the purpose.

#### Option 1C · Animated system-tray icon

Encode state into the tray icon.

- Pros: cheapest; no window at all.
- Cons: a 16–22 px tray glyph cannot carry a two-ink ratio legibly; no hover
  bubble, no character, no "form-is-data". Reduces to a colour dot.

### Axis 2 — Drawing technology

#### Option 2A · Canvas2D, programmatic *(chosen)*

Draw the blob with `createRadialGradient` + compositing in a `<canvas>`.

- Pros: **zero new dependency**, zero added bundle weight (matters for a desktop
  binary, ADR principle #4); ratio-driven rendering is just shifting gradient
  color-stops; 7 states are draw-param changes, not asset swaps; trivial to
  throttle/stop the RAF loop when idle/hidden. No artwork pipeline → no license
  surface.
- Cons: true fluid "swirl" needs hand-rolled noise; v1 ships static radial
  diffusion and defers Perlin/fluid to a later iteration.

#### Option 2B · WebGL (regl / three / pixi)

- Pros: best fluid/particle fidelity (ripples, splatter, diffusion) via shaders.
- Cons: 150–200 KB+ min bundle on top of an app that already carries CodeMirror
  + Recharts; GPU idle power on an always-on window is *not* better than a
  throttled Canvas2D loop. Over-built for v1. Flagged as the upgrade path *iff*
  we later want heavy particle effects.

#### Option 2C · SVG + CSS

- Pros: declarative, compositor-driven, light.
- Cons: `feTurbulence` fluid is unstable across WebKitGTK/WebView2; gradient
  stops can't express positional ink-field control precisely; state transitions
  mean mutating SVG nodes — more awkward than a redraw loop.

#### Option 2D · Lottie / GIF sprites

- Pros: rich pre-authored motion.
- Cons: pre-baked frames **cannot** be driven by a live ratio — it breaks
  form-is-data outright — and reintroduces the artwork/license pipeline we chose
  Canvas2D to avoid. This is the clawd approach; rejected for exactly the reason
  clawd can't show data in its mascot.

## Decision

**Chosen surface: Option 1A** (second transparent `WebviewWindow`).
**Chosen drawing: Option 2A** (programmatic Canvas2D, static radial diffusion in
v1).

Plus the following binding sub-decisions, each carrying its own rationale:

1. **Information layer vs aesthetic layer — split and lock the information
   layer.** This is the load-bearing decision. A theme may freely change *what
   the ink looks like* (the two colours, texture, shape, motion); a theme may
   **never** change *what the ink means* (the color→data mapping). The contract
   between the two layers is exactly two required slots — `inkAI` and `inkYou` —
   and the renderer only ever asks a theme for those two slots. *Reasoning:*
   form-is-data is the entire moat. If a user could remap "purple = AI" to any
   hue, the blob would stop being readable as data and we'd collapse into a
   generic reskinnable pet (the clawd category). Locking the mapping is what
   keeps us a *mirror of your human/AI ratio* rather than a sticker. Concretely,
   the theme contract is exactly `{ inkAI, inkYou }` (each a CSS colour) — the
   renderer reads only those two keys; a theme may not add, remove, reorder, or
   remap the slots. This is a *contract* constraint, not a UI one: the future
   v2 theme-file schema must never expose a key that swaps or overrides what
   each ink means. A contributor proposing to relax this carries the burden of
   explaining why the creature would still mirror the ratio rather than become a
   reskinnable pet.

2. **Accessibility invariant: dual encoding by position AND colour.** AI ink is
   *always* the outer/upper field; human ink is *always* the inner/lower core.
   So a colour-blind user (or a theme with low chroma contrast) can still read
   the ratio by spatial extent, not hue alone. Themes inherit this; they pick
   colours, not positions.

3. **Unidirectional data flow — the main window computes, the pet renders.**
   The pet window does **not** query git-ai. A `PetController` mounted in the
   main window (alongside the existing `DaemonWatcher` / `LowAiShareWatcher`)
   reuses their react-query data, runs one pure reducer `decidePetState(...)`,
   and `emit`s `git-ai-studio://pet-state` to the pet window, which is a thin
   renderer. *Reasoning:* avoids a second webview re-polling git-ai (duplicate
   subprocesses, cache skew); keeps a single source of truth; reuses the
   `refetchIntervalInBackground` watchers that already run while the main window
   is hidden to tray. No new polling is introduced.

4. **No selective click-through in v1.** Tauri's `setIgnoreCursorEvents` is a
   *whole-window* boolean — there is no per-region pass-through (tauri-apps/tauri
   #13070). Emulating it by polling the cursor at ~60 fps and toggling the flag
   races the OS: on Windows `WS_EX_TRANSPARENT` lets in-flight mouse messages
   fall through before the flag clears ("can't click the pet"), and Wayland
   support is unverified. v1 ships a small, always-clickable window sized tight
   to the blob to minimise occlusion. Selective pass-through is deferred to a
   later iteration behind a per-platform capability probe.

5. **Notification discipline — exactly one state may raise an OS notification.**
   Only `daemon_unhealthy` is "important AND the user can act now", and it reuses
   the existing `DaemonWatcher` debounce (two consecutive same-issue observations
   + dismiss cooldown). Every other state — `hook_missing`, attribution gaps,
   `low_ai_share`, `attribution_failed` — speaks **only** through ink form and an
   on-hover bubble. *Reasoning:* an always-on companion that pops toasts is
   Clippy; restraint is the respect (matches the project's "speak only when the
   user can act" norm). Honesty is preserved the other direction too: a failed
   attribution shows as un-merged splattered ink — never prettied over — in line
   with the "fail loudly, no fallback" rule.

6. **Themes in v1 are built-in constants, not a file system.** v1 ships **three**
   curated dual-ink palettes — `daishan` (黛山, default), `xuan` (玄, mono/high
   contrast), `qing` (晴, colour-blind-safe blue/orange) — as TypeScript
   constants. No `~/.git-ai-studio/themes/*.json` loading, no SVG sanitisation,
   no user-authored skins yet. *Reasoning:* the user asked for "not monochrome /
   multiple choices / good aesthetics / colour-blind support", and under the
   radial-gradient renderer a theme is *just a few colour constants* — the
   marginal cost of three vs one is ~0 (unlike clawd, where each theme is a
   hand-drawn GIF set). A full theme-file engine is the over-built part and is
   deferred. This is a deliberate, scoped deviation from the reviewer suggestion
   of "two themes": three covers refined / plain / accessible at no extra cost. The three palettes
   (`inkAI` / `inkYou`): `daishan` = `#7C6BD6` / `#3A8FB7` (dusk-violet /
   dai-cyan, refined default); `xuan` = `#8A8FA3` / `#2B2E3B` (light / heavy ink,
   mono high-contrast); `qing` = `#3B82C4` / `#E08A3C` (lake-blue / warm-amber,
   colour-blind-safe). Position encoding (AI outer/upper, you inner/lower) is the
   constant across all three; only the colours vary.

7. **Settings shape.** A nested `pet { enabled, theme_id, position }` on
   `AppSettings` (mirrors the existing `NotificationsConfig` nesting), exposed
   through the flat patch API in `commands/settings.rs`. OS-integration truths
   are read live; only persistent prefs live here.

8. **Window lifecycle.** The `pet` window is declared statically in
   `tauri.conf.json` (`label: "pet"`, `visible: false`) and shown when
   `pet.enabled`. The current single-window `CloseRequested` handler (an `if`
   on `label == "main"`) becomes a `match`: the `main` arm keeps the existing
   close-to-tray behaviour; the `pet` arm calls `hide()` (never `destroy()`),
   so toggling the pet back on is instant. When the process exits (main closed in
   exit mode, or tray → quit), the OS reclaims the pet window with it, so no
   explicit teardown is needed. Tests must assert the two windows' close events
   stay isolated.

**Layering / version roadmap:**

- **v1**: this ADR — second window, Canvas2D, 3 built-in themes, 7 states,
  hover + click + drag + context menu, no pass-through.
- **v1.x**: selective click-through (per-platform probe), Perlin fluid
  diffusion, dual-colour fine-tune slider with a contrast guard, more themes.
- **v2**: user-authored theme files / community skins (information layer still
  locked: a skin defines *appearance*, never the mapping).

**Re-evaluate when**: (a) telemetry-free usage signals show users heavily want
custom skins → bring v2 forward; (b) upstream ships an official GUI → the pet is
the first candidate to drop or backport; (c) a platform's transparent/topmost
overlay proves unworkable in testing → that platform degrades to an opaque
docked card, not a blocker for the others.

## Consequences

### Positive

- Ambient attribution health with zero extra network and zero new polling — it
  rides the watchers that already run.
- A genuinely original mascot: appearance encodes live data, which the prior-art
  Electron pet structurally cannot do. No copied code or assets; MIT-clean.
- Aesthetic + accessible by construction (three palettes incl. a colour-blind-safe
  one; position+colour dual encoding).
- Cosmetic and optional: off by default, removable without touching core Studio.

### Negative

- A second webview window grows the `CloseRequested` handler from a single-window
  `if` into a multi-window `match`; the `pet` window's close means *hide*, and
  its lifecycle must coordinate with the tray close-behaviour. Test coverage must
  assert the two windows' close events stay isolated.
- Realistic cost is **~150–200 LOC Rust + ~600–1000 LOC frontend**, not the
  "few lines of glue" first imagined. Recorded here so the estimate is honest.
- Transparent + always-on-top + (later) click-through carry per-platform risk:
  WebView2 transparency on older Windows builds, Wayland pass-through, multi-
  monitor z-order. v1 sidesteps the worst (no pass-through) and documents the
  rest as known limitations.

### Neutral / TODO

- Record the form-is-data invariant and the OS-notification whitelist in
  `CLAUDE.md` so future contributors don't "improve" the pet by unlocking the
  colour mapping or adding toasts.
- Keep `decidePetState` a pure, unit-tested reducer (mirrors the existing
  `decideDaemonNotification` / `decideLowAiShareNotification` pattern) so state
  arbitration is testable without a window.
- `attributing` needs a live signal; reuse the existing
  `git-ai-studio://notes-updated` fs-event the realtime AI-share path already
  emits, rather than inventing a new one.
- Before merge: add the pet's i18n strings (Settings toggle, theme picker,
  per-state hover bubbles) in `zh-CN` + `en`, and document the pet's known
  platform limits (WebView2 transparency on older Windows; Wayland multi-monitor
  z-order) plus its opt-in / no-network stance in both READMEs.

## References

- WindowPet — a Tauri + React desktop-pet overlay, Win/macOS/Linux (proves the
  shape is viable on our exact stack):
  <https://github.com/SeakMengs/WindowPet>
- CrabNebula — "Building and Distributing a Desktop Pet with Tauri" (the Tauri
  core team's own walkthrough):
  <https://crabnebula.dev/blog/building-a-desktop-pet-with-tauri/>
- `clawd-on-desk` — Electron desktop pet, category prior art only; **AGPL-3.0,
  artwork all-rights-reserved — not copied**:
  <https://github.com/rullerzhou-afk/clawd-on-desk>
- Tauri v2 window customization (transparent / decorations / always-on-top):
  <https://v2.tauri.app/learn/window-customization/>
- Whole-window-only `setIgnoreCursorEvents`; selective pass-through feature
  request (basis for deferring click-through):
  <https://github.com/tauri-apps/tauri/issues/13070>
- `cc-switch` — peer precedent for the watcher + Tauri-event push architecture
  this project already follows (see ADR-010 references):
  <https://github.com/farion1231/cc-switch>
