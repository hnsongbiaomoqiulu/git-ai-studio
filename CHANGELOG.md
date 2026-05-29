# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Version bumps are manual — see [CONTRIBUTING.md](CONTRIBUTING.md#releasing-a-new-version-maintainer-only) and [ADR-008](docs/adr/0008-conventional-commits-release-tool.md).

## [Unreleased]

## [0.2.0] - 2026-05-29

### Added

- Desktop companion ("Ink pet") — an opt-in (default off), always-on-top floating widget that renders your live AI-authorship rate as a two-tone ink ball: purple ink (AI) on the outer ring, blue ink (you) at the core, so the shape *is* the data (color + position dual-encoded, colorblind-readable). Ships 3 built-in themes and a hover bubble; only the daemon-unhealthy state may raise an OS notification. See [ADR-011](docs/adr/0011-desktop-companion-ink-pet.md).

## [0.1.0] - 2026-05-29

### Added

- Initial open-source release: a local desktop dashboard for AI code authorship, built on top of the [`git-ai`](https://github.com/git-ai-project/git-ai) CLI.
- Views: Dashboard, Commits (per-commit stats), People (per-author), Blame (line-level), git notes, Checkpoints.
- Official `git ai install-hooks` integration for Claude Code / Cursor / Codex / OpenCode.
- Bilingual UI (Simplified Chinese / English) via i18next, with an in-app language switcher.
- macOS (universal `.dmg`), Linux (`.AppImage` + `.deb`, x86_64 + ARM64), and Windows (`.msi`) builds.
- OS-native notifications (via `tauri-plugin-notification`) for low AI-share and daemon-health alerts — opt-in, no webhook, no cloud.
- `refs/notes/ai` fetch/push sync through the upstream CLI.

### Changed

- UI restyled to a Linear-inspired minimal aesthetic on Tailwind v4 + shadcn/ui.

### Removed

- Self-hosted hook server (Windows scheduled task + VBS shim + Node HTTP server). Hooks now go exclusively through the official `git ai install-hooks`.
- Feishu webhook push (replaced by OS-native notifications).

[Unreleased]: https://github.com/bujueyunjian/git-ai-studio/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/bujueyunjian/git-ai-studio/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/bujueyunjian/git-ai-studio/releases/tag/v0.1.0
