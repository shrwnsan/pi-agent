# minimal-mode

Compact tool result summaries on top of pi's built-in renderers.

```
Collapsed:                          Expanded (Ctrl+O or click):
  ✓ git status · 0.3s · 4 lines ▸     $ git status -s        ← full command header
                                      ✓ 0.3s · 4 lines ▾     ← caret flips
  ✓ grep /pat/ → 12 matches ▸         → 12 matches
  Thinking… ▸                         ... full output ...
```

Collapsed rows are a **single dim line** — glyph, command/query summary,
duration/count, collapse caret. The `$ command` header is suppressed once
the result lands, so long commands never wrap into a wall of text. Expanded
rows keep the summary with the caret flipped to `▾`, above the full output.

## Philosophy (v2)

Recent pi versions ship excellent built-in tool renderers: bash preview cards
with duration, write syntax highlighting, edit live diff previews, read compact
cards, and per-tool click-to-expand in fullscreen mode. This extension **no
longer replaces any of that**. It only adds what's still missing:

| Tool | Collapsed (this extension) | Expanded |
|------|----------------------------|----------|
| `bash`  | `✓ git status · 0.3s · 4 lines ▸` | built-in full output |
| `find`  | `✓ find *.ts → 12 files ▸` | built-in full output |
| `grep`  | `✓ grep /pat/ → 12 matches ▸` | built-in full output |
| `ls`    | `✓ ls src → 12 entries ▸` | built-in full output |
| thinking | `Thinking… ▸` (label configurable) | full thinking text |
| `read` `write` `edit` | **untouched** — built-ins are superior | — |

Note: summaries are **per tool call**. Amp-style cross-call grouping
("Ran 4 commands" collapsing several calls into one row) isn't expressible
with pi's current per-call renderer hooks — each tool call renders as its
own component.

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
- `bashPreview` — keep ~5 preview lines under the bash one-liner when collapsed
  (default `false`: Amp-style, output fully hidden until expanded)
- `thinkingLabel` — text shown for hidden thinking blocks
  (default `"Thinking… ▸"`; the caret is the collapse affordance — click
  or Ctrl+T to expand)

### Environment

```bash
PI_GLYPHS=nerd|unicode|ascii   # highest precedence
NERD_FONT=1                    # shorthand for PI_GLYPHS=nerd
```

## Toggle

Expand/collapse is pi's built-in per-tool toggle: **Ctrl+O** globally, or
**click a tool block** in fullscreen TUI mode (`"tuiMode": "fullscreen"`).
