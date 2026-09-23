# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.20] - 2026-09-22

### Changed
- **tps** — the reconstructed resume line is now inspectable: `/tps` shows it on demand (`TPS … · last turn: 󱐌90.0tps ↑1k ↓900 …`) instead of relying on the transient boot toast that was easy to miss. Reconstruction walks the active branch (`getBranch()`, `getEntries()` fallback).

## [0.3.19] - 2026-09-22

### Fixed
- **tps** — Per-run TPS notification now survives `--resume`: `session_start` reconstructs the LAST completed turn from session entries (user-entry ts → last-assistant-entry ts as the duration, matching live wall-clock semantics; assistant usage accumulated across tool-call rounds) and re-emits the same line, UTC day-rollover stamp included. A trailing aborted turn (user message with no response) no longer masks the last completed turn. Headless-tested against synthetic entries. New turns after resume were always measured correctly (`agent_end` carries only the run's new messages — verified in pi source); this fixes the missing historical line.

## [0.3.18] - 2026-09-22

### Changed
- **pi 0.87.1 compat pass — verified, no code changes needed.** status-align: `custom-editor.js` is byte-identical between 0.85.1 and 0.87.1 (md5 `bf8d80ac`); the #8799 indicator move touched only the default editor's border, not the CustomEditor seam we mirror — the earlier high-risk call was wrong. thought-label: full behavioral pass on real 0.87.1 components (headless probe: instrumentation, wave advance, italic strip, baked dims, pi-side `setHiddenThinkingLabel` writes all verified). minimal-mode: all seven tool factories still exported, `lastComponent` render contract intact, `renderResult(result, options, theme, context)` unchanged. Headers updated from "version-locked to 0.85.x" to "verified on 0.85.x + 0.87.1". Machines holding at 0.85.1 (claw-hub) may move to 0.87.1 when ready; oci-prime needed nothing.

## [0.3.17] - 2026-09-20

### Fixed
- **thought-label** — Wave no longer freezes after `/reload`: mutable wave state (phase, timer, started-at, tracked instances, turn flag, enabled toggle) moved onto the `globalThis` bag next to the TUI ref. Root cause of the stuck shimmer (only "nk" dimmed): /reload keeps the first generation's pinned prototype wrapper, so the new generation's `agent_start` ticked its own empty `tracked` set while the wrapper rendered its own phase-0 label — the trough never travelled. Any generation's timer now drives the label any generation renders; the `/thought-label` enabled toggle also survives reloads. Regressed and fixed under a two-generation headless test (jiti + shimmed component): pre-fix reproduces the frozen `n|k` bytes exactly, post-fix the trough travels.

## [0.3.16] - 2026-09-20

### Added
- **zai-search** — Collapsed one-liner rows for `zai_web_search`, matching minimal-mode's convention: call `✓ zai-search "query" ▸`, done `✓ zai-search "query" → 10 sources ▸`, failed `✗ … ▸`; expand (Ctrl+O or click) restores the full formatted result list. Glyphs reuse minimal-mode's tier resolution, so unicode/nerd/ascii machines all agree. Previously the tool fell through to pi's generic custom-tool card — the last multi-line block in an otherwise one-liner TUI.

## [0.3.15] - 2026-09-16

The whole 0.3.x line shipped on this day as one iteration arc — the
intermediate version numbers (0.3.0–0.3.14) were internal churn; only 0.3.15
is tagged. Described below is the final state.

### Added
- **minimal-mode** — v2 rewrite: compact, uniform one-liner summaries on top of pi's built-in renderers instead of replacing them. Collapsed rows are one muted line per call in every state — running `○ git clone … ▸`, done `✓ git status ▸`, failed `✗ npm test ▸` — while expand (Ctrl+O or click) restores the untouched built-in view: full command header, complete output, exact "Took X.YZs" timing. The `$ command` header stays suppressed from the moment execution starts, so long commands never wrap into a wall of text. Wrapped tools: bash, find, grep, ls, read, write, edit; everything else renders exactly as pi ships it. Promoted from a single file to `extensions/minimal-mode/`.
- **minimal-mode** — Glyph tier system: `unicode` (default, single-width glyphs shipped by pi's own TUI), `nerd` (opt-in PUA glyphs — never auto-detected, they render as tofu without a Nerd Font), `ascii` (dumb-terminal fallback). Resolution: `PI_GLYPHS` env → `NERD_FONT` env → `minimal-mode.json` → unicode, with per-glyph `overrides`.
- **minimal-mode** — Config in `~/.pi/agent/minimal-mode.json`: `bashPreview` (≈5 preview lines under the bash one-liner), `thinkingLabel` (hidden thinking blocks read `Thinking… ▸`), `statusColor` (color the ✓/✗ glyph green/red; default uniform muted).
- **minimal-mode** — Clicks: one left-click anywhere on a wrapped row toggles it; rapid re-clicks (<350ms) are debounced — on one-liners, expanded delegations, and bash preview lines alike.
- **minimal-mode** — Temporary debug instrumentation: `/minimal-debug` dumps renderer call counts and first errors (diagnostic build; removed once stabilized).
- **footer-path** — New extension: minimal footer `[machine] repo · branch`, worktree-aware, machine demoted to a dim bracketed tag (styles: `tag` default / `dot` / `glyph` / `none`). Probes once at session start for VMs (`systemd-detect-virt`), containers (→ `box`), SSH, and WSL; Nerd Font context icons with a unicode `▣` fallback, tier resolution matching minimal-mode. Toggle with `/footer-path`.
- **footer-path** — Renders a faithful replica of pi's token/context/model stats line (↑in ↓out, cache hit %, $cost, context window with warning/error coloring, right-aligned `(provider) model • thinking`) plus extension `setStatus` items — `setFooter()` replaces the built-in footer entirely, so the stats line must be rebuilt.

### Changed
- **minimal-mode** — One-liners carry no duration or line counts: the collapsed timer ticked unreliably (redraw-driven, measuring the execute wrapper rather than the tool) and disagreed with the built-in expanded "Took X.YZs", so timing belongs to the expanded view alone. find/grep/ls keep their result counts (`✓ grep /pat/ → 12 matches ▸`).

### Fixed
- **minimal-mode** — Restored sessions render restored rows as the single one-liner, identical to fresh ones: a stored-result check makes the collapsed call header yield even though per-process clock data is empty. (The first cut referenced an undeclared registry — `ReferenceError: resultsById is not defined` — and crashed pi on resume; fixed and defensively wrapped, so any future header-render error falls back to the built-in header instead of taking down the TUI.)
- **minimal-mode** — Custom row components no longer leak into the built-in renderers' `lastComponent` reuse chain, which made later built-in invocations throw and pi render a bare bold tool-name fallback line above collapsed rows.
- **footer-path** — Session name (when set) shows on line 1, matching built-in behavior.

### Known limitation
- minimal-mode summaries are per tool call: Amp-style cross-call grouping ("Ran 4 commands" collapsing several calls into one row) isn't expressible with pi's current per-call renderer hooks.

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
