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
├── themes/              # TUI themes (.json)
├── skills/              # Agent skills (SKILL.md)
└── prompts/             # Custom system prompt additions (.md)
```

## Extensions

| Extension | Description |
|-----------|-------------|
| `tilde-path` | Rewrites CWD in system prompt to use `~` notation |
| `minimal-mode` | Adds collapsed status summaries (`✓ 1.2s · 132 lines ▸`, `✓ → 12 matches ▸`) on top of pi's built-in collapsible tool renderers. Configurable glyph tiers (unicode/nerd/ascii) via `~/.pi/agent/minimal-mode.json` |
| `tps` | Notifies tokens/sec and usage stats after each agent run. Toggle with `/tps` |
| `answer` | Extracts questions from last assistant message and answers them interactively via `/answer` |
| `pi-oauth-qwen` | ~~OAuth provider for Qwen models via device code flow with PKCE~~ **Suspended** — [Qwen's free OAuth tier ended April 15, 2026](https://github.com/QwenLM/qwen-code). Code preserved for potential future reactivation. |

## Ideal State

Additional directories to add as needed:

- **`themes/`** — Custom TUI themes. Each theme is a `.json` file. [Themes docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/themes.md)

- **`skills/`** — Custom agent skills. Each skill is a directory with a `SKILL.md` file, or a top-level `.md` file. [Skills docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)

- **`prompts/`** — Custom prompt templates (`.md` files). These become available as `/template` commands in pi. [Prompt templates docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/prompt-templates.md)

## Notes

- Settings (API keys, model preferences, keybindings) are managed separately in `~/.pi/agent/settings.json` and are **not** stored in this repo.
- Third-party packages (e.g., `pi-answer`, `pi-list-extensions`) are installed independently and are **not** bundled here.
