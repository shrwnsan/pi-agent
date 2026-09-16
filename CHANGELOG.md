# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.15] - 2026-09-16

### Changed
- **minimal-mode** — Dropped the duration segment from one-liner rows (`✓ git status · 0.3s ▸` → `✓ git status ▸`, running `○ git clone … · 3.2s ▸` → `○ git clone … ▸`). The collapsed timing was unreliable (it only ticked on redraws and measured the execute wrapper, not the tool) and disagreed with the built-in expanded timer ("Took X.YZs"). Timing now belongs to the expanded view alone. Removed the dead `durations` clock and `seconds()` helper; `starts` remains so the running line can keep the built-in header suppressed.

## [0.3.14] - 2026-09-16

### Fixed
- **minimal-mode** — Crash on session resume: `ReferenceError: resultsById is not defined` in the collapsed live-header render took down the whole TUI (uncaughtException). v0.3.13 added the `resultsById.has(...)` consumer but never declared the set nor populated it. The set is now declared per extension instance and populated in every `renderResult` for final (non-partial) results — which covers restored-session rows, since pi replays the same render hooks on restore. The live-header render is also wrapped defensively: any future error falls back to the built-in header and is recorded via `/minimal-debug` instead of crashing pi.

## [0.3.13] - 2026-09-16

### Fixed
- **minimal-mode** — Restored-session tool rows rendered as two lines (built-in-style header + one-liner). Root cause: restored rows have no session-clock data, so the call header fell into its pre-start branch and drew the built-in-style header above the one-liner from the result region. The header now yields whenever a stored result exists — restored done rows collapse to the single `✓ … ▸` line, same as fresh ones.

## [0.3.12] - 2026-09-16

### Added
- **minimal-mode** — Temporary renderer instrumentation: render calls/results are counted per tool, and the first error from every delegated/expanded render is captured. `/minimal-debug` dumps the state; new errors also append to `~/.pi/agent/minimal-debug.log`. Diagnostic build for the expanded-rows report — will be removed once root-caused.

## [0.3.11] - 2026-09-16

### Fixed
- **minimal-mode** — The bold tool-name fallback line (`bash` / `read` / `write` / `edit`) above collapsed one-liners is gone. Root cause: built-in renderers reuse `context.lastComponent` and call methods on it (bash: `setText`); once minimal-mode's custom component was stored there, every later built-in invocation threw `TypeError`, and pi's `catch` rendered `createCallFallback()` — the bare bold tool name. All delegations now pass `{...context, lastComponent: undefined}` so built-ins rebuild their own components cleanly.

## [0.3.10] - 2026-09-16

### Reverted
- **minimal-mode** — Reverted v0.4.0 (`lastComponent` isolation rewrite): it regressed to rendering full raw output for every wrapped tool (as if Ctrl+O were stuck). Rolled back to the v0.3.9 behavior — right UX, with the known cosmetic tool-name fallback line. The `lastComponent` fix will return once it passes an offline render harness.

## [0.4.0] - 2026-09-16

### Fixed
- **minimal-mode** — Collapsed rows showed a bold tool-name line (`bash` / `read` / `write` / `edit`) above the one-liner. Root cause: built-in `renderCall` implementations reuse `context.lastComponent` and call methods on it (e.g. `setText`) — but after our custom component was stored there, those calls threw `TypeError`, and pi's `catch` fell back to the bare tool name. Expanded delegations now pass a clean context (`lastComponent: undefined`) so built-ins rebuild their own components; our custom components never leak into `lastComponent` again. The collapsed `✓ one-liner ▸` is now the ONLY line — no label, no header.
- **minimal-mode** — Bash bashPreview lines and expanded delegations are click-debounced like the one-liners.

## [0.3.9] - 2026-09-16

### Fixed
- **minimal-mode** — Rapid clicks on a wrapped row (e.g. a habitual double-click) toggled the block twice and cancelled themselves out, reading as "clicking does nothing". Left-clicks within 350ms per tool call are now debounced: the first click toggles, follow-ups inside the window are swallowed.

## [0.3.8] - 2026-09-16

### Changed
- **minimal-mode** — Expanded rows simplified to pi's built-in rendering only (full command header + complete output). The `▾` summary line between header and output is gone — expand/collapse now reads as two clean states: one-liner ↔ built-in view. Collapse affordances remain the one-liner caret, built-in hints, and click/Ctrl+O.

## [0.3.7] - 2026-09-16

### Added
- **minimal-mode** — Rows now collapse **while running**, not just after completion: `○ git clone … · 3.2s ▸` with live elapsed time (ticking via partial updates — bash throttles at ~100ms; tools without partial updates may only refresh on completion). Expanding while running shows the built-in streaming preview as before. New `running` glyph (`○` unicode / NF circle-o-notch / `o` ascii), overridable like the rest.
- **minimal-mode** — Durations now shown for find/grep/ls/read/write/edit collapsed rows too (`✓ edit src/foo.ts · 0.1s ▸`), not just bash.

## [0.3.6] - 2026-09-16

### Changed
- **minimal-mode** — Row lines are now uniform single-color (muted), including the ✓/✗ glyph. Line counts dropped from bash summaries (inaccurate vs visible output); duration stays. Opt back into colored status glyphs with `"statusColor": true`.
- **minimal-mode** — `read`, `write`, and `edit` now get the same single-line collapsed treatment (`✓ edit src/foo.ts ▸`) with the header suppressed after completion; expanding restores the built-in header + diff preview below the `▾` summary line.

## [0.3.5] - 2026-09-16

### Fixed
- **minimal-mode** — Collapsed bash/find/grep/ls rows showed the `$ command` header above the one-liner (duplicated content). Root cause: pi caches the renderCall component (lastComponent pattern) and does not re-invoke renderCall when the result lands, so the previous "return empty when completed" check never ran again. renderCall now returns a live component whose render() checks completion at draw time — the header disappears on the next frame after completion, regardless of whether renderCall is re-invoked.

## [0.3.4] - 2026-09-16

### Changed
- **minimal-mode** — Expanded tool rows keep the summary line with the caret flipped to `▾` above the full output (`✓ 0.3s · 4 lines ▾`), so collapse/expand reads as one stateful disclosure row. The command/query is omitted from the expanded summary — the built-in header above it shows the full command. Thinking labels are unaffected (they only render when hidden).

## [0.3.3] - 2026-09-16

### Changed
- **minimal-mode** — Collapsed rows are now a single dim line per tool call: `✓ git status · 0.3s · 4 lines ▸`. The `$ command` header is suppressed once the result lands, so long commands no longer wrap into multi-line walls. find/grep/ls summaries include the query (`✓ grep /pat/ → 12 matches ▸`).
- **minimal-mode** — Hidden thinking blocks now read `Thinking… ▸` (caret included; label configurable via `"thinkingLabel"` in `~/.pi/agent/minimal-mode.json`).

### Added
- **minimal-mode** — `thinkingLabel` config key.

### Known limitation
- Summaries are per tool call. Amp-style cross-call grouping ("Ran 4 commands" collapsing several calls into one row) is not expressible with pi's current per-call renderer hooks.

## [0.3.2] - 2026-09-16

### Fixed
- **footer-path** — `setFooter()` replaces the *entire* built-in footer, which silently dropped pi's token/context/model stats line. The footer now renders two lines: the compact `[machine] repo · branch` path plus a faithful replica of the stats line (↑in ↓out R/W cache tokens, CH cache-hit %, $cost, context %/window with warning/error coloring, right-aligned `(provider) model • thinking`), rebuilt from the documented extension data path (`ctx.getContextUsage()`, `ctx.sessionManager.getEntries()`, `ctx.model`, `ctx.thinkingLevel`). Extension `setStatus` items still render on a third line.
- **footer-path** — Session name (when set) now shows on line 1, matching built-in behavior.

## [0.3.1] - 2026-09-16

### Added
- **footer-path** — Virtualization probes: VMs via `systemd-detect-virt -v` (label = short hostname), non-Docker containers via `-c` (label = `box`), WSL via `WSL_DISTRO_NAME`/`/proc/version` (label = `wsl`). All run once at session start alongside the git probe.
- **footer-path** — `machineStyle` display config in `~/.pi/agent/footer-path.json`: `"tag"` (new default — dim bracketed `[box] repo · branch`, machine demoted to metadata), `"dot"` (previous behavior), `"glyph"` (icon + label), `"none"`.
- **footer-path** — Nerd Font context icons for glyph style: cube (container), server (SSH), desktop (VM), tux (WSL); unicode tier uses `▣`. Tier resolution matches minimal-mode (`PI_GLYPHS` → `NERD_FONT` → config → unicode).

### Changed
- **footer-path** — Default machine display changed from a plain chain segment (`box · dotfiles · main`) to a dim bracketed tag (`[box] dotfiles · main`); previous style remains available as `"machineStyle": "dot"`.

## [0.3.0] - 2026-09-16

### Changed
- **minimal-mode** — v2 rewrite: shrunk to additive-only summaries on top of pi's built-in renderers. Dropped overrides of built-in headers for bash/write/edit/find/grep/ls (built-ins now include duration, diff previews, and syntax highlighting).
  - bash: collapsed status line `✓ 1.2s · 132 lines ▸` (output hidden until expanded; opt into a preview with `"bashPreview": true`)
  - find/grep/ls: collapsed count summaries `✓ → 12 matches ▸` instead of the built-in 20 raw lines
  - failures show `✗` with the first error line
  - read, write, edit: intentionally untouched (built-in read cards, write highlighting, and edit live diff previews are superior)
- **minimal-mode** — Promoted from single file to package: `extensions/minimal-mode/{index.ts, glyphs.ts, README.md}`.

### Added
- **footer-path** — New extension: minimal footer `machine · repo · branch`, worktree-aware. Machine label appears only off-machine (SSH → short hostname, container → `box`, override via `FOOTER_MACHINE_NAME`). Worktree names derive from the `.worktrees/` path segment. Git probe runs once at session start; branch updates via `footerData.onBranchChange()`. Toggle with `/footer-path`. Token stats intentionally excluded — `tps` owns those.
- **minimal-mode** — Glyph tier system: `unicode` (default, single-width glyphs shipped by pi's own TUI), `nerd` (opt-in Font Awesome PUA glyphs), `ascii` (dumb-terminal fallback). Resolution order: `PI_GLYPHS` env → `NERD_FONT` env → `~/.pi/agent/minimal-mode.json` → unicode. Per-glyph `overrides` supported. unicode glyphs on a Nerd Font terminal look fine; nerd glyphs without the font render as tofu — so auto-detection never guesses upward.

## [0.2.0] - 2026-05-31

### Added
- **answer** — Interactive Q&A extraction extension (`/answer`). Extracts questions from the last assistant message via LLM, then presents them as a navigable list for answering one-by-one. Inspired by [sids/pi-extensions/answer](https://github.com/sids/pi-extensions/tree/main/answer), reimplemented from scratch due to an unresolvable `workspace:^` dependency on `@siddr/pi-shared-qna` that made the upstream package installable via neither npm nor git source.
- **tps** — `/tps` toggle command to enable/disable TPS notifications without reload.

### Changed
- Modernized all imports from `@mariozechner/*` to `@earendil-works/*` for v0.78.0 compatibility.
- **minimal-mode** — Uses v0.78.0 `ToolRenderContext` (`context.lastComponent`) for DOM reuse instead of creating new `Text` components on every render.
- **minimal-mode** — Removed read tool override. v0.78.0 built-in compact read cards (smart file classification, OSC 8 hyperlinks) are superior.
- **minimal-mode** — Removed stale tool cache; tools are now created fresh via `ctx.cwd`.
- **tps** — Removed manual `isAssistantMessage` type guard; uses direct `message.role !== "assistant"` check.

## [0.1.0] - 2026-04-15

### Added
- **tilde-path** — Rewrites CWD in system prompt to use `~` notation.
- **minimal-mode** — Collapsed/expanded tool view toggle (Ctrl+O).
- **tps** — Tokens/sec and usage stats notification after each agent run.
- **pi-oauth-qwen** — OAuth provider for Qwen models via device code flow with PKCE.

### Suspended
- **pi-oauth-qwen** — [Qwen's free OAuth tier ended April 15, 2026](https://github.com/QwenLM/qwen-code). Code preserved for potential future reactivation.
