# footer-path

Minimal footer: `machine · repo · branch`, worktree-aware.

```
box · dotfiles · main                ← container or remote
dotfiles · main                      ← local machine
dotfiles · wt:experiment · main      ← linked git worktree
```

Replaces pi's default footer path (absolute cwd + branch) with a compact form.

## Machine label

Shown **only** when this isn't the local machine — otherwise omitted:

| Context | Label | Detection |
|---------|-------|-----------|
| SSH | short hostname | `SSH_CONNECTION` / `SSH_TTY` |
| Container | `box` | `/.dockerenv`, `DEVCONTAINER`, `REMOTE_CONTAINERS`, `AGENTBOX` |
| Override | any value | `FOOTER_MACHINE_NAME` env var |

## Worktrees

Detected once at session start (`git rev-parse --absolute-git-dir` vs
`--git-common-dir`). The name comes from the path segment after a
`.worktrees/` directory when present:

```
~/dev/pi-agent/.worktrees/experiment  →  pi-agent · wt:experiment · main
```

## Design notes

- The git probe runs **once** at session start — cwd is fixed per session, so
  no git subprocess ever runs in the render path.
- Branch updates use pi's `footerData.onBranchChange()` — reactive, no polling.
- Token/cost stats are intentionally **not** included; [`tps`](../tps.ts) owns that.

## Toggle

`/footer-path` — toggles between this footer and pi's built-in one.
