# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.28] - 2026-10-15

### Changed
- **session-summary.** `showWidget` config key renamed to **`debugWidget`** (release bookkeeping for #28, which shipped without an entry or bump; the old key is silently ignored, and `"debugWidget": true` restores the below-editor status line).
- **footer-path.** The session-name footer segment is now **opt-in**: `"showSessionName": true` in `~/.pi/agent/footer-path.json` (default false). Session summaries live in `/resume` and the native name slot, so the footer no longer duplicates them by default.

## [0.3.27] - 2026-10-13

### Fixed
- **session-summary.** Fatal provider errors now remove the whole provider from the summarizer ladder: a 401/403 (region-blocked or rejected key) rejects the **whole provider** for the session instead of one failed attempt per sibling model. On machines with an unusable OpenAI key, the next gated turn goes straight to the session's own model. Provider-level rejection never applies to explicit pins (a pinned model failing is the user's call to fix). Error extraction now parses the JSON payload embedded in provider messages ("OpenAI API error (403): {…}" previously leaked the whole prefixed string into the warning) and handles top-level `code` fields, so warnings read `unsupported_country_region_territory` instead of a JSON blob.

## [0.3.26] - 2026-10-13

### Added
- **session-summary.** New extension, forked from pasky/pi-session-summary 1.0.2 (MIT): a one-line LLM session summary set as the session name, so `/resume` and the status bar show what the session is about instead of the first user prompt. Fork changes: (1) a decision-model gate (`decision-gate.ts`) that decides materiality before spending a summarizer call. It uses a unified provider registry (`decisionGate.specs` pre-seeded with built-in presets: Liquid d1:free, TypeSafe Jev, Vercel AI Gateway YES/NO chat shim; customs merge over them, so adding a decision model takes one specs entry plus one env var, keyless for local endpoints). The chain cycles active providers in `decisionGate.providers` order with per-provider timeout overrides and 3-strike session disable; with no active provider it degrades silently to stock behavior. Confident no-op turns skip the LLM entirely (names stop changing), and topic drift escalates to a full re-summarize. (2) Incremental prompts now embed only the delta since the last summary (upstream embedded the full conversation in both prompt shapes). (3) Resume no longer triggers a full re-summarize on the first post-resume turn (upstream reset the covered-token baseline to 0 on session start). (4) Manual `/name` is never overwritten until `/summary:clear`. Commands: `/summary:settings`, `/summary:update`, `/summary:clear`, `/summary:cost` (now counts gate calls), `/summary:gate` (provider readiness in cycle order plus a dry-run verdict), `/summary:lock` (toggle: freeze the current summary without renaming; per pi-instance, and a restart or reload returns it to auto). Summarizer resolution needs no config: it tries a pin first (`provider` + `model`, pi-title-style `:effort` suffix such as `zai/glm-5.3-flash:high`, default effort minimal), then a cheap-model ladder, then the session's own model (inherit: it always has a working key, and the prompt never leaves providers already in use). `/summary:settings` shows the resolved configuration except the inherit step, which stays dynamic. On first run, one toast per pi process appears when the first summary lands. Upstream's no-model error now says what to do about it, and a gate crash degrades to stock behavior instead of stalling summaries.

## [0.3.25] - 2026-10-13

### Added
- **footer-path.** Worktree fleet and active-tree badge. The footer read `main` all day while subagents did the actual work in `.worktrees/*`; now the chain shows which worktrees exist and which one is moving. Fleet count: linked worktrees render as `+N⑂` after the branch (`main · +2⑂`), from `git worktree list --porcelain`; the session's own toplevel, bare entries, and detached HEADs are excluded, so only worktrees holding a real branch count. Glyph meanings split (`⑂`/fork for worktrees, `⎇`/git-branch for branches, ascii `wt:`/`br:`), and a worktree session collapses to one glyphed segment when dir and branch names match. Active mode (`"worktrees": "active"`): the tree where git moved most recently (by reflog and index mtime; verified that a worktree's HEAD does not move on commit) wears a `⚑dir` badge while `main` stays bare. The badge is added alongside the active tree; the session's own segment stays as-is. Freshness comes from a snapshot at session start, a filesystem watch on git's worktree metadata (FSEvents recursive watches can miss newly created subdirs), and a 30 s reconcile timer; none of them ever runs in the render path. Also fixed a latent gitInfo bug the probe caught: gitDir and commonDir were compared as raw strings while git canonicalizes outputs (macOS `/var` becomes `/private/var`), so every root session on a symlinked path rendered a phantom `⑂.git` segment. Both sides are now realpath'd. `/footer-path:icon` sets the glyph tier (`unicode | nerd | ascii`, no args cycles), persists to footer-path.json, and warns on `PI_GLYPHS`/`NERD_FONT` env overrides. Verified with two headless jiti harnesses: 10 checks (modes, badge follow, collapse, divergence, watcher convergence, degradation) and 16 checks (icon command), all green.

## [0.3.23] - 2026-10-09

### Changed
- **zai-search.** Queued rows (registered, not yet executing) now render `…` instead of `✓`, matching minimal-mode's convention that a row is a one-liner from the moment it appears: a check glyph on a call that hadn't run falsely claimed success. Running (`○`) and done rows unchanged.
- **minimal-mode.** Collapsed rows are now one-liners from the first frame: a queued call (`… cmd ▸`) renders while args stream or the call awaits its turn, then flips to the `○` running line when execution starts. Previously the built-in `$ command` header flashed until execution began, which was visible on every call and stacked into tall bold blocks when one message queued several calls. statusColor keeps queued rows muted (nothing has happened yet). Expand-mid-run elapsed timing is unaffected: the built-in renderCall still seeds its clock state underneath.

## [0.3.22] - 2026-10-08

### Removed
- **pi-oauth-qwen.** Retired the suspended extension from the repo (dormant since the [Qwen free OAuth tier ended April 15, 2026](https://github.com/QwenLM/qwen-code)). The code is recoverable from git history if a reactivation path appears.

## [0.3.21] - 2026-09-22

### Changed
- **tps.** `/tps` gained subcommands: `/tps show` re-emits the reconstructed line without touching the toggle (the v0.3.20 behavior flipped notifications on every inspection press), `/tps on` and `/tps off` set state explicitly, and bare `/tps` keeps toggling as before.

## [0.3.20] - 2026-09-22

### Changed
- **tps.** The reconstructed resume line is now inspectable: `/tps` shows it on demand (`TPS … · last turn: 󱐌90.0tps ↑1k ↓900 …`) instead of relying on the transient boot toast that was easy to miss. Reconstruction walks the active branch, with a `getEntries()` fallback where `getBranch()` is unavailable.

## [0.3.19] - 2026-09-22

### Fixed
- **tps.** The per-run TPS notification now survives `--resume`: `session_start` reconstructs the last completed turn from session entries (duration measured from the user entry's timestamp to the last assistant entry's timestamp, matching live wall-clock timing; assistant usage accumulated across tool-call rounds) and re-emits the same line, UTC day-rollover stamp included. A trailing aborted turn (user message with no response) no longer masks the last completed turn. Headless-tested against synthetic entries. New turns after resume were always measured correctly (`agent_end` carries only the run's new messages, verified in the pi source); this fixes the missing historical line.

## [0.3.18] - 2026-09-22

### Changed
- **pi 0.87.1 compat pass (no code changes needed).** status-align: `custom-editor.js` is byte-identical between 0.85.1 and 0.87.1 (md5 `bf8d80ac`); the #8799 indicator move touched only the default editor's border, not the CustomEditor internals we mirror, so the earlier high-risk call was wrong. thought-label: full behavioral pass on real 0.87.1 components (headless probe: instrumentation, wave advance, italic strip, baked dims, and pi-side `setHiddenThinkingLabel` writes all verified). minimal-mode: all seven tool factories still exported, `lastComponent` render contract intact, `renderResult(result, options, theme, context)` unchanged. Headers updated from "version-locked to 0.85.x" to "verified on 0.85.x + 0.87.1". Machines holding at 0.85.1 (claw-hub) may move to 0.87.1 when ready; oci-prime needed nothing.

## [0.3.17] - 2026-09-20

### Fixed
- **thought-label.** The wave no longer freezes after `/reload`: mutable wave state (phase, timer, started-at, tracked instances, turn flag, enabled toggle) moved onto `globalThis` next to the TUI ref. Root cause of the stuck shimmer (only "nk" dimmed): /reload keeps the first generation's pinned prototype wrapper, so the new generation's `agent_start` ticked its own empty `tracked` set while the wrapper rendered its own phase-0 label, and the wave never progressed. Any generation's timer now drives the label any generation renders; the `/thought-label` enabled toggle also survives reloads. Reproduced and fixed under a two-generation headless test (jiti + shimmed component): the pre-fix build reproduces the frozen `n|k` bytes exactly; post-fix, the wave moves.

## [0.3.16] - 2026-09-20

### Added
- **zai-search.** Collapsed one-liner rows for `zai_web_search`, matching minimal-mode's convention: call `✓ zai-search "query" ▸`, done `✓ zai-search "query" → 10 sources ▸`, failed `✗ … ▸`; expand (Ctrl+O or click) restores the full formatted result list. Glyphs reuse minimal-mode's tier resolution, so unicode/nerd/ascii machines all agree. Previously the tool fell through to pi's generic custom-tool card, the last multi-line block in an otherwise one-liner TUI.

## [0.3.15] - 2026-09-16

The whole 0.3.x line shipped on this day in one iteration. The
intermediate version numbers (0.3.0 to 0.3.14) were internal churn; only 0.3.15
is tagged. This entry describes the final state.

### Added
- **minimal-mode.** v2 rewrite: compact, uniform one-liner summaries on top of pi's built-in renderers instead of replacing them. Collapsed rows are one muted line per call in every state (running `○ git clone … ▸`, done `✓ git status ▸`, failed `✗ npm test ▸`), while expand (Ctrl+O or click) restores the untouched built-in view: full command header, complete output, exact "Took X.YZs" timing. The `$ command` header stays suppressed from the moment execution starts, so long commands never wrap into a wall of text. Wrapped tools: bash, find, grep, ls, read, write, edit; everything else renders exactly as pi ships it. Promoted from a single file to `extensions/minimal-mode/`.
- **minimal-mode.** Glyph tier system: `unicode` (default, single-width glyphs shipped by pi's own TUI), `nerd` (opt-in PUA glyphs, never auto-detected because they render as tofu without a Nerd Font), `ascii` (dumb-terminal fallback). Resolution order: `PI_GLYPHS` env, then `NERD_FONT` env, then `minimal-mode.json`, then unicode, with per-glyph `overrides`.
- **minimal-mode.** Config in `~/.pi/agent/minimal-mode.json`: `bashPreview` (≈5 preview lines under the bash one-liner), `thinkingLabel` (hidden thinking blocks read `Thinking… ▸`), `statusColor` (color the ✓/✗ glyph green/red; default uniform muted).
- **minimal-mode.** Clicks: one left-click anywhere on a wrapped row toggles it; rapid re-clicks (<350ms) are debounced, on one-liners, expanded delegations, and bash preview lines alike.
- **minimal-mode.** Temporary debug instrumentation: `/minimal-debug` dumps renderer call counts and first errors (diagnostic build; removed once stabilized).
- **footer-path.** New extension: minimal footer `[machine] repo · branch`, worktree-aware, with the machine demoted to a dim bracketed tag (styles: `tag` default / `dot` / `glyph` / `none`). Probes once at session start for VMs (`systemd-detect-virt`), containers (`box`), SSH, and WSL; Nerd Font context icons with a unicode `▣` fallback, tier resolution matching minimal-mode. Toggle with `/footer-path`.
- **footer-path.** Renders a faithful replica of pi's token/context/model stats line (↑in ↓out, cache hit %, $cost, context window with warning/error coloring, right-aligned `(provider) model • thinking`) plus extension `setStatus` items. `setFooter()` replaces the built-in footer entirely, so the stats line must be rebuilt.

### Changed
- **minimal-mode.** One-liners carry no duration or line counts: the collapsed timer ticked unreliably (redraw-driven, measuring the execute wrapper rather than the tool) and disagreed with the built-in expanded "Took X.YZs", so timing belongs to the expanded view alone. find/grep/ls keep their result counts (`✓ grep /pat/ → 12 matches ▸`).

### Fixed
- **minimal-mode.** Restored sessions render restored rows as the single one-liner, identical to fresh ones: a stored-result check makes the collapsed call header yield even though per-process clock data is empty. (The first cut referenced an undeclared registry (`ReferenceError: resultsById is not defined`) and crashed pi on resume. Fixed and defensively wrapped, so any future header-render error falls back to the built-in header instead of taking down the TUI.)
- **minimal-mode.** Custom row components no longer leak into the built-in renderers' `lastComponent` reuse chain, which made later built-in invocations throw and pi render a bare bold tool-name fallback line above collapsed rows.
- **footer-path.** The session name (when set) shows on line 1, matching built-in behavior.

### Known limitation
- minimal-mode summaries are per tool call: Amp-style cross-call grouping ("Ran 4 commands" collapsing several calls into one row) isn't expressible with pi's current per-call renderer hooks.

## [0.2.0] - 2026-05-31

### Added
- **answer.** Interactive Q&A extraction extension (`/answer`). Extracts questions from the last assistant message via LLM, then presents them as a navigable list for answering one-by-one. Inspired by [sids/pi-extensions/answer](https://github.com/sids/pi-extensions/tree/main/answer); reimplemented from scratch because an unresolvable `workspace:^` dependency on `@siddr/pi-shared-qna` made the upstream package impossible to install from npm or a git source.
- **tps.** `/tps` toggle command to enable/disable TPS notifications without reload.

### Changed
- Modernized all imports from `@mariozechner/*` to `@earendil-works/*` for v0.78.0 compatibility.
- **minimal-mode.** Uses the v0.78.0 `ToolRenderContext` (`context.lastComponent`) for DOM reuse instead of creating new `Text` components on every render.
- **minimal-mode.** Removed the read tool override. The v0.78.0 built-in compact read cards (smart file classification, OSC 8 hyperlinks) are better.
- **minimal-mode.** Removed the stale tool cache; tools are now created fresh via `ctx.cwd`.
- **tps.** Removed the manual `isAssistantMessage` type guard; uses a direct `message.role !== "assistant"` check.

## [0.1.0] - 2026-04-15

### Added
- **tilde-path.** Rewrites the CWD in the system prompt to `~` notation.
- **minimal-mode.** Collapsed/expanded tool view toggle (Ctrl+O).
- **tps.** Tokens/sec and usage stats notification after each agent run.
- **pi-oauth-qwen.** OAuth provider for Qwen models via device code flow with PKCE.

### Suspended
- **pi-oauth-qwen.** [Qwen's free OAuth tier ended April 15, 2026](https://github.com/QwenLM/qwen-code). Code preserved for potential future reactivation.
