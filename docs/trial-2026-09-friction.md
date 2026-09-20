# pi-five trigger trial — friction log (2026-09-20 → ~2026-10-04)

Data source for the §11.4 scorecard review (~2026-10-02). Build fires at **2 of 4**
§10.2 tripwires; single triggers get documented here and we wait.

Scorecard at trial start: **0 of 4 fired · 1 watch** (subagents load cost,
mitigated by the `pib -e` pattern; escalate only if sustained post-mitigation).

## Tripwire board (update after each entry)

| # | Tripwire (§10.2) | Status | Evidence |
|---|---|---|---|
| 1 | pi-subagents unmaintained / yanked / compromised | ⬪ not firing | 0.70.0 released 2026-09-20 (same-day upstream activity) |
| 2 | Unfixed security finding in our threat model | ⬪ not firing | §9 whitehat pass clean; hardening keys hold |
| 3 | Sustained config/architecture friction > capability worth | ⬪ collecting | entries below |
| 4 | Repeated capability gap in real use | ⬪ collecting | entries below |

## Watch-item: boot cost

- §11.2 measured +3.5–4s for pi-subagents load. Note: upstream 0.68.0 now
  ships compiled JS (~2.8s → ~0.2s extension load), so re-measure once on the
  current installed version before treating the watch-item as live.
- The `/tmp/jiti` wipe cost (+6s boots) applies to our own 100k+-line TS
  extensions, not pi-subagents; cache re-warms incrementally.

## Friction entries (append-only, newest last)

### 2026-09-20 — trial open

- Verification pass ran clean: researcher-zai live delegation OK, pi-btw
  0.5.0 loaded, thought-label wave defaults active (60ms), status-align seam
  probes intact on pi 0.85.1. pi-five@0.0.1-alpha.1 confirmed public.
- Exposed npm tokens revoked by owner (both); `.npmrc` already scrubbed.
- Pending bump decision: pi-subagents 0.69.0 → 0.70.0. Changelog read
  (§10.4 pre-pass): tightening-only release (permission-scoping fix,
  dirty-worktree rejection, restrictive config keys). §10.4 ritual still due
  post-bump.
