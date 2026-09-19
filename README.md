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
├── themes/              # TUI themes (.json)  (planned)
├── skills/              # Agent skills (SKILL.md)  (planned)
└── prompts/             # Custom system prompt additions (.md)  (planned)
```

## Extensions

| Extension | Description |
|-----------|-------------|
| `tilde-path` | Rewrites CWD in system prompt to use `~` notation |
| `minimal-mode` | Adds collapsed status summaries (`✓ 1.2s · 132 lines ▸`, `✓ → 12 matches ▸`) on top of pi's built-in collapsible tool renderers. Configurable glyph tiers (unicode/nerd/ascii) via `~/.pi/agent/minimal-mode.json`. edit is exempt — its native live-diff renderer wins |
| `footer-path` | Minimal footer: `[machine] repo · branch` — container/SSH/VM/WSL-aware, worktree-aware. Display styles configurable via `~/.pi/agent/footer-path.json`. Toggle with `/footer-path` |
| `tps` | Per-run telemetry in footer dialect: `󱐌21.4tps ↑193k ↓955 Σ194k R256 W0.0 H0.1% · 44.6s · 14:23` — ↑↓Σ tokens, cache read/write/hit %, UTC finish stamp (MM-DD prefix after UTC midnight rollover). Glyph tiers via `~/.pi/agent/tps.json` (nerd default 󱐌, unicode ⚡︎). Toggle with `/tps` |
| `thought-label` | Animated collapsed-thinking header: `󰧑 thinking… ▸` shimmer while streaming → `󰧑 thought · Xs ▸` with live-measured (turn) or session-file-reconstructed (history) durations. Uses a post-bake italic strip + `updateContent` prototype wrap — version-locked to pi 0.85.x, self-disables on seam changes. Config via `~/.pi/agent/thought-label.json` (tier/nerdGlyph/wave/waveMs). Toggle with `/thought-label` |
| `zai-search` | Registers `zai_web_search` — live web search via Z.AI's Web Search MCP endpoint, billed to the GLM Coding Plan quota. Zero MCP setup; key from `ZAI_API_KEY` / `/login` / `models.json`. Works with any model; pairs with pi-subagents' `researcher`/`evidence-auditor` children. Status: `/zai-search` |
| `answer` | Extracts questions from last assistant message and answers them interactively via `/answer` |
| `pi-oauth-qwen` | ~~OAuth provider for Qwen models via device code flow with PKCE~~ **Suspended** — [Qwen's free OAuth tier ended April 15, 2026](https://github.com/QwenLM/qwen-code). Code preserved for potential future reactivation. |

## Ideal State

Additional directories to add as needed:

- **`themes/`** — Custom TUI themes. Each theme is a `.json` file. [Themes docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/themes.md)

- **`skills/`** — Custom agent skills. Each skill is a directory with a `SKILL.md` file, or a top-level `.md` file. [Skills docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)
  For now, the skills catalogue lives in [shrwnsan/agents](https://github.com/shrwnsan/agents) → `skills/` — tool-agnostic, shared across agent harnesses. That repo has no pi package manifest yet, so copy individual skills into `~/.pi/agent/skills/`; pi-specific skills may land here later.

- **`prompts/`** — Custom prompt templates (`.md` files). These become available as `/template` commands in pi. [Prompt templates docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/prompt-templates.md)

## Notes

- Settings (API keys, model preferences, keybindings) are managed separately in `~/.pi/agent/settings.json` and are **not** stored in this repo.
- Third-party packages (e.g., `pi-answer`, `pi-list-extensions`) are installed independently and are **not** bundled here.
