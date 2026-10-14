# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.27] - 2026-10-13

### Fixed
- **session-summary** — Ladder walk-out on fatal provider errors: a 401/403 (region-blocked or rejected key) now rejects the **whole provider** for the session instead of burning one failed attempt per sibling ladder model — on machines with an unusable OpenAI key, the next gated turn reaches the inherit rung directly. Provider-level rejection never applies to explicit pins (a pinned model failing is the user's call to fix). Error extraction now parses the JSON payload embedded in provider messages ("OpenAI API error (403): {…}" previously leaked the whole prefixed string into the warning) and handles top-level `code` fields — warnings now read `unsupported_country_region_territory`, not a JSON blob.

## [0.3.26] - 2026-10-13

### Added
- **session-summary** — New extension, forked from pasky/pi-session-summary 1.0.2 (MIT): a one-line LLM session summary set as the session name, so `/resume` and the status bar show what the session is about instead of the first user prompt. Fork changes: (1) a decision-model gate (`decision-gate.ts`) that decides materiality before spending a summarizer call — a unified provider registry (`decisionGate.specs` pre-seeded with built-in presets: Liquid d1:free, TypeSafe Jev, Vercel AI Gateway YES/NO chat shim; customs merge over them, so adding a decision model is one specs entry + one env var, keyless for local endpoints). The chain cycles active providers in `decisionGate.providers` order with per-provider timeout overrides and 3-strike session disable; no active provider degrades silently to stock behavior. Confident no-op turns skip the LLM entirely (names stop churning), topic drift escalates to a full re-summarize; (2) incremental prompts now embed only the delta since the last summary (upstream embedded the full conversation in both prompt shapes); (3) resume no longer spikes a full re-summarize on the first post-resume turn (upstream reset the covered-token baseline to 0 on session start); (4) manual `/name` is never overwritten until `/summary:clear`. Commands: `/summary:settings`, `/summary:update`, `/summary:clear`, `/summary:cost` (now counts gate calls), `/summary:gate` (provider readiness in cycle order + dry-run verdict), `/summary:lock` (toggle: freeze the current summary without renaming; per pi-instance — restart/reload resumes auto). Zero-config summarizer resolution: pin (`provider` + `model`, pi-title-style `:effort` suffix — `zai/glm-5.3-flash:high` — default effort minimal) → cheap-model ladder → the session's own model (inherit: always has a working key, prompt never leaves providers already in use); `/summary:settings` materializes everything except the inherit rung (stays dynamic). First-run whisper: one toast per pi process when the first summary lands. Upstream's no-model error is now actionable, and a gate crash degrades to stock behavior instead of stalling summaries.


## [0.3.25] - 2026-10-13

### Added
- **footer-path** — Worktree fleet + active-tree badge. The footer read `main` all day while subagents carried the actual work in `.worktrees/*`; now the chain shows what exists and what's moving. Fleet count: linked worktrees render as `+N⑂` after the branch (`main · +2⑂`), from `git worktree list --porcelain` — the session's own toplevel, bare entries, and detached HEADs excluded, so only worktrees holding a real branch count; glyph semantics split (`⑂`/fork = worktrees, `⎇`/git-branch = branches, ascii `wt:`/`br:`), and a worktree session collapses to one glyphed segment when dir and branch names match. Active mode (`"worktrees": "active"`): the tree where git moved most recently — reflog + index mtime, verified that worktree HEAD does NOT move on commit — wears a `⚑dir` badge while `main` stays bare (the badge accompanies the session truth, never replaces it). Freshness: snapshot at session start, filesystem watch on git's worktree metadata (FSEvents recursive watches can miss newly created subdirs) plus a 30 s reconcile bound it — neither ever runs in the render path. Also fixed a latent gitInfo bug the probe caught: gitDir vs commonDir compared as raw strings while git canonicalizes outputs (macOS `/var` → `/private/var`), making every root session on a symlinked path render a phantom `⑂.git` segment — both sides now realpath'd. `/footer-path:icon` sets the glyph tier (`unicode | nerd | ascii`, no args cycles), persists to footer-path.json, warns on `PI_GLYPHS`/`NERD_FONT` env overrides. Verified with two headless jiti harnesses — 10 checks (modes, badge follow, collapse, divergence, watcher convergence, degradation) and 16 checks (icon command) — all green.

## [0.3.23] - 2026-10-09

### Changed
- **zai-search** — Queued rows (registered, not yet executing) now render `…` instead of `✓`, matching minimal-mode's collapsed-from-birth convention — a check glyph on a call that hadn't run falsely claimed success. Running (`○`) and done rows unchanged.
- **minimal-mode** — Collapsed rows are now one-liners from the first frame: a queued call (`… cmd ▸`) renders while args stream or the call awaits its turn, flipping to the `○` running line when execution starts. Previously the built-in `$ command` header flashed until execution began — visible on every call, and stacking into bold walls when one message queued several calls. statusColor keeps queued rows muted (nothing has happened yet). Expand-mid-run elapsed timing is unaffected: the built-in renderCall still seeds its clock state underneath.

## [0.3.22] - 2026-10-08

### Removed
- **pi-oauth-qwen** — Retired the suspended extension from the repo (had been dormant since the [Qwen free OAuth tier ended April 15, 2026](https://github.com/QwenLM/qwen-code)). Code recoverable from git history if a reactivation path appears.

## [0.3.21] - 2026-09-22

### Changed
- **tps** — `/tps` gained subcommands: `/tps show` re-emits the reconstructed line without touching the toggle (the v0.3.20 behavior flipped notifications on every inspection press — the double-press wart), `/tps on` / `/tps off` set state explicitly, bare `/tps` keeps toggling as before.

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
