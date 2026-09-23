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

### 2026-09-20 — UI consistency friction (owner-reported, fixed)

- `zai_web_search` rendered pi's generic semi-collapsed card — the only
  non-one-liner block among wrapped tools. Fixed in-repo (zai-search 0.3.16,
  branch feat/web-tool-oneliners → main): collapsed rows now match
  minimal-mode's convention; expand keeps the full result list. /reload-safe.
- Same audit flagged pi-web-access rows (fetch_content collapsed = status +
  200-char content preview; source_check = generic card). Upstream ask
  required — minimal-mode cannot wrap third-party tools (getToolDefinition is
  runner-internal; per-extension tool Maps; re-registering a name would break
  execute). Proposal to be filed with Nico Bailon (active maintainer).

### 2026-09-22 — wave-freeze bug + §10.4 ritual (0.70.1 adoption)

- **Bug (owner-reported):** thought-label shimmer stuck, only "nk" dimmed.
  Root cause: /reload generation split — the pinned first-generation wrapper
  rendered its own closure's phase-0 label while the new generation's
  agent_start ticked its own (empty) tracked set; `touched=0` skipped
  requestRender, so nothing ever re-baked. Fixed in v4.6.1: all wave state
  (phase/timer/tracked/turnActive/enabled) moved onto the globalThis bag;
  any generation's timer now drives the label. Two-generation headless test:
  pre-fix reproduces the frozen `n|k` bytes exactly, post-fix the trough
  travels. Full restart required to apply (patch-extension rule).
- **pi update --extensions ran on owner machine:** pi-subagents 0.69.0 →
  0.70.1 (pin matches), pi-btw floated 0.5.0 → 0.6.0 (container settings were
  unpinned — now converged to the pinned file). Empirical pin semantics:
  `pi update --extensions` never downgrades; pins bind on fresh install.
- **§10.4 ritual on 0.70.1:** endpoints = agent-plugins.org schema constants
  + shittycodingagent.ai share-URL builder (user-initiated share) — clean;
  "telemetry" grep hits are strings, not beacons; agentScope/scheduledRuns
  keys still honored. **pi-btw 0.6.0 review:** no endpoints/telemetry/exec;
  no shipped changelog (upstream gap, minor). Verdict: pins move to 0.70.1 /
  0.6.0 / 0.30.0 — recorded in §11.3 (done earlier today).
- Tripwires unchanged: 0 fired, 1 watch. Scorecard review ~2026-10-02.

### 2026-09-22 — pi core jumped 0.85.1 → 0.87.1 (version-lock exposure)

- Owner ran `pi update`: 0.87.1 (0.86.0 09-19, 0.87.0 09-21, 0.87.1 09-22 —
  fast core churn). Container ephemeral disk resets to 0.85.1 between turns;
  real machines decide their own version.
- **status-align (HIGH RISK):** changelog #8799 (0.86.x/0.87.0) moved the
  working indicator INTO the default editor border; 0.87.0 also moved
  compaction/branch/retry spinners there. Seam functions still exist on
  CustomEditor (renderTopBorder + setWorkingStatusIndicator verified in
  0.87.1 dist) so the capability probes PASS — but the 0.85.1-mirrored
  composition is likely stale → misrender risk, the worse failure mode.
  Needs re-mirror against 0.87.1 + a behavior guard, not just probes.
- **thought-label (PROBABLE OK, unverified live):** updateContent seam intact
  (assistant-message.js calls it at 3 sites); label bake still
  `theme.italic(theme.fg("thinkingText", this.hiddenThinkingLabel))` —
  stripItalics seam unchanged; pi now assigns hiddenThinkingLabel in the
  constructor AND re-asserts it in a setter — both flow into our own
  accessor's set (raw store) — compatible by design. Needs live probe on
  0.87.1.
- **minimal-mode:** no tool-renderer contract changes spotted in 0.86–0.87
  changelog; verify on restart.
- **Security note:** 0.87.0 added `/bug` which uploads env + transcript
  bundles to Radius by default — pi-lid egress allowlist should know.
- Tripwires unchanged (they gate pi-subagents, not pi core). Action: schedule
  a 0.87.x compat pass (re-mirror status-align, live-probe thought-label,
  restart container on 0.87.1, run the harness) — until then 0.85.1 stays the
  verified version for machines that care about the patch extensions.
