# pi-agent

Personal pi customizations. Installed via:

```bash
pi install git:github.com/shrwnsan/pi-agent@main
```

Or add to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["git:github.com/shrwnsan/pi-agent@main"]
}
```

## Structure

```
pi-agent/
├── package.json
├── extensions/          # Custom extensions
├── themes/              # TUI themes (.json): minimal-tokyo-night, minimal-dark
├── agents/              # pi-subagents agent variants (zai-hybrid researcher/auditor)
├── lib/                 # shared modules (tier-glyphs)
├── docs/                # research, build plan, trial logs
├── npm/                 # package scaffolds (pi-five placeholder)
├── skills/              # Agent skills (SKILL.md)  (planned)
└── prompts/             # Custom system prompt additions (.md)  (planned)
```

## Extensions

| Extension | Outcomes | Description |
|-----------|----------|-------------|
| `tilde-path` | Prompts and screens show `~/…` everywhere, so home-dir paths stop leaking into output | Rewrites the CWD in the system prompt to `~` notation |
| `minimal-mode` | Every tool call collapses to one line, so full transcripts stay scannable; expand a row only when you need the detail | Adds collapsed status summaries (`✓ 1.2s · 132 lines ▸`, `✓ → 12 matches ▸`) on top of pi's built-in collapsible tool renderers. Glyph tiers (unicode/nerd/ascii) are configurable via `~/.pi/agent/minimal-mode.json`. edit is exempt; its native live-diff renderer wins |
| `footer-path` | Shows the active worktree badge and fleet count (`⚑tree · +N⑂`) right in the footer, no `git` commands needed | Minimal footer: `[machine] repo · branch`, container/SSH/VM/WSL-aware and worktree-aware. Display styles are configurable via `~/.pi/agent/footer-path.json`. Toggle with `/footer-path` |
| `tps` | Shows model speed and token use for every turn: throughput, cache hit rate, and finish time in one footer line | Per-run stats in the footer: `󱐌21.4tps ↑193k ↓955 Σ194k R256 W0.0 H0.1% · 44.6s · 14:23` (↑↓Σ tokens, cache read/write/hit %, UTC finish stamp with an MM-DD prefix after UTC midnight rollover). Glyph tiers via `~/.pi/agent/tps.json` (nerd default 󱐌, unicode ⚡︎). tps reconstructs stats on `--resume` from session entries (last completed turn). `/tps` toggles; `/tps show` re-emits the last line; `/tps on|off` set state |
| `thought-label` | Shows how long each thinking block took, live while streaming and reconstructed on resume | Animated collapsed-thinking header: a `󰧑 thinking… ▸` shimmer while streaming, then `󰧑 thought · Xs ▸` with live-measured (turn) or session-file-reconstructed (history) durations. Uses a post-bake italic strip plus an `updateContent` prototype wrap; version-locked to pi 0.85.x and self-disables if a pi update moves the internals it patches. Wave state lives on globalThis (v4.6.1), so the shimmer survives `/reload`; code changes still need a full pi restart. Config via `~/.pi/agent/thought-label.json` (tier/nerdGlyph/wave/waveMs). Toggle with `/thought-label` |
| `zai-search` | Adds live web search to pi with no MCP setup; searches bill to the GLM Coding Plan, not a new API key | Registers `zai_web_search`, live web search through Z.AI's Web Search MCP endpoint, billed to the GLM Coding Plan quota. No MCP setup; the key comes from `ZAI_API_KEY`, `/login`, or `models.json`. Works with any model; pairs with pi-subagents' `researcher`/`evidence-auditor` children. Collapsed rows follow minimal-mode's one-liner convention (`✓ zai-search "query" → 10 sources ▸`); expand for the full result list. Status: `/zai-search` |
| `status-align` | The `Working` spinner stops covering busy thinking text; it right-aligns on the editor's top border | Right-aligns pi's embedded `Working` spinner/status on the editor's top border (stock puts it left-aligned over a busy thinking area). Version-locked to pi 0.85.x; self-disables if a pi update moves the internals it patches. Toggle with `/status-align`. Code changes need a full pi restart (same reason) |
| `session-summary` | Names each session by its content, so the `/resume` list shows what you actually worked on | One-line LLM summary set as the session name: `/resume` and the status bar show the session's topic instead of the first prompt. pi-agent fork of pasky/pi-session-summary (MIT). Adds a decision-model gate (unified provider registry with Liquid d1:free, TypeSafe Jev, and Vercel AI Gateway presets; customs merge over them; key-gated via env vars, keyless for local endpoints) that skips the summarizer LLM on confident no-op turns and escalates topic drift to a full re-summarize. Summarizer resolution tries a pin (`provider/model[:effort]`) first, then a cheap-model ladder, then the session's own model (zero config; a 401/403 removes the whole provider from the ladder). `/summary:lock` freezes the current summary. Fixes upstream's full-conversation incremental prompts, the post-resume re-summarize spike, and the manual-`/name` overwrite. Config via `~/.pi/agent/session-summary.json`. Commands: `/summary:settings`, `/summary:update`, `/summary:clear`, `/summary:cost`, `/summary:gate`, `/summary:lock` |
| `answer` | Turns the last answer into an interactive Q&A, so follow-up questions get answered without a new prompt | Extracts questions from the last assistant message and answers them interactively via `/answer` |

### Agent variants (pi-subagents)

`agents/` holds hybrid agent definitions for [pi-subagents](https://www.npmjs.com/package/pi-subagents): search runs on `zai_web_search` (Z.AI Coding Plan quota through the `zai-search` extension), and fetch/verify legs run on pi-web-access. Requires `pi install npm:pi-web-access` plus the `zai-search` extension.

- `researcher-zai` and `evidence-auditor-zai` are quota-billed drop-in replacements for the builtins.

Activate via pi settings: `"subagents": { "agentScanDirs": ["~/.pi/agent/git/github.com/shrwnsan/pi-agent/agents"] }` (picked up automatically on `pi update`).

**Build mode.** Keep pi itself out of global settings and load the harness per run: `alias pib='pi -e npm:pi-subagents -e npm:pi-btw -e npm:pi-web-access'` (adds about 0.2s warm; a per-project `.pi/settings.json` works too). See `docs/package-research-2026-09.md` §11 for boot-cost measurements.

## Ideal state

Two directories are planned; add them as needed:

- `skills/` holds custom agent skills. Each skill is a directory with a `SKILL.md` file, or a top-level `.md` file. [Skills docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)
  For now, the skills catalogue lives in [shrwnsan/agents](https://github.com/shrwnsan/agents), under `skills/`. That repo is tool-agnostic and shared across agent harnesses. It has no pi package manifest yet, so copy individual skills into `~/.pi/agent/skills/`. pi-specific skills may be added here later.

- `prompts/` holds custom prompt templates (`.md` files). These become available as `/template` commands in pi. [Prompt templates docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/prompt-templates.md)

## Notes

- Settings (API keys, model preferences, keybindings) are managed separately in `~/.pi/agent/settings.json` and are not stored in this repo.
- Third-party packages (for example, `pi-answer`, `pi-list-extensions`) are installed independently and are not bundled here.
- Extension packages are version-pinned in the owner's settings.json (audited set; see `docs/package-research-2026-09.md` §11.3). Bumps run the §10.4 update ritual first.
- `npm/pi-five/` is a dormant name-reservation placeholder (0.0.1-alpha.1 on npm); the build is trigger-gated, see `docs/package-research-2026-09.md` §10.2 and the trial log `docs/trial-2026-09-friction.md`.
- MIT, see [LICENSE](LICENSE). Extensions ported from other projects (for example, `session-summary` from pasky/pi-session-summary and `zai-search` from @estebanforge/pi-glm-tweaks) credit their origin and keep upstream MIT notices in their source headers.
