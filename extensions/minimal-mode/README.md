# minimal-mode

Compact tool result summaries on top of pi's built-in renderers. Uniform,
single-color rows — one line per tool call.

```
Running:                            Collapsed:                          Expanded (Ctrl+O or click):
  ○ git clone … ▸                     ✓ git status ▸                      $ git status -s
                                      ✓ grep /pat/ → 12 matches ▸         ... full output ...
                                      ✓ edit src/foo.ts ▸
                                      Thinking… ▸
```

Rows collapse the moment execution starts — the `○` running line replaces
the command header so long commands never wrap into a wall of text. Expand
while running to watch the built-in streaming preview; nothing is lost,
just folded.

Collapsed rows are a **single muted line** — glyph, command/query summary,
collapse caret. Timing is the expanded view's job: pi's built-in rendering
shows the exact "Took X.YZs". The `$ command` header is suppressed from the
moment execution starts, so long commands never wrap into a wall of text.
Expanded rows are the built-in rendering, untouched: full command header +
complete output — no summary line in between.

**Clicking**: one left-click anywhere on a wrapped row toggles that block.
Rapid re-clicks (<350ms) are debounced, so a habitual double-click no
longer toggles twice and cancel itself out. (Note: pi only counts a click
when press and release land on the same terminal cell — click-and-drift is
treated as text selection.)

## Philosophy (v2)

Recent pi versions ship excellent built-in tool renderers: bash preview cards
with duration, write syntax highlighting, edit live diff previews, read compact
cards, and per-tool click-to-expand in fullscreen mode. This extension **no
longer replaces any of that**. It only adds what's still missing:

| Tool | Collapsed (this extension) | Expanded |
|------|----------------------------|----------|
| `bash`  | `✓ git status ▸` | built-in header + full output |
| `find`  | `✓ find *.ts → 12 files ▸` | built-in full output |
| `grep`  | `✓ grep /pat/ → 12 matches ▸` | built-in full output |
| `ls`    | `✓ ls src → 12 entries ▸` | built-in full output |
| `read`  | `✓ read src/foo.ts ▸` | built-in full output |
| `write` | `✓ write src/foo.ts ▸` | built-in full output |
| `edit`  | `✓ edit src/foo.ts ▸` | built-in header + diff preview |
| any, running | `○ git clone … ▸` | streaming preview |
| thinking | `Thinking… ▸` (label configurable) | full thinking text |

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
- `statusColor` — color the ✓/✗ glyph green/red (`true`) or keep rows
  uniform muted (default `false`)

### Environment

```bash
PI_GLYPHS=nerd|unicode|ascii   # highest precedence
NERD_FONT=1                    # shorthand for PI_GLYPHS=nerd
```

## Toggle

Expand/collapse is pi's built-in per-tool toggle: **Ctrl+O** globally, or
**click a tool block** in fullscreen TUI mode (`"tuiMode": "fullscreen"`).

## Theme pairing

The package ships a **`minimal-dark`** theme (`themes/`): built-in dark with
uniform tool box backgrounds — expanded blocks match the muted one-liners,
state lives in the `○ ✓ ✗` glyphs, not the box color. Select via `/settings`
after installing the package.
