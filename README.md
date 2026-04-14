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
| `minimal-mode` | Overrides built-in tool renderers with collapsed/expanded toggle (Ctrl+O) |
| `tps` | Notifies tokens/sec and usage stats after each agent run |
| `pi-oauth-qwen` | OAuth provider for Qwen models via device code flow with PKCE |

## Ideal State

Additional directories to add as needed:

- **`themes/`** — Custom TUI themes. Each theme is a `.json` file. [Themes docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/themes.md)

- **`skills/`** — Custom agent skills. Each skill is a directory with a `SKILL.md` file, or a top-level `.md` file. [Skills docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)

- **`prompts/`** — Custom prompt templates (`.md` files). These become available as `/template` commands in pi. [Prompt templates docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/prompt-templates.md)

## Notes

- Settings (API keys, model preferences, keybindings) are managed separately in `~/.pi/agent/settings.json` and are **not** stored in this repo.
- Third-party packages (e.g., `pi-answer`, `pi-list-extensions`) are installed independently and are **not** bundled here.
