# session-summary

Maintains a one-line LLM-generated session summary as the session name, so
`/resume` (and the status bar) show **what the session is about** instead of
your truncated first prompt.

Forked from [pasky/pi-session-summary](https://github.com/pasky/pi-session-summary)
(MIT) with a decision-model gate and four fixes — see the fork-changes list in
`index.ts` header.

## What the fork adds

**Decision gate** (`decision-gate.ts`) — before every generative summary call,
a System One decision model answers two typed questions about the activity
since the last summary: *did anything material change?* (noul, yes-probability)
and *same topic or drift?* (choice).

- **skip** (confident no-op) → no LLM call at all; the name stays frozen and
  `/resume` names stop churning. The stock extension paid a full-prompt LLM
  call per turn just to be told "nothing changed, repeat verbatim" — and
  LLMs paraphrase, so the name drifted anyway.
- **material change** → incremental update; the prompt now embeds only the
  entries since the last summary (upstream always embedded the whole
  conversation, in both prompt shapes).
- **topic drift** → full re-summarize, recentered on recent work instead of
  anchored on the stale title.
- Uncertain, errored, timed out (5s), or **no API key** → stock behavior,
  silently. The gate can only save a call, never block one.

Provider registry — built-in presets pre-seed `decisionGate.specs`; customs
merge over them, so **adding a decision model is one specs entry + one env
var** (or zero env vars for a local endpoint). `providers` is the cycle order;
a provider is *active* when it has no `apiKeyEnv` (keyless, e.g. local) or its
env var is set. The chain tries active providers in order; a failed provider
falls through to the next and is disabled for the session after 3 consecutive
failures; none active → stock behavior, silently. The gate can only save a
call, never block one.

Built-in presets:

| Name | Wire format | Endpoint | Model | Key env var |
|------|-------------|----------|-------|-------------|
| `liquid` | `systemone` | `api.liquid.ai/decisions/v1/systemone` | `d1:free` | `LIQUID_API_KEY` |
| `typesafe` | `systemone` | `api.typesafe.ai/v1/systemone` | `jev-latest` | `TYPESAFE_API_KEY` |
| `vercel` | `chat` | `ai-gateway.vercel.sh/v1/chat/completions` | `google/gemini-3.1-flash-lite` | `AI_GATEWAY_API_KEY` |
| `vercel-jev` | `systemone` | `ai-gateway.vercel.sh/typesafe/v1/systemone` | `typesafe-ai/jev` | `AI_GATEWAY_API_KEY` |

Notes: `d1:free` is text-only with no published rate limits; Liquid's free-tier
terms permit training on API content — the gate only sends the current summary
plus a compact digest (user messages truncated to 400 chars + tool-call names).
The gateway now HAS a TypeSafe-compatible decision endpoint
(`POST /typesafe/v1/systemone`, live-verified 2026-11-10), but free-tier
gateway keys have no decision-model access at all (models list returns empty;
jev → 403 RestrictedModelsError), so the default `vercel` preset stays on the
`chat` shim (YES/NO → 0.9/0.1) — it works on the free tier's $5/month credit.
Paid tiers can add `vercel-jev` to `providers` for typed probabilities, and
the gateway also carries other decision models (Liquid d1, Laya, Microsoft
Decision-1, Perplexity Decider) plus server-side decision fallbacks
(`providerOptions.gateway.models` with `confidenceBelow` conditions).
`chat` is also the local-model path: a keyless spec + localhost URL gives a
zero-cost, zero-egress tier (e.g. Ollama).

Example — add a custom provider, override a preset, reorder the chain:

```jsonc
{
  "decisionGate": {
    "providers": ["liquid", "openrouter", "local-ollama", "typesafe", "vercel"],
    "specs": {
      "openrouter":   { "type": "systemone", "url": "https://openrouter.ai/api/alpha/decisions", "model": "typesafe/jev", "apiKeyEnv": "OPENROUTER_API_KEY" },
      "local-ollama": { "type": "chat", "url": "http://127.0.0.1:11434/v1/chat/completions", "model": "qwen3:0.6b", "timeoutMs": 8000 },
      "liquid":       { "model": "d1:paid" }
    }
  }
}
```

Spec fields: `type` (`systemone` shared System One contract, or `chat`
OpenAI-compatible YES/NO shim), `url`, `model`, optional `apiKeyEnv` (Bearer
key from that env var; omit for keyless endpoints), optional `timeoutMs`
(gate default 5000). Preset overrides merge per-field — `specs.liquid.model`
keeps the preset's url and key env. Keys are read from environment variables
only; they are never read from or written to config files.

**Other fixes**: resume no longer forces a full re-summarize of the entire
conversation on the first turn after `pi -r` (upstream reset the covered-token
baseline to 0); a manual `/name` is never overwritten (`/summary:clear`
re-enables auto-naming); `/summary:cost` counts gate calls.

## Commands

| Command | Description |
|---------|-------------|
| `/summary:settings` | Create `~/.pi/agent/session-summary.json` with defaults; edit + `/reload` |
| `/summary:update` | Force a full summary update now (bypasses gate and debounce) |
| `/summary:clear` | Reset the summary and name (also re-enables auto-naming) |
| `/summary:cost` | Summary model, LLM + gate call counts, token/cost breakdown. With telemetry on: `/summary:cost project` and `/summary:cost lifetime` roll up the local usage log |
| `/summary:gate` | Gate provider readiness in cycle order + dry-run a verdict |
| `/summary:lock` | Toggle: freeze the current summary without renaming — auto-updates off for the session; run again to resume |

## Summarizer resolution

Pin → cheap-model ladder → **inherit**:

1. **Pin** — `provider` + `model` in config, with optional pi-title-style effort
   suffix: `"model": "zai/glm-5.3-flash:high"`. Efforts: `minimal` (default),
   `low`, `medium`, `high`. The requested effort is **clamped to the model's own
   `thinkingLevelMap`**: unsupported levels fall to the nearest supported level
   below (cost-first), because pi-ai drops unsupported levels on the wire and
   the server default is often the expensive tier (e.g. glm-5.3-flash: no
   minimal/medium, floor is `low`, thinking always on). A bare model gets the
   model's floor automatically; a supported pin like `:high` passes through.
2. **Ladder** — cheap external models, first with a working key:
   Codex-subscription luna → gpt nano/mini → Gemini flash-lite → Haiku.
   A 401/403 (region-blocked or rejected key) skips the whole provider for
   the session — one wasted attempt, not one per sibling model.
3. **Inherit** — the session's own model. Always succeeds on a live session
   (its key demonstrably works) and the prompt never goes anywhere the
   conversation hasn't already been. This is what makes zero-config installs
   work everywhere.

`/summary:settings` materializes the resolved values — except the inherit
rung, which stays dynamic rather than freezing into a pin.

## Lock / rename / clear (behavior matrix)

The summary is written to pi's session-name slot, so pi's native `/name` is the
rename surface — there is no duplicate command:

| Action | Result |
|--------|--------|
| `/name <text>` | Summary frozen at your text; auto-updates off for this session |
| `/name ""` (clear) | Auto-updates resume on next material change |
| `/summary:lock` | Toggle: freeze/resume the current text without renaming |
| `/summary:clear` | Wipe name + state; fresh auto summary next turn |
| Rename while LLM in flight | In-flight result discarded, your text stands |

Locks are **per pi instance**: quit, resume, or `/reload` resumes auto-updates
(persisted metadata can't distinguish a manual name from an auto one). Manual
renames also survive the race against an in-flight summary call.

## Configuration

`~/.pi/agent/session-summary.json` (global) or `.pi/session-summary.json`
(project). All fields optional; project merges over global.

```jsonc
{
  "provider": "",            // pin the summarizer model, else auto-detect ladder
  "model": "",
  "debounceSeconds": 60,
  "maxTokens": 300,
  "resummarizeTokenThreshold": 40000,
  "debugWidget": false,   // opt-in live line below the editor (staleness, errors)
  "verbose": false,          // notify on gate decisions and summary updates
  "runHeadless": false,      // also run in scripted sessions (pi -p, JSON mode) — default off
  "telemetry": {
    "enabled": false,        // opt-in local usage log, see "Local usage log"
    "path": ""               // optional override; default ~/.pi/agent/session-summary/usage.jsonl
  },
  "decisionGate": {
    "enabled": true,
    "providers": ["liquid", "typesafe", "vercel"],
    "confidenceThreshold": 0.7,   // p(material) >= 0.7 → summarize; <= 0.3 → skip
    "timeoutMs": 5000,
    "maxConsecutiveFailures": 3,
    "specs": { }
  }
}
```

See the provider-registry example above for `specs` entries.

Project config (`.pi/session-summary.json`) **layers over** global: scalars
override, and partial `decisionGate`/`telemetry` objects merge with the global
ones instead of replacing them.

## Headless (scripted) sessions

By default the extension only spends calls in interactive sessions (`tui`,
`rpc`). Scripted runs — `pi -p` one-shots, JSON mode, subagent delegations —
skip the gate and summarizer entirely: their names are rarely seen, and the
name write races teardown anyway. To name scripted sessions too, set
`"runHeadless": true`.

## Summarizer model

See "Summarizer resolution" above — the ladder is rung 2 of 3, inherit is the
zero-config default. Pin `provider`/`model` for explicit control (e.g. a GLM
flash-class model), with `:effort` for reasoning effort.

## Local usage log (opt-in)

`"telemetry": { "enabled": true }` appends one JSONL line per summarizer or
gate attempt to `~/.pi/agent/session-summary/usage.jsonl` (created `0600`;
`telemetry.path` overrides). Default **off**, always local, nothing networked.

What a line contains — metadata only:

```jsonc
{ "v": 1, "ts": "2026-10-15T12:00:00.000Z", "kind": "summary",
  "session": "<pi session id>", "project": "/path/to/project", "mode": "tui",
  "update": "incremental", "provider": "openai/gpt-5.4-nano", "outcome": "ok",
  "inputTokens": 1200, "outputTokens": 30, "cost": 0.0002, "ms": 900 }
```

Gate lines swap `update` for `decision` (`skip` / `summarize` /
`resummarize-full`) and add `materialP`. Gate lines may also carry `attempts`: decision
providers that were tried and failed before the answering one (for example
`["liquid: HTTP 401"]`). Error lines carry `outcome: "error"` plus a short
`error` code.

**Never logged:** conversation content, prompts, digests, or the summary text
itself. The summary lives in pi's session file under the same session id —
join there if you need names.

Summary lines also carry `effort` — the actual (post-clamp) reasoning effort
sent. Rollups group LLM providers by `provider:effort`; gate lines stay keyed
by provider. Rollups: `/summary:cost project` (this project's cwd, shown
as `~/...`) and `/summary:cost lifetime` (everything). Plain `/summary:cost` stays the in-memory current-
session view and works with telemetry off. To inspect raw lines:

```sh
jq -c 'select(.kind == "gate")' ~/.pi/agent/session-summary/usage.jsonl
jq -s '[.[].cost // 0] | add' ~/.pi/agent/session-summary/usage.jsonl   # total spend
```

Delete the file to reset; disable via config + `/reload`.

## Verification probe

`probe.mjs` runs 40 checks against the extension with stubbed host modules. No
network, no real keys, no conversation content. It covers config layering, name
sanitization, compaction handling, locking, headless gating, telemetry privacy
and file permissions, effort clamping, and the gate attempt trail.

```
node extensions/session-summary/probe.mjs
```

The probe finds jiti inside an installed pi-coding-agent package. Set
`PI_CODING_AGENT_DIR` if your install lives somewhere unusual. This is a logic
regression probe. Changes that only appear in real terminal rendering still
need a TUI check.
