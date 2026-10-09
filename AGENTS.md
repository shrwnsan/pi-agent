# AGENTS.md

Personal pi customization package (`pi install git:github.com/shrwnsan/pi-agent@main`).
Everything under `extensions/`, `themes/`, `agents/`, `lib/` is live code. `README.md`
owns structure and per-extension descriptions; this file is about changing things safely.

## Main is live

- `@main` is what installed machines pull on `pi update`. No CI, no test suite, no
  typecheck config — a pushed commit ships unverified to every machine. You are the gate.
- Verify before pushing: at minimum a headless pi probe (`pi -p`, synthetic session
  entries; the jiti + shimmed-component pattern from thought-label v4.6.1 — see
  CHANGELOG 0.3.17/0.3.19). For renderer work, eyeball it in the TUI.
- Every functional change gets a CHANGELOG entry and a package.json version bump in
  the same change. They drifted once (0.3.17 stuck while the log reached 0.3.18+) —
  don't reintroduce that.

## Version-locked seams — do not refactor casually

- `thought-label` patches `AssistantMessageComponent.updateContent`; `status-align`
  wraps `CustomEditor.renderTopBorder`. Both are monkey-patches on pi internals,
  verified against specific pi versions (header comments carry the receipts), and
  self-disable via capability probe when a seam moves. Keep the pattern: probe →
  one-time notice → stock behavior. Tag patched prototypes for idempotent `/reload`
  (`__thoughtLabelPatch`, `__statusAlignPatch`).
- Mutable state that must survive `/reload` lives on `globalThis` bags, not closure
  vars (per-generation closures froze the shimmer — v4.6.1).
- Never let a render-path bug take down the session: wrap, catch, degrade.
- minimal-mode wraps the built-in tool renderers: expanded view = built-in rendering
  untouched, and delegation passes a clean `lastComponent` (a leaked component caused
  the createCallFallback regression).
- After any pi version bump: compat pass against real components before touching
  these files. Recorded ritual: CHANGELOG 0.3.18.

## Extension conventions

- New extensions: directory under `extensions/` with `index.ts` + `README.md`.
  Single-file extensions keep docs in the header comment (see tps.ts).
- No dependencies, ever. package.json has none; `@earendil-works/pi-*` and `typebox`
  resolve from the host pi install at runtime. Relative imports carry explicit `.ts`.
- Tabs — except `answer.ts`, a legacy space-indented outlier. Match the file you're in.
- Config: `~/.pi/agent/<ext>.json`, read defensively (missing/corrupt → defaults).
- Glyphs via `lib/tier-glyphs.ts` (single glyph) or `minimal-mode/glyphs.ts` (GlyphSet
  for row renderers). Resolution: `PI_GLYPHS` → `NERD_FONT` → config → unicode.
  Never auto-detect nerd — PUA glyphs render as tofu on stock terminals.
- Tool-row renderers follow minimal-mode's one-liner convention: queued `…` / running
  `○` / done `✓` / failed `✗`, `▸` caret; expand restores the built-in view untouched.
- Nothing subprocess-y in the render path; probes run once at `session_start`.
- In-session toggle: `/<ext>` command. Headers carry per-extension versions
  (thought-label v4.6.x), independent of the package version.
- Ported code credits its origin (see zai-client.ts → pi-glm-tweaks, MIT).
- Themes: JSON against the pi theme `$schema`, `minimal-*` naming. `agents/*.md`:
  pi-subagents variants; list `zai_web_search` in `tools:` for quota-billed search.

## Commits & docs

- Subjects: `type(scope): summary` or `<ext> vX.Y.Z: summary` — both established.
- docs/ is load-bearing: its § numbers are cited from README and CHANGELOG. Trial and
  friction logs are append-only; retired work gets a RETIRED marker, not deletion.
- Deep context: `docs/package-research-2026-09.md` (§10.4 update ritual, boot costs,
  pin policy), `docs/thought-label-map.md` (architecture map),
  `docs/trial-2026-09-friction.md` (pi-five tripwire board).
