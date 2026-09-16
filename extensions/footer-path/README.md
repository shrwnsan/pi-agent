# footer-path

Minimal footer: `[machine] repo · branch`, worktree-aware.

```
[box] dotfiles · main                ← container or remote (default "tag" style)
dotfiles · main                      ← local machine
dotfiles · wt:experiment · main      ← linked git worktree
```

Replaces pi's default footer path (absolute cwd + branch) with a compact form.

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
  "glyphs": "unicode"
}
```

| `machineStyle` | Rendered | Notes |
|----------------|----------|-------|
| `"tag"` *(default)* | `[box] dotfiles · main` | machine demoted to dim metadata; brackets are ASCII → zero glyph risk |
| `"dot"` | `box · dotfiles · main` | machine as a plain chain segment |
| `"glyph"` | `▣ box · dotfiles · main` | icon + label in the chain |
| `"none"` | `dotfiles · main` | machine suppressed entirely |

`glyphs` tier — `"unicode"` (default), `"nerd"`, `"ascii"`; also settable via
`PI_GLYPHS` / `NERD_FONT` env vars (same resolution as
[minimal-mode](../minimal-mode/README.md)). In `"glyph"` style, the nerd tier
swaps `▣` for a context icon: cube (container), server (SSH), desktop (VM),
tux (WSL) — all Font Awesome 4 codepoints, actually present in the font.

## Worktrees

Detected once at session start (`git rev-parse --absolute-git-dir` vs
`--git-common-dir`). The name comes from the path segment after a
`.worktrees/` directory when present:

```
~/dev/pi-agent/.worktrees/experiment  →  [box] pi-agent · wt:experiment · main
```

## Design notes

- All probes (git + virtualization) run **once** at session start — cwd is
  fixed per session, no git/subprocess ever runs in the render path.
- Branch updates use pi's `footerData.onBranchChange()` — reactive, no polling.
- Token/cost stats are intentionally **not** included; [`tps`](../tps.ts) owns that.

## Toggle

`/footer-path` — toggles between this footer and pi's built-in one.
