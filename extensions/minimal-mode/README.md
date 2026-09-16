# minimal-mode

Compact tool result summaries on top of pi's built-in renderers.

```
Collapsed:                          Expanded (Ctrl+O or click):
  ✓ 1.2s · 132 lines ▸               $ npm test
  ✓ → 12 matches ▸                     ... full output ...
  ✗ exit non-zero · 8 lines ▸
```

## Philosophy (v2)

Recent pi versions ship excellent built-in tool renderers: bash preview cards
with duration, write syntax highlighting, edit live diff previews, read compact
cards, and per-tool click-to-expand in fullscreen mode. This extension **no
longer replaces any of that**. It only adds what's still missing:

| Tool | Collapsed (this extension) | Expanded |
|------|----------------------------|----------|
| `bash`  | `✓ 1.2s · 132 lines ▸` status line | built-in full output |
| `find`  | `✓ → 12 files ▸` | built-in full output |
| `grep`  | `✓ → 12 matches ▸` | built-in full output |
| `ls`    | `✓ → 12 entries ▸` | built-in full output |
| `read` `write` `edit` | **untouched** — built-ins are superior | — |

## Glyph tiers

The default tier uses only single-width glyphs that ship in pi's own TUI —
verified safe on Linux, WSL, Windows, and macOS default font stacks.

| Tier | check | fail | collapsed | expanded |
|------|-------|------|-----------|----------|
| `unicode` *(default)* | `✓` | `✗` | `▸` | `▾` |
| `nerd` | `` | `` | `` | `` |
| `ascii` | `ok` | `x` | `>` | `v` |

The `nerd` tier is opt-in only — PUA glyphs render as tofu on terminals
without a Nerd Font, so resolution never guesses upward.

### Configuration

`~/.pi/agent/minimal-mode.json`:

```json
{
  "glyphs": "unicode",
  "overrides": { "check": "✔", "collapsed": "›" },
  "bashPreview": false
}
```

- `glyphs` — tier: `"unicode"` (default), `"nerd"`, `"ascii"`
- `overrides` — per-glyph surgical overrides on top of the resolved tier
- `bashPreview` — keep ~5 preview lines under the bash status line when collapsed
  (default `false`: Amp-style, output fully hidden until expanded)

### Environment

```bash
PI_GLYPHS=nerd|unicode|ascii   # highest precedence
NERD_FONT=1                    # shorthand for PI_GLYPHS=nerd
```

## Toggle

Expand/collapse is pi's built-in per-tool toggle: **Ctrl+O** globally, or
**click a tool block** in fullscreen TUI mode (`"tuiMode": "fullscreen"`).
