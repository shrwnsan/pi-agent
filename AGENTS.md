# AGENTS.md

Personal pi customization package (`pi install git:github.com/shrwnsan/pi-agent@main`).
Everything under `extensions/`, `themes/`, `agents/`, `lib/` is live code. `README.md`
owns structure and per-extension descriptions; this file is about changing things safely.

## Main is live

- `@main` is what installed machines pull on `pi update`. No CI, no test suite, no
  typecheck config; a pushed commit ships unverified to every machine. You are the gate.
- Verify before pushing: at minimum a headless pi probe (`pi -p`, synthetic session
  entries; the jiti + shimmed-component pattern from thought-label v4.6.1. See
  CHANGELOG 0.3.17/0.3.19). For renderer work, eyeball it in the TUI.
- Every functional change gets a CHANGELOG entry and a package.json version bump in
  the same change. They drifted once (0.3.17 stuck while the log reached 0.3.18+).
  Don't reintroduce that.

## Version-locked seams: do not refactor casually

- `thought-label` patches `AssistantMessageComponent.updateContent`; `status-align`
  wraps `CustomEditor.renderTopBorder`. Both are monkey-patches on pi internals,
  verified against specific pi versions (header comments carry the receipts), and
  self-disable via capability probe when a seam moves. Keep the pattern: probe
  first, then a one-time notice, then stock behavior. Tag patched prototypes for
  idempotent `/reload` (`__thoughtLabelPatch`, `__statusAlignPatch`).
- Mutable state that must survive `/reload` lives on `globalThis`, not in closure
  variables (per-generation closures froze the shimmer, v4.6.1).
- Never let a render-path bug take down the session: wrap, catch, degrade.
- minimal-mode wraps the built-in tool renderers: the expanded view leaves the
  built-in rendering untouched, and delegation passes a clean `lastComponent` (a
  leaked component caused the createCallFallback regression).
- After any pi version bump: compat pass against real components before touching
  these files. Recorded ritual: CHANGELOG 0.3.18.

## Extension conventions

- New extensions: directory under `extensions/` with `index.ts` + `README.md`.
  Single-file extensions keep docs in the header comment (see tps.ts).
- No dependencies, ever. package.json has none; `@earendil-works/pi-*` and `typebox`
  resolve from the host pi install at runtime. Relative imports carry explicit `.ts`.
- Tabs everywhere except `answer.ts`, a legacy space-indented outlier. Match the file you're in.
- Config: `~/.pi/agent/<ext>.json`, read defensively (missing or corrupt falls back to defaults).
- Glyphs via `lib/tier-glyphs.ts` (single glyph) or `minimal-mode/glyphs.ts` (GlyphSet
  for row renderers). Resolution order: `PI_GLYPHS` env, then `NERD_FONT` env, then
  config, then unicode. Never auto-detect nerd; PUA glyphs render as tofu on stock
  terminals.
- Tool-row renderers follow minimal-mode's one-liner convention: queued `…` / running
  `○` / done `✓` / failed `✗`, `▸` caret; expand restores the built-in view untouched.
- Nothing subprocess-y in the render path; probes run once at `session_start`.
- In-session toggle: `/<ext>` command. Headers carry per-extension versions
  (thought-label v4.6.x), independent of the package version.
- Ported code credits its origin (see zai-client.ts, ported from pi-glm-tweaks, MIT).
- Themes: JSON against the pi theme `$schema`, `minimal-*` naming. `agents/*.md`:
  pi-subagents variants; list `zai_web_search` in `tools:` for quota-billed search.

## Commits & docs

- Subjects: `type(scope): summary` or `<ext> vX.Y.Z: summary`; both are established.
- Releases: open a PR (squash-only repo), then tag the squash commit on main:
  `git tag -a vX.Y.Z <commit> -m "<one-line release summary>" && git push origin vX.Y.Z`.
  Annotated, v-prefixed, one per CHANGELOG release; skipped numbers (0.3.24) get no tag.
  Create the GitHub Release right after pushing the tag: a release's `created_at`
  inherits the tag's date, so retroactive tags or releases scramble the releases-page
  order (fixed 2026-10-26; backfill means re-dating tags, then recreating releases).
  v0.1.0 also gets no tag: the scaffold's package.json was 1.0.0, so no commit was
  ever at 0.1.0 (its CHANGELOG entry is retroactive).
- docs/ is load-bearing: its § numbers are cited from README and CHANGELOG. Trial and
  friction logs are append-only; retired work gets a RETIRED marker, not deletion.
- Deep context: `docs/package-research-2026-09.md` (§10.4 update ritual, boot costs,
  pin policy), `docs/thought-label-map.md` (architecture map),
  `docs/trial-2026-09-friction.md` (pi-five tripwire board).
