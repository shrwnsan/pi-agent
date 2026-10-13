# footer-path

Minimal footer: `[machine] repo · branch (+N⎇)` **+ pi's token stats line**, worktree-aware.

```
[box] dotfiles · main +2⎇
↑225k ↓80k R6.4M CH99.6% 11.5%/1.0M        (zai) glm-5.3-flash • max
```

Line 2 replicates pi's built-in stats from the documented extension data path
(`ctx.getContextUsage()`, `ctx.sessionManager.getEntries()`, `ctx.model`) —
taking over the footer doesn't lose the stats/model readout. Known cosmetic
differences from the built-in: no `(sub)` subscription marker and no `(auto)`
compact indicator (neither is exposed to extensions). Extension `setStatus`
items still render on a third line, as built-in.

## Machine label

Shown **only** when this isn't the local machine — otherwise omitted:

| Context | Label | Icon (nerd tier) | Detection |
|---------|-------|------------------|-----------|
| Docker / devcontainer / AgentBox | `box` | cube | `/.dockerenv`, `DEVCONTAINER`, `REMOTE_CONTAINERS`, `AGENTBOX` |
| Other containers (Podman, LXC…) | `box` | cube | `systemd-detect-virt -c` |
| VMs (qemu, kvm, vmware…) | short hostname | desktop | `systemd-detect-virt -v` |
| SSH | short hostname | server | `SSH_CONNECTION` / `SSH_TTY` |
| WSL | `wsl` | tux | `WSL_DISTRO_NAME`, `/proc/version` |
| Override | any value | — | `FOOTER_MACHINE_NAME` env var |

## Display styles

`~/.pi/agent/footer-path.json`:

```json
{
  "machineStyle": "tag",
  "glyphs": "unicode",
  "worktrees": "count"
}
```

| `machineStyle` | Rendered | Notes |
|----------------|----------|-------|
| `"tag"` *(default)* | `[box] dotfiles · main` | machine demoted to dim metadata; brackets are ASCII → zero glyph risk |
| `"dot"` | `box · dotfiles · main` | machine as a plain chain segment |
| `"glyph"` | `▣ box · dotfiles · main` | icon + label in the chain |
| `"none"` | `dotfiles · main` | machine suppressed entirely |

| `worktrees` | Rendered | Notes |
|-------------|----------|-------|
| `"count"` *(default)* | `main +2⎇` | fleet count after the branch |
| `"off"` | `main` | fleet suppressed entirely |

`glyphs` tier — `"unicode"` (default), `"nerd"`, `"ascii"`; also settable via
`PI_GLYPHS` / `NERD_FONT` env vars (same resolution as
[minimal-mode](../minimal-mode/README.md)). In `"glyph"` style, the nerd tier
swaps `▣` for a context icon: cube (container), server (SSH), desktop (VM),
tux (WSL) — all Font Awesome 4 codepoints, actually present in the font.

## Worktree fleet

Linked worktrees of the session's repo render as `+N⎇` after the branch —
branch names from `git worktree list --porcelain`, excluding the session's own
toplevel, bare entries, and detached HEADs:

```
dotfiles · main +2⎇        ← two other linked worktrees hold branches
```

Snapshot at session start, re-probed on branch-change events (worktrees created
mid-session appear on the next branch change or `/footer-path` toggle — never
per render, so the render path stays subprocess-free). Disable with
`"worktrees": "off"` in the config below. Glyph by tier: Font Awesome code-branch (nerd), `⎇` (unicode default),
plain `wt` (ascii).

## Worktrees

Detected once at session start (`git rev-parse --absolute-git-dir` vs
`--git-common-dir`). The name comes from the path segment after a
`.worktrees/` directory when present:

```
~/dev/pi-agent/.worktrees/experiment  →  [box] pi-agent · wt:experiment · main
```

## Design notes

- All probes (git + virtualization) run **once** at session start — cwd is
  fixed per session, no git/subprocess ever runs in the render path. The fleet
  re-probe runs in `onBranchChange` (a reactive callback, not the render path).
- Branch updates use pi's `footerData.onBranchChange()` — reactive, no polling.
- Token/cost stats are intentionally **not** included; [`tps`](../tps.ts) owns that.

## Toggle

`/footer-path` — toggles between this footer and pi's built-in one.
