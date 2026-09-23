# pi-web-access compact collapsed rows — carryable patch

Upstream issue: `fetch_content`/`web_search` collapsed renders show multi-line
previews; `source_check` has no renderer (generic card). This patch (against
`6c5afa1` = v0.30.0) adds a config-gated `compactRows` flag
(`~/.pi/agent/pi-web-access.json` → `{"compactRows": true}`):

- `web_search` / `fetch_content`: collapsed `renderResult` = single status
  line; `expanded` (ctrl+o) unchanged.
- `source_check`: one-line `renderCall`/`renderResult` registered only when
  the flag is on (stock behavior preserved when off).

**RETIRED 2026-09-23 — dogfood rolled back (ops cost > cosmetic gain; upstream PR never opened). The fork shrwnsan/pi-web-access is slated for deletion. Patch preserved below for archaeology.**

Formerly live: fork branch [`shrwnsan/pi-web-access@fix/compact-collapsed-rows`](https://github.com/shrwnsan/pi-web-access/tree/fix/compact-collapsed-rows)** — dogfooded via
`"git:github.com/shrwnsan/pi-web-access@fix/compact-collapsed-rows"` in settings (dotfiles) +
`~/.pi/agent/pi-web-access.json` → `{"compactRows": true}`. PR upstream: open the compare
`nicobailon/pi-web-access/compare/main...shrwnsan:pi-web-access:fix/compact-collapsed-rows` (PAT can't create
PRs on repos it doesn't own). When upstream merges: revert the spec to `npm:pi-web-access@<new>` and drop
pi-web-access.json's flag. Known-unknown: git-spec packages don't appear in the npm manifest — watch that the
shared deps dir keeps p-limit/typebox/undici after future `pi update --extensions`.

## Catch-up ritual (upstream moves; run on the Mac — it has full push rights)

```bash
G=~/.pi/agent/git/github.com/shrwnsan/pi-web-access
git -C $G remote add upstream https://github.com/nicobailon/pi-web-access.git   # once
git -C $G fetch upstream
git -C $G log --oneline HEAD..upstream/main        # what's new upstream
git -C $G rebase upstream/main                     # replay our one commit (conflicts → resolve → --continue)
git -C $G -c credential.helper='!gh auth git-credential' push --force-with-lease fork fix/compact-collapsed-rows
pi update --extensions                             # last: pi syncs its managed checkout to the pushed state
```

Order matters: force-push BEFORE `pi update` — pi's managed checkout resets to
origin's branch state, which wiped an unpushed rebase once already (recovered
from reflog). The container's PAT doesn't cover this fork (fine-grained
allowlist, repo created after the token) → container pushes 404; the Mac's gh
is full-scope. Adding the fork to the PAT's repository allowlist is optional.

**Detection:** Watch `nicobailon/pi-web-access` → Releases-only; or
`npm view pi-web-access version` vs last-known (0.31.0 as of 2026-09-22); or
the fork page's "N commits behind" banner. Fold into the existing
`pi update --extensions` cadence.

**Lifecycle end:** when the flag ships in an **npm release** (merged-to-main ≠
released — check `npm view pi-web-access` + changelog): revert the settings
spec to `npm:pi-web-access@<ver>`, delete the fork branch, keep or drop
pi-web-access.json (flag defaults off — file is harmless either way). An
already-open PR auto-updates on force-push.

Until merged/released, machines can
dogfood via `"git:github.com/shrwnsan/pi-web-access@fix/compact-collapsed-rows"`
(requires the shrwnsan fork — see trial log) or apply the patch to the
installed dist locally (stopgap; re-apply after package updates).

Regenerate: clone nicobailon/pi-web-access, checkout `6c5afa1`, apply, build.
