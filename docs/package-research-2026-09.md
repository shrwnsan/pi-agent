# Package Research: glm-tweaks, ampi, btw, and the subagent landscape

*Research snapshot: 2026-09-17 · Pi 0.85.1 · zai GLM-5.3 / glm-5.3-flash / glm-5-turbo @ thinking `max`*

Evaluation of third-party pi packages for install-vs-port decisions, plus a design
sketch and naming study for a homegrown background-workers extension (working name
`pi-fleet`).

## TL;DR

| Package | Verdict |
| --- | --- |
| `@estebanforge/pi-glm-tweaks` | **Skip** — core fix shipped natively in pi 0.85.1; installing would override our custom `models.json` maps. Port-worthy idea: `zai_web_search`. |
| `@skippermissions/ampi` | **Don't install** (whole locked-mode harness). **Port patterns**: background fleet semantics + markdown subagent loader hardening. |
| btw family | **Install `pi-btw`** (dbachelder) — exact match for side-query + explicit merge-back. |
| `pi-subagents` (nicobailon) | The de-facto subagent standard (428k dl/mo). Try before building anything. |

---

## 1. `@estebanforge/pi-glm-tweaks` v1.7.1 (MIT, active, ~1.5k dl/mo)

1,460 lines, excellent live-probed docs. Built because pi 0.84.x lacked GLM thinking
maps. **Obsolete on 0.85.1**: pi-ai now ships native `thinkingLevelMap` +
`thinkingFormat: "zai"` for `glm-5.2`, `glm-5.3`, `glm-5.3-flash` (verified in
`pi-ai/dist/providers/data/zai.json`), and our `~/.pi/agent/models.json` already
carries hand-tuned maps (aliasing style: `minimal→low`, `medium→high`,
`xhigh→max`).

Installing it would re-register the zai provider on `session_start` and **replace
our maps** (it hides those levels instead of aliasing). Not worth it.

Remaining unique value:

- **`zai_web_search`** — direct MCP-over-HTTP client for Z.AI's Web Search endpoint
  (`lib/zai-search.ts`, 396 lines, zero MCP setup, bills to Coding Plan quota).
  Clean, self-contained, security-checked (only talks to `api.z.ai`). **The one
  piece worth porting** if we want Coding-Plan-billed search in pi.
- Route switching (`/glm-tweaks route coding|api|anthropic`) — niche; we're on the
  coding route already.
- Token-efficiency flags — default OFF, and its own README says don't use
  `glm-budget-nudge` on 5.3+ (post-training fixed the overthinking loop). We're on
  5.3/5.3-flash. Irrelevant.

## 2. `@skippermissions/ampi` v0.3.1 (MIT) — mine for patterns

48k lines: full AMP-style harness (locked modes, deterministic model routing,
quota-aware fallback). The interesting subsets:

- **`ampi-workers`** (11.9k lines): `finder`/`oracle`/`Task`/`librarian` child-Pi
  workers; background runs via `background: true` → opaque `task_id`;
  `task_poll`/`task_wait`/`task_cancel`; **`group:` fan-out** (parallel calls
  sharing a group key → one card, one settle, one grouped notification);
  `notify: false` opt-out; live fleet dashboard.
- **`ampi-custom-subagents`** (2.5k lines): markdown-defined subagents (`sa__*`).

**Why not install:** workers depends on `ampi-core` (runtime registries, feature
gates, tool-provider rules; 9 import sites), and there is no à-la-carte install —
the mode system replaces pi's default posture. `/mode free` exists but carries the
whole harness.

**Loader hardening worth copying verbatim** (from `docs/subagent-framework.md`):
symlink-refusing discovery roots (depth cap 5), skip `.git`/`node_modules`, 256 KiB
per-file cap, per-file failure isolation, null-prototype frontmatter bag with
`__proto__`/`prototype`/`constructor` dropped, stable `sa__<slug>` names ≤120 chars,
fail-closed gating when referenced tools aren't registered.

**Key implementation insight:** ampi spawns child pi processes because pi lacked
in-process nested runs (its `MMR_IN_PROCESS_SUBAGENT_RUNNER_AVAILABLE=false`
fail-closed seam confirms). But `pi-btw` proves `createAgentSession()` in-process
works on 0.85.1 — a lighter runner path ampi hasn't adopted.

## 3. `/btw` — side-question extensions

Spec: *side query of current context; no effect on the parent unless explicitly
forked/merged back as a subagent session.*

| Package | dl/mo | Lines | Approach | Merge path |
| --- | --- | --- | --- | --- |
| **`pi-btw`** (dbachelder) | 11.6k | 2.8k | Real in-process subagent session (`createAgentSession`, tools `read/bash/edit/write`), runs parallel to main; contextual or `/btw:tangent` contextless | ✅ `/btw:inject` (full thread) + `/btw:summarize` → `sendUserMessage(followUp)`; `--save` as session note |
| `@narumitw/pi-btw` | 30.5k | 8.8k | In-process side thread, branch-based context, Mermaid, transcript search | ✅ bring-to-main (answer/range/entire) w/ token estimates |
| `@juicesharp/rpiv-btw` | 8.7k | 1.3k | Purest Claude Code clone: read-only context clone, `completeSimple`, no tools, never touches disk | ❌ |
| `@fradser/pi-btw` | 1.6k | 0.9k | Child pi process, `--no-session`, read-only tools (`read/grep/find/ls`) | ❌ |

**Winner: `pi-btw` (dbachelder)** — literally the spec: side thread inherits main
context but stays out of it; merging is explicit (raw or summarized). Requires
exactly pi 0.85.1. Security scan clean. Caveat: its side session has **write
tools** — if strictly look-don't-touch is wanted, `@fradser/pi-btw` is the
read-only option.

Complements our `answer` extension (extracts questions from the last assistant
message — different job, no conflict).

## 4. The subagent/fleet landscape (context for pi-fleet)

| Package | dl/mo | Lines | Angle |
| --- | --- | --- | --- |
| `pi-subagents` (nicobailon) | **428k** | 101k | De-facto standard. Foreground children in-process; background children in a detached runner on the host SDK. Builtin agents: `scout`/`researcher`/`evidence-auditor`/`worker`/`reviewer`/`oracle`/`delegate`. Plain-language dispatch via a `subagent` tool. |
| `pi-crew` | 3k | ? | Coordinated AI teams, workflows, **worktrees, async task orchestration** — closest overlap to our fleet concept. |
| `pi-squad` | 459 | ? | Task decomposition, dependency management, parallel agents. |
| `pi-hive` | 83 | ? | Hierarchical orchestration + live dashboard. |
| `@henryqw/pi-subagent` | — | 1.9k | Role markdown files (`tools`, `modelClass`, `isolation`), **per-child git worktrees**, evidence-bounded reviews, child `pi --mode json -p` runner. Drags 4 `@henryqw/*` deps. |

**Honest take:** `pi-subagents` delivers ~90% of the fleet value with zero install
baggage. Any homegrown effort must justify itself as (a) learning/control, or (b)
specific gaps the big ones don't cover.

## 5. pi-fleet design sketch (homegrown, zero-dep)

Position: a **lightweight operator's board** for bounded background workers — not a
full orchestration framework.

1. **Runner**: in-process `createAgentSession()` (pi 0.85.1+) as primary; child
   `pi --mode json -p` (henryqw pattern, JSON event stream) only when hard process
   isolation is required. Ephemeral: workers create no saved sessions.
2. **Fleet surface** (from ampi): `background: true` → opaque `task_id`;
   `task_poll`/`task_wait`/`task_cancel`; `group:` fan-out with grouped settle +
   one completion notification; `notify: false`; session-scoped registry; TUI
   board.
3. **Markdown subagents** with ampi's loader hardening (list in §2).
4. **Worktree isolation for writing workers** (henryqw pattern, plain git): one
   worktree per child from HEAD, namespaced branch, `.worktrees/` kept out of
   status via `info/exclude`, degrade silently when not a git repo, throw on setup
   failure in a real repo (never silently lose isolation). Merge back on success;
   discard on failure.
5. **Evidence-bounded reports** (henryqw pattern): findings must cite `file:line`;
   hard caps (e.g. ≤1,000 paths, ≤512 KiB patch text) so a review can't drown the
   parent context.
6. **Budgets**: `max_turns` (henryqw defaults 50), output byte caps, per-task
   timeout; enforce at the runner, not as prompt advice.
7. Estimated size: ~800–1,200 lines. Zero npm deps.

## 6. Naming study

npm reality check (2026-09-17) — the good names are crowded:

| Name | Status |
| --- | --- |
| `pi-fleet` | ❌ taken — Tailscale device orchestration (wrong domain, real confusion risk) |
| `pi-swarm` | ❌ taken — Raspberry Pi cluster tool. Also semantically oversizes: swarm = many loosely-coupled agents; ours is a small governed set with explicit controls. Not worthy. |
| `pi-delegate` | ❌ taken ("Minimal delegate tool for Pi"); also covers only the Task surface |
| `pi-crew` / `pi-hive` / `pi-squad` / `pi-subagents` | ❌ taken by directly competing extensions |
| **`pi-foreman`** | ✅ free — **top pick.** The worker who supervises the crew and reports to the boss (pi/parent). Accurate for board + workers + controls; grounded metaphor; unscoped = pi.dev discoverability |
| **`pi-taskforce`** | ✅ free — a unit assembled for one mission and disbanded; very apt for grouped fan-out |
| `pi-overseer` | ✅ free — dashboard/watch emphasis |
| `pi-workers` / `pi-drones` / `pi-legion` / `pi-hivemind` | ✅ free but generic / mindless-connotation / oversizes / misleading |

Fallback keeping the fleet name: scoped **`@shrwnsan/pi-fleet`** (collision-free;
pi.dev lists scoped names fine, e.g. `@estebanforge/pi-glm-tweaks`).

**Recommendation:** `pi-foreman` (or `@shrwnsan/pi-fleet` if attached to "fleet").

## 7. Recommended actions

1. `pi install npm:pi-subagents` — supersedes any homegrown fleet (see §8).
2. `pi install npm:pi-btw` — audit the `/btw:inject` merge path before trusting it
   with live sessions (§8.4).
3. Skip glm-tweaks + ampi. Port `lib/zai-search.ts` as a small `zai-search`
   extension here — it satisfies pi-subagents' `pi-web-access` prerequisite for
   `researcher`/`evidence-auditor` children while billing the Coding Plan quota
   (§8.4).

## 8. Follow-up deep dive: pi-subagents (2026-09-17)

Deep dive of the 101k-line / 334-file package, run against the §5 pi-fleet sketch,
with a 3-round adversarial review by a Gilfoyle-persona subagent (live `pi -p`
child). Line counts from `src/runs/`:

### 8.1 Our pi-fleet "valuable IP" list vs reality — every item exists, deeper

| pi-fleet item (§5) | pi-subagents reality |
| --- | --- |
| In-process primary + child fallback runner | `src/runs/foreground/` (11.3k lines) + `src/runs/background/` (22.9k lines, detached SDK runner with revival leases, async resume, completion batching/dedupe) |
| `background/group:` fan-out, one card/one settle | `background/parallel-groups.ts` + `fleet-view.ts` + `completion-batcher.ts` |
| TUI fleet board | `fleet-view.ts` |
| Worktree isolation (henryqw pattern) | `shared/worktree.ts` (1,516) + `worktree-cleanup-plan.ts` (869) + setup commands — `worktreeProvider: auto\|native\|worktrunk`, fail-closed placement rejection, diff evidence on handoff. ~2,600 lines we would have written worse |
| Evidence-bounded reports | `shared/mutation-evidence.ts`, per-child worktree review + parent aggregate-diff review (watchdog docs) |
| Loader hardening | Frontmatter schema with `systemPromptMode: replace\|append`, `defaultContext: fork`, `inheritProjectContext`, `aliases`, strict tool allowlists that never inherit ambient extension tools |

### 8.2 IP beyond our list (what we hadn't conceived)

- **`contact_supervisor`** — live bidirectional parent↔child channel; a blocked
  worker asks for a decision mid-run instead of guessing or dying.
- **Watchdog** — opt-in second model reviewing every `agent_end` boundary
  (coalesced diffs, LSP pre-pass before any model call, cadence reviews, child
  overrides).
- **Missions** — durable run records with receipts (PR/CI/deploy links), 256 KiB
  state KV, *goal missions* (token-budgeted continuation drivers).
- **Cold-start packet doctrine** — every child packet must stand alone (goal,
  repo/ref, authority boundary, success criteria, stop/escalation rules); no
  parent-history reliance.
- **External-CLI adapters** — claude-code / codex-exec / cursor-agent as subagents
  via `runner: external-cli` frontmatter; other harnesses become fleet members.
- **`workflowScript` sandbox** — JS orchestration (`runs.run` / `runs.all` /
  `runs.lanes`) with authority ceilings and named resources; `schedule.create`
  for cron-launched work; council mode for bounded multi-advisor deliberation.

### 8.3 Gilfoyle verdicts (3 rounds, verified against source)

- R1 claimed per-child worktrees were "the unsolved embarrassment of every
  subagent package" → R2 retracted after checking `src/runs/shared/worktree.ts`.
- Homegrown fleet justification: **"none. The number is negative."** Every Design-A
  feature ships; the leftovers are deliberate load-bearing "no"s (no user argv
  into adapters, no worktrees inside the checkout). ~1,000 lines owned = cost;
  benefit = pride.
- Loader hardening on a personal loader is threat modeling for an attacker who
  doesn't exist — *unless published to npm*, in which case keep it.
- **Max concurrent running subagents on one codebase: 3**, maybe 4 with provably
  disjoint subtrees — merge contention and review bandwidth are the binding
  constraints, and both scale badly past that.

### 8.4 Role count: how many subagents are actually needed

Shipped taxonomies (pi-subagents 7 builtins, ampi 4, Claude Code ~3) converge on a
much smaller functional set. **Answer: 4 roles for load-bearing work, 3 for most
days; concurrency cap 3–4.**

| Role | Tools | Thinking | Covers |
| --- | --- | --- | --- |
| `researcher` / scout | read, web_search, fetch_content | medium | code recon AND web research (one role; scout is just this with a lower budget — config, not a role) |
| `evidence-auditor` | read-only + web re-fetch | high | verifies citations independently; merge into researcher for low-stakes work |
| `worker` | full local + `contact_supervisor` | high | the only writer; worktree per call |
| `reviewer` | read, grep, find, ls | high | code/diff verification; oracle is just reviewer-with-your-plan — dropped |

Deleted with prejudice: `scout` (researcher w/ lower thinking), `oracle`
(decision-consistency is the parent's job), `delegate` (worker w/o personality),
`librarian` (researcher against GitHub — a tool variant, not a role).
Parallelism comes from fanning out the *same* role across angles, not new roles.
Isolation is a **call flag**, not frontmatter — the orchestrator decides.

### 8.5 Final dispositions for this repo

- **`zai-search`: ship** — 396 lines lifted from glm-tweaks' MIT `lib/zai-search.ts`;
  deletes the pi-web-access dependency for researcher/evidence-auditor children;
  bills quota we already pay. No provider abstraction, no config surface.
- **`pi-btw`: install, but audit `/btw:inject` merge-back first** (Gilfoyle
  dissent: highest-blast-radius code in this comparison — 2.8k lines of unearned
  trust). Fallback: use side-thread-only until the merge path is reviewed.
- **pi-fleet / pi-foreman: buried unnamed.** pi-subagents won. The repo stays
  boring; boring repos still work on Friday.

## 9. Security review: pi-subagents (whitehat pass, 2026-09-17)

Scope: v0.68.0 tarball. Static review of supply chain, egress, sandbox, spawn
surfaces, agent discovery, schedules. **Not** audited line-by-line: the full
22.9k-line background runner internals, jiti/acorn supply chains, and the
separate `pi-web-access` package. `contact_supervisor` bridge validation was
spot-checked (permissions module exists) but not exhaustively traced.

### 9.1 Clean bills

- **Supply chain**: 5 runtime deps (acorn, yaml, typebox, jiti, undici — all
  small, mainstream); **no install scripts** in package.json; ships auditable
  `.ts` source; `install.mjs` is a manual git-clone path unused by
  `pi install npm:`.
- **Egress**: **zero `fetch()` calls in `src/`**. undici is used only to install
  a proxy-aware dispatcher for the background runner. The two https URLs found
  are schema identifier strings, not requests. No telemetry/analytics anywhere.
- **workflowScript sandbox**: executes in a `worker_threads` Worker + `node:vm`
  with `codeGeneration: { strings: false, wasm: false }` (blocks the classic
  eval/Function vm escapes), no `require`/`process` in context, deep-frozen
  `args`, JSON-only emissions, promise-accountability hooks so children can't be
  fire-and-forget. Honest about being blunder-protection, not a hard boundary —
  but the author (parent model) already has bash anyway.
- **`runs.host` exec**: `shell: true` but commands only reach it via
  extension-owned **named resources** with provenance permits; raw scripts are
  refused. Output paths: cwd-relative traversal rejection, regular-non-linked
  file checks, atomic replace. Timeouts + owned process-tree termination.
- **Worktrees**: fail-closed placement rejection before `git worktree add`;
  dedicated-root policy; cleanup plans.
- **External-CLI adapters**: adapter ids locked to the code-owned set
  (claude-code/codex-exec/cursor-agent); binary availability preflight
  (`runner.available`) that the parent must confirm before launch.
- **Children**: strict tool allowlists, never inherit ambient parent extensions
  by default; Windows cmd.exe quoting handled explicitly.

### 9.2 Findings

| # | Sev | Finding | Hardening |
| --- | --- | --- | --- |
| 1 | **Medium** | Project-scope agent discovery defaults ON (`agentScope: "both"`). Cloned repos' `.agents/**/*.md` / project agents load by default; file-defined agents may declare `runner: { type: "external-cli", command: <free string> }` → arbitrary binary execution **if** the model selects that agent (gated by `runner.available` + parent confirmation; catalog advertisement is separately opt-in). | `"agentScope": "user"` when cloning untrusted repos; treat repo agent files like repo Makefiles/CI configs. |
| 2 | **Medium** | Schedules default ON (`scheduledRuns.enabled !== false`) and the store is repo-relative (`<project>/.pi/subagents/schedules`). A cloned repo shipping pre-seeded schedule records is a plausible persistence vector (record validation on load not verified; confirmed `auto-drain` is NOT a trigger — it only waits on launched children). | `"scheduledRuns": { "enabled": false }` until cron features are wanted. |
| 3 | Low | `runs.host` shells out (`shell: true`) | Safe under named-resource provenance; never add user-argv resources. |
| 4 | Info | `contact_supervisor` live parent↔child channel | Permissions module exists; trace fully before enabling nested supervisor flows. |

### 9.3 Verdict

**Conditional GO.** Cleanest security posture of anything reviewed in this doc —
zero telemetry, zero unexpected egress, layered validation with provenance and
ownership checks, shipped with smoke tests. Apply findings 1–2's two config keys
at install time and re-evaluate if cloning untrusted repos into project dirs.

## 10. Build plan v2 (post-security-review)

The fleet build stays dead (§8.3); the review settled *what any future build must
look like*: small enough that its security-review equivalent fits on one page.

### 10.1 Lift list (pi-subagents is MIT — verified 2026-09-17)

| Liftable | Size | Verdict |
| --- | --- | --- |
| `host-command.ts` output-path validation (traversal rejection, regular-non-linked file check, atomic replace) | ~100 lines | ✅ leaf module, lift as-is |
| vm/worker sandbox (`WORKER_SOURCE` + `codeGeneration: {strings:false, wasm:false}` context) | ~200 lines | ✅ only if we ever ship scriptable workflows — skip v1 |
| `worktree.ts` **placement checks only** (fail-closed before `git worktree add`) | ~100 lines | ✅ the checks, not the manager |
| Worktree manager | 1,516+ lines | ❌ hub — use henryqw's 275-line shape as the rewrite reference instead |
| `parallel-groups` / registries / missions | 2.6k–22k lines | ❌ hubs — extraction cost exceeds rewrite cost |
| ampi loader-hardening checklist (§2) | ~100 lines of guards | ✅ pattern, reimplement; lighten to personal-disk threat model unless published |
| glm-tweaks `lib/zai-search.ts` | 396 lines | ✅ already planned (Phase 1) |

Rule the review taught: **lift leaf validators and checklists; never lift hubs.**

### 10.2 Exhumation triggers for `foreman` (dormant)

Build only when **two or more** fire:

1. pi-subagents unmaintained (~6 months without commits/releases) or yanked /
   compromised.
2. A security finding relevant to our threat model that the maintainer won't fix
   (e.g., findings 1–2 class).
3. Daily friction: config weight or architecture fights that cost more than the
   capability is worth over a sustained period.
4. A repeated capability gap in real use (not hypothetical).

One trigger alone → document it here and wait.

### 10.3 Phases

Status legend: ⬜ pending · 🔄 in test · ✅ shipped · 💤 dormant.

**Phase 0 — today.** ⬜ `pi install npm:pi-subagents npm:pi-btw`; pin exact versions
in `~/.pi/agent/settings.json`; apply hardening keys (`agentScope: "user"`,
`scheduledRuns.enabled: false`); 2-week trial.

**Phase 1 — this week.** ⬜ `zai-search` in this repo (`extensions/zai-search/`):

- 396 lines lifted from glm-tweaks `lib/zai-search.ts` (MIT), zero deps.
- Registers `zai_web_search` via `pi.registerTool` — usable by parent **and**
  pi-subagents children (tools list must name it explicitly; children never
  inherit ambient tools).
- Follow-up (v1.1): drop-in `researcher`/`evidence-auditor` agent markdown
  variants that list `zai_web_search` in place of pi-web-access's four tools, so
  those builtins work off Coding-Plan quota. Exact discovery mechanism verified
  at build time (user config agents dir vs project).
- Security spec: single endpoint allowlist (`api.z.ai/api/mcp/...`), 45s
  timeout, key via standard pi auth resolution, no telemetry, no other egress.

**Phase 2 — this week, small.** ⬜ `/btw:inject` merge-path audit: confirm
`sendUserMessage(..., { deliverAs: "followUp" })` lands as a queued user message
(no direct context write), check nothing else writes session entries. Verdict
recorded here; fallback is side-thread-only usage.

**Phase 3 — dormant.** 💤 `foreman` v1 only on §10.2 triggers. Budget ~800 lines,
zero deps (or +`yaml`): in-process `createAgentSession` runner (gen-3),
task registry + `task_poll`/`task_wait`/`task_cancel`, `group:` keys,
harden-list markdown agents, worktrees via lifted placement checks +
henryqw-sized manager, `zai-search` as its web tool. Security spec = §9.1 as a
checklist; the whole extension's review must fit on one page.

### 10.4 Update-cadence security ritual (pi-subagents)

On every version bump: re-run the §9.1 greps (fetch/telemetry/endpoints), read
the changelog for new exec surfaces or config keys, confirm findings 1–2's
config keys still hold. Documented ~30-minute job; skip only for patch bumps
with boring changelogs.

### 10.5 Phase 2.5 — QoL polish (own-repo extensions)

**tps v2 — footer-dialect telemetry line.** Current output is verbose and
label-heavy:

```
TPS 24.2 tok/s. out 864, in 103,783, cache r/w 0/0, total 104,647, 35.7s
```

Target: match the built-in footer's glyph dialect (`↑468k ↓58k R4.2M CH99.8%`),
per-run:

```
⚡24.2 ↑104k ↓864 R4.2M W0 · 35.7s     (cache segments omitted when 0/0)
⚡24.2 ↑104k ↓864 · 35.7s
```

- ⚡ = output tok/s (the headline); ↑ input, ↓ output, R cache-read, W
  cache-write; humanized k/M; separators dim via theme.fg; total dropped
  (redundant — in+out, and the footer owns cumulative context).
- Verify footer arrow semantics from FooterDataProvider before matching.
- ~30-line change in `extensions/tps.ts`; keep `/tps` toggle.

**thinking-label — upstream-first.** Want: `☕︎ Thinking... ▸` while streaming,
`☕︎ Thought · 4s ▸` (or "a few seconds") when done. Findings from pi 0.85.1
dist:

- The plumbing half-exists: `InteractiveMode.setHiddenThinkingLabel(label)`
  propagates to every `AssistantMessageComponent` — but **nothing calls it with
  a label** (only resets to default), there is no settings key, and
  `docs/extensions.md` exposes no message-renderer override. Extensions cannot
  reach this cleanly.
- Plan: small upstream issue/PR to pi-mono — (a) settings keys
  `thinkingLabel`/`thoughtLabel` (+ optional glyph), (b) past-tense state: swap
  label when the streaming message produces its first non-thinking content or
  completes, computing duration from stream start. Contained; the setter chain
  is the PR's backbone.
- Interim: a version-pinned monkey-patch extension is possible but fragile and
  against the repo's small-and-robust ethos — only as an explicitly opt-in
  experiment if requested.

Renumber note: Phase 3 (dormant foreman) stays last; QoL slots as 2.5 between
the btw audit and it.

### 10.6 Phase 2.5 status — ✅ SHIPPED & CONFIRMED (2026-09-18)

- ✅ **tps v2** — footer-dialect line (󱐌/⚡︎ tiers, ↑↓ Σ R W H%, zero-state
  `0.0`, UTC finish stamp with MM-DD rollover), shared `lib/tier-glyphs.ts`
  (also consumed by thought-label; minimal-mode deliberately untouched).
- ✅ **thought-label** — confirmed live end-to-end: `󰧑 thinking… ▸` shimmer
  (80ms ticks, 0.6 rad/tick sweep; faint-band wave, glyph included, no
  italics/caps/emphasis) → `󰧑 thought · Xs ▸` (live-measured turns).
  Historical durations RECONSTRUCTED from session-entry timestamps at
  session_start (1h cap). v4.5 fix: strip detection matches ANSI-stripped
  plain text — wave faint-marks split words with SGR codes, so raw-byte
  matching silently skipped streaming frames.
- ✅ **minimal-mode** — edit exempted from collapsing: pi's native
  renderShell:"self" live-diff renderer wins (root-caused via
  renderers/edit.js); read/write keep boxed one-liners.
- README extensions-table entries added.
- Key lessons baked into the code: chalk REWRITES close sequences inside
  strings ([23m → [3m) — cancel-italic must be done post-bake on final bytes;
  class fields defeat prototype accessors — patch methods, instrument
  instances; wave runs only during thinking-only streaming (cheap rebuilds).
- ⏸ upstream thinking-label issue/PR — on hold; interim patch is the vehicle.
  Revisit if the patch chafes or a pi upgrade breaks the seam (the extension
  self-disables and says so).
