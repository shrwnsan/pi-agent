# pi-web-access compact collapsed rows — carryable patch

Upstream issue: `fetch_content`/`web_search` collapsed renders show multi-line
previews; `source_check` has no renderer (generic card). This patch (against
`6c5afa1` = v0.30.0) adds a config-gated `compactRows` flag
(`~/.pi/agent/pi-web-access.json` → `{"compactRows": true}`):

- `web_search` / `fetch_content`: collapsed `renderResult` = single status
  line; `expanded` (ctrl+o) unchanged.
- `source_check`: one-line `renderCall`/`renderResult` registered only when
  the flag is on (stock behavior preserved when off).

**Live: fork branch [`shrwnsan/pi-web-access@fix/compact-collapsed-rows`](https://github.com/shrwnsan/pi-web-access/tree/fix/compact-collapsed-rows)** — dogfooded via
`"git:github.com/shrwnsan/pi-web-access@fix/compact-collapsed-rows"` in settings (dotfiles) +
`~/.pi/agent/pi-web-access.json` → `{"compactRows": true}`. PR upstream: open the compare
`nicobailon/pi-web-access/compare/main...shrwnsan:pi-web-access:fix/compact-collapsed-rows` (PAT can't create
PRs on repos it doesn't own). When upstream merges: revert the spec to `npm:pi-web-access@<new>` and drop
pi-web-access.json's flag. Known-unknown: git-spec packages don't appear in the npm manifest — watch that the
shared deps dir keeps p-limit/typebox/undici after future `pi update --extensions`.

Until merged/released, machines can
dogfood via `"git:github.com/shrwnsan/pi-web-access@fix/compact-collapsed-rows"`
(requires the shrwnsan fork — see trial log) or apply the patch to the
installed dist locally (stopgap; re-apply after package updates).

Regenerate: clone nicobailon/pi-web-access, checkout `6c5afa1`, apply, build.
