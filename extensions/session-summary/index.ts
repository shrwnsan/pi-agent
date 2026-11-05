/**
 * session-summary v1.3.7 (pi-agent fork) — maintains a one-line LLM-generated
 * session summary as the session name, so it shows up in pi's status bar and
 * the /resume session list instead of the truncated first user message.
 *
 * Forked from pasky/pi-session-summary 1.0.2 (MIT, https://github.com/pasky/pi-session-summary).
 * Fork changes (see ./decision-gate.ts for the gate itself):
 *
 *   1. Decision gate — before every generative summary call, a decision model
 *      (System One contract via Liquid d1:free / TypeSafe Jev / any compatible
 *      endpoint, or a chat-completions YES/NO shim for Vercel AI Gateway and
 *      local models) decides whether anything material changed since the last
 *      summary. Confident no-op turns are skipped entirely: no LLM call, name
 *      stays frozen, /resume names stop churning. Topic drift forces a full
 *      re-summarize recentered on recent work. The gate is optional and key-
 *      gated: providers live in decisionGate.specs (built-in presets + your
 *      customs, cycled in decisionGate.providers order); a provider is active
 *      only when its key env var is set (or it's keyless, e.g. local) — none
 *      active → stock behavior, silently.
 *   2. Delta prompts — the stock extension always embedded the FULL
 *      conversation in both prompt shapes (the "conversation since that
 *      summary" wording was aspirational). Incremental updates now embed only
 *      the entries since the last summary; full rebuilds happen on the first
 *      summary, /summary:update, topic drift, or when the delta alone exceeds
 *      resummarizeTokenThreshold.
 *   3. Resume fix — stock reset the covered-token baseline to 0 on session
 *      start, so the first post-resume turn always triggered a full
 *      re-summarize of the entire conversation. The baseline now starts at
 *      the current branch length (everything on disk was already summarized).
 *   4. Manual-name guard — a name set via /name (anything not written by this
 *      extension) is never overwritten; /summary:clear re-enables auto-naming.
 *   5. /summary:gate — inspect gate provider status and dry-run a verdict.
 *   6. Summarizer resolution (v1.2.0): explicit pin → cheap-model ladder →
 *      the session's own model (inherit) — zero-config machines get working
 *      summaries with the prompt never leaving providers it already uses.
 *      Pins accept pi-title-style `:effort` suffixes (provider/model:high);
 *      default effort is minimal. Ladder walk-out: 401/403 provider errors
 *      (v1.2.1 — e.g. region-blocked keys) reject the whole provider for the
 *      session instead of burning one attempt per sibling model.
 *   7. /summary:lock (v1.2.0) — toggle: freeze the current summary without
 *      renaming; auto-updates stop for the session, next turn after unlock
 *      reconciles the gap. Per-instance: restart/reload resumes auto.
 *   8. First-run whisper (v1.2.0) — one toast per pi process on the first
 *      successful summary, independent of verbose.
 *   9. Opt-in local usage log (v1.3.0, ./telemetry.ts) — telemetry.enabled
 *      appends one metadata line per summarizer/gate attempt to
 *      ~/.pi/agent/session-summary/usage.jsonl (created 0600): when, which
 *      session/project, provider/model, outcome, tokens, cost, gate verdict +
 *      probability. Never conversation content, prompts, or summary text.
 *      /summary:cost [project|lifetime] rolls the log up; plain
 *      /summary:cost stays the in-memory session view.
 *  10. Headless opt-in (v1.3.0) — scripted sessions (pi -p, JSON mode) no
 *      longer spend summarizer/gate calls by default; runHeadless: true opts
 *      back in. Interactive modes (tui, rpc) are unaffected.
 *
 *  v1.3.0 fixes: project config now layers over global (a project file used
 *  to wipe global decisionGate customization); self-written names are
 *  sanitized with pi's exact appendSessionInfo rule so a stray \r can no
 *  longer trip the manual-name guard and freeze auto-naming; full rebuilds
 *  embed the compaction summary so post-compaction re-summarizes don't
 *  forget pre-compaction work; /summary:update reports a locked summary
 *  instead of silently doing nothing; gate skips reset the widget's stale
 *  counter; empty/unrenderable deltas are consumed instead of escalating to
 *  a full rebuild.
 *  v1.3.1 fix: requested reasoning effort is clamped to the model's
 *  thinkingLevelMap. pi-ai drops unsupported levels on the wire, letting the
 *  server default apply — for glm-5.3-flash that default is the expensive
 *  tier, so "minimal" was silently the priciest posture. Unsupported efforts
 *  now fall to the nearest supported level below (cost-first); unsupported
 *  defaults (minimal on glm-5.3-flash) land on the model's floor (low).
 *  /summary:settings also preserves the :effort suffix when materializing a
 *  pin, instead of silently dropping it to the default.
 *  v1.3.3: summary telemetry events record the actual (post-clamp) reasoning
 *  effort; /summary:cost rollups group LLM providers by provider:effort and
 *  display the project label tildified (~/...) — log keeps absolute paths.
 *  v1.3.4: /summary:cost rollups render two labeled ledgers — LLMs and
 *  Decision models — instead of one flat call-count-sorted list, and call
 *  counts pluralize correctly.
 *  v1.3.5: Decision models render first, matching execution order (the gate
 *  literally runs before the summarizer).
 *  v1.3.6: gate decision events record an attempts trail (providers tried and
 *  failed before the answering one, e.g. ["liquid: HTTP 401"]); the headless
 *  verification probe ships as probe.mjs (+ probe/stubs/) and runs offline.
 *  v1.3.7: /summary:gate joins provider status and its outcome into one
 *  notify. The previous separate status notify was replaced by the outcome
 *  message under pi's notify collapse, so provider readiness (fail counts,
 *  key state) was never visible.
 *  v1.3.2 fix: /summary:cost project|lifetime and /summary:gate emitted their
 *  rollups as successive info notifies; pi's TUI collapses consecutive info
 *  notifies into one status line (only the last message survives), so users
 *  saw a single provider line. Both now render as one multi-line notify.
 *
 * Unchanged from upstream: summary model auto-detection (cheap-model ladder,
 * pin provider/model in config to override), 60s debounce, /summary:settings
 * | update | clear | cost, status-bar widget (opt-in), fire-and-forget LLM
 * calls with stale-ctx guards.
 *
 * Config: ~/.pi/agent/session-summary.json (global) or .pi/session-summary.json
 * (project override). Keys live in env vars, never in config files.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { complete } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	buildActivityDigest,
	createGateState,
	gateProviderStatus,
	resolveGateConfig,
	runDecisionGate,
	type DecisionGateConfig,
	type GateState,
	type GateVerdict,
} from "./decision-gate.ts";
import {
	emitTelemetry,
	readRollup,
	tildify,
	TELEMETRY_DEFAULTS,
	type SummaryEventData,
	type TelemetryBase,
	type TelemetryConfig,
} from "./telemetry.ts";
import type { ContentBlock, SessionEntry } from "./session-entries.ts";

// -- Configuration --------------------------------------------------------

interface SummaryConfig {
	provider?: string;
	model?: string;
	debounceSeconds: number;
	maxTokens: number;
	resummarizeTokenThreshold: number;
	debugWidget: boolean;
	verbose: boolean;
	/** Also summarize/gate in scripted sessions (pi -p, JSON mode). Default false. */
	runHeadless: boolean;
	telemetry: TelemetryConfig;
	decisionGate: DecisionGateConfig;
}

const DEFAULTS: SummaryConfig = {
	debounceSeconds: 60,
	maxTokens: 300,
	resummarizeTokenThreshold: 40_000,
	debugWidget: false,
	verbose: false,
	runHeadless: false,
	telemetry: { ...TELEMETRY_DEFAULTS },
	decisionGate: resolveGateConfig(),
};

/** Models to try in order when no explicit model is configured.
 *  Entries are either `provider/id` (exact provider) or a bare `id`, matched by exact id
 *  first, then by `vendor/<id>` suffix (openrouter-style ids). Bare ids never match
 *  providers in AUTO_DETECT_SKIP_PROVIDERS. */
const AUTO_DETECT_MODELS = [
	// ChatGPT-subscription Codex: no per-token cost, and luna is the smallest model it serves.
	"openai-codex/gpt-5.6-luna",
	"gpt-5.4-nano",
	"gpt-5.4-mini",
	"gemini-3.1-flash-lite",
	"gemini-3-flash-preview",
	"claude-haiku-4-5",   // anthropic id
	"claude-haiku-4.5",   // openrouter id (anthropic/claude-haiku-4.5)
];

/** LLM call deadline; the call is fire-and-forget so a hung request must not pin pendingLLMCall forever. */
const LLM_TIMEOUT_MS = 60_000;

/** Providers that only serve their own agent models and reject generic small models
 *  (e.g. ChatGPT-OAuth Codex: "The 'gpt-5.4-mini' model is not supported when using Codex"). */
const AUTO_DETECT_SKIP_PROVIDERS = new Set(["openai-codex"]);

/** Reasoning efforts accepted in a `provider/model:effort` spec (pi-title convention). */
const KNOWN_EFFORTS = new Set(["minimal", "low", "medium", "high"]);

/** All pi thinking levels, cheapest first — used to fall back when a model's
 *  thinkingLevelMap marks a requested effort unsupported (null). */
const EFFORT_ORDER = ["minimal", "low", "medium", "high", "xhigh", "max"];

/** Clamp a requested reasoning effort to what the model actually supports.
 *
 *  pi-ai's wire layers drop unsupported levels silently (thinkingLevelMap[level]
 *  === null → no reasoning_effort param), which lets the SERVER default kick in.
 *  For models like glm-5.3-flash — thinking always on, server default is the
 *  expensive tier — that makes an unsupported "cheap" request quietly MORE
 *  expensive, not less. So clamp cost-first: unsupported levels fall to the
 *  nearest supported level BELOW the request; if none below, the cheapest
 *  supported overall. Supported requests and map-less models pass through. */
function clampEffort(effort: string, model: { thinkingLevelMap?: unknown }): string {
	const map = model.thinkingLevelMap as Record<string, string | null> | undefined;
	if (!map || typeof map !== "object") return effort;
	if (typeof map[effort] === "string") return effort;
	let fallback: string | undefined;
	for (const level of EFFORT_ORDER) {
		if (level === effort) break;
		if (typeof map[level] === "string") fallback = level;
	}
	if (fallback) return fallback;
	for (const level of EFFORT_ORDER) {
		if (typeof map[level] === "string") return level;
	}
	return effort; // map marks nothing supported — pass through, server decides
}

/** Parse a model spec: `provider/model`, bare `model`, either with an optional
 *  `:effort` suffix (`zai/glm-5.3-flash:high`). Unknown efforts fall back to
 *  minimal with a console error; model ids containing `:` (openrouter `:free`)
 *  are unaffected because only known effort names are peeled off. */
function parseModelSpec(spec: string): { provider?: string; model: string; effort?: string } {
	let effort: string | undefined;
	let rest = spec;
	const colon = spec.lastIndexOf(":");
	if (colon >= 0) {
		const candidate = spec.slice(colon + 1);
		if (KNOWN_EFFORTS.has(candidate)) {
			effort = candidate;
			rest = spec.slice(0, colon);
		}
	}
	const slash = rest.indexOf("/");
	return slash >= 0
		? { provider: rest.slice(0, slash), model: rest.slice(slash + 1), effort }
		: { model: rest, effort };
}

function loadConfig(cwd: string): SummaryConfig {
	const globalPath = join(getAgentDir(), "session-summary.json");
	const projectPath = join(cwd, ".pi", "session-summary.json");

	let config: SummaryConfig = { ...DEFAULTS, telemetry: { ...TELEMETRY_DEFAULTS } };

	for (const path of [globalPath, projectPath]) {
		if (existsSync(path)) {
			try {
				const parsed = JSON.parse(readFileSync(path, "utf-8"));
				// Layer over what's accumulated: scalars override, but the gate config
				// re-resolves over the merged state so a project file without a
				// decisionGate key (or with a partial one) keeps global customization
				// instead of resetting the registry to presets.
				const gate = parsed.decisionGate
					? resolveGateConfig({ ...config.decisionGate, ...parsed.decisionGate })
					: config.decisionGate;
				config = {
					...config,
					...parsed,
					telemetry: { ...config.telemetry, ...parsed.telemetry },
					decisionGate: gate,
				};
			} catch (err) {
				console.error(`[session-summary] Failed to load config from ${path}: ${err}`);
			}
		}
	}

	return config;
}

// -- Helpers --------------------------------------------------------------

/** Rough token estimate: ~4 chars per token. */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/** Mirror pi's appendSessionInfo sanitizer exactly (strips [\r\n]+ runs, then
 *  trims). The manual-name guard compares our own writes byte-for-byte against
 *  what pi stores, so self-writes must be sanitized before assignment — a
 *  stray \r surviving our old \n-only collapse used to trip the guard and
 *  silently freeze auto-naming for the session. */
function sanitizeName(name: string): string {
	return name.replace(/[\r\n]+/g, " ").trim();
}

/** Extract only user+assistant text from a content field, collapsing tool i/o. */
function renderContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const b = block as ContentBlock;
		if (b.type === "text" && typeof b.text === "string") {
			parts.push(b.text);
		} else if (b.type === "toolCall" && typeof b.name === "string") {
			parts.push(`[tool call: ${b.name}]`);
		}
	}
	return parts.join("\n");
}

/** Build a compact conversation string from session entries.
 *  Skips tool results except for a tiny marker. */
function buildConversation(entries: SessionEntry[]): string {
	const lines: string[] = [];

	for (const entry of entries) {
		if (entry.type !== "message" || !entry.message?.role) continue;
		const role = entry.message.role;

		if (role === "user") {
			const text = renderContent(entry.message.content).trim();
			if (text) lines.push(`User: ${text}`);
		} else if (role === "assistant") {
			const text = renderContent(entry.message.content).trim();
			if (text) lines.push(`Assistant: ${text}`);
		} else if (role === "toolResult") {
			// Tiny marker only
			const contentStr = renderContent(entry.message.content);
			const bytes = new TextEncoder().encode(contentStr).length;
			lines.push(`[tool result: ${bytes} bytes]`);
		} else if (role === "compactionSummary") {
			const text = renderContent(entry.message.content).trim();
			if (text) lines.push(`[compaction summary: ${text}]`);
		}
	}

	return lines.join("\n");
}

/** Get the most recent compaction summary from the branch (if any). */
function getCompactionSummary(entries: SessionEntry[]): string | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e.type === "message" && e.message?.role === "compactionSummary") {
			const text = renderContent(e.message.content).trim();
			if (text) return text;
		}
		// Also check compaction entry type
		if ((e as any).type === "compaction" && typeof (e as any).summary === "string") {
			return (e as any).summary;
		}
	}
	return undefined;
}

// -- Extension ------------------------------------------------------------

export default function sessionSummaryExtension(pi: ExtensionAPI) {
	// -- State ------------------------------------------------------------
	let config: SummaryConfig = { ...DEFAULTS };  // loaded from session-summary.json
	let resolvedModelName = "";  // display name of the auto-detected or configured model
	let totalCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
	let totalTokens = { input: 0, output: 0 };
	let llmCallCount = 0;
	let gateCallCount = 0;         // decision-gate calls that returned a verdict
	let lastSummary = "";          // last successful LLM-generated summary
	let turnsSinceSummary = 0;     // agent_end calls since last summary update
	let lastSummaryTime = 0;       // Date.now() of last summary completion
	let pendingLLMCall = false;    // is an LLM call in flight?
	let lastError = "";            // last error (code only)
	let errorNotified = false;     // has the user been told about the current failure streak?
	const rejectedModels = new Set<string>(); // provider/id that returned a provider error this session
	const rejectedProviders = new Set<string>(); // providers with fatal errors (401/403) — all their models fail identically
	let latestCtx: ExtensionContext | undefined; // most recent ctx for widget updates

	// Fork state
	let processedEntryCount = 0;   // branch entries covered by lastSummary (delta baseline)
	let manualName = false;        // user set a name via /name — never overwrite until /summary:clear
	let firstRunToasted = false;   // one whisper per pi process, independent of verbose
	let gateState: GateState = createGateState();

	/**
	 * A captured ctx becomes stale after a session replacement/reload (e.g. when an
	 * async LLM call completes after a non-interactive run has been torn down).
	 * Touching any getter on a stale ctx throws, so probe one cheaply.
	 */
	function isCtxStale(ctx: ExtensionContext): boolean {
		try {
			void ctx.hasUI;
			return false;
		} catch {
			return true;
		}
	}

	// -- Persist + session name helpers -----------------------------------

	/** Restore summary from the persisted session name. Returns true if a name existed. */
	function restoreFromSessionName(): boolean {
		try {
			const name = pi.getSessionName();
			if (name) {
				lastSummary = name;
				return true;
			}
		} catch {
			// pi runtime invalidated (session replaced mid-start) -- keep current state
		}
		return false;
	}

	/** Reset all in-memory state to blank. */
	function resetState() {
		lastSummary = "";
		turnsSinceSummary = 0;
		lastSummaryTime = 0;
		pendingLLMCall = false;
		lastError = "";
		errorNotified = false;
		rejectedModels.clear();
		rejectedProviders.clear();
		resolvedModelName = "";
		totalCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
		totalTokens = { input: 0, output: 0 };
		llmCallCount = 0;
		gateCallCount = 0;
		manualName = false;
		gateState = createGateState();
		// processedEntryCount is NOT reset here: entries on disk stay covered by
		// whatever summary exists; a cleared summary always triggers a full rebuild anyway.
	}

	// -- Model resolution -------------------------------------------------

	/** Resolve the summarizer: explicit pin → cheap-model ladder → the session's
	 *  own model (inherit). The inherit rung always succeeds on a live session —
	 *  its key demonstrably works and the prompt never goes anywhere the
	 *  conversation hasn't already been. */
	function resolveModel(ctx: ExtensionContext): { provider: string; model: string; effort?: string; inherited?: boolean } | undefined {
		if (config.provider && config.model) {
			const spec = parseModelSpec(config.model);
			resolvedModelName = `${config.provider}/${spec.model}${spec.effort ? ":" + spec.effort : ""}`;
			return { provider: config.provider, model: spec.model, effort: spec.effort };
		}

		// Auto-detect: find the first available model from the priority list
		// Models that already failed with a provider error this session are skipped so one
		// broken/exhausted provider doesn't monopolize every attempt.
		const all = ctx.modelRegistry.getAvailable()
			.filter((m) => !rejectedModels.has(`${m.provider}/${m.id}`))
			.filter((m) => !rejectedProviders.has(m.provider));
		const generic = all.filter((m) => !AUTO_DETECT_SKIP_PROVIDERS.has(m.provider));
		for (const candidate of AUTO_DETECT_MODELS) {
			const slash = candidate.indexOf("/");
			const provider = slash >= 0 ? candidate.slice(0, slash) : undefined;
			const candidateId = slash >= 0 ? candidate.slice(slash + 1) : candidate;
			const match = provider
				? all.find((m) => m.provider === provider && m.id === candidateId)
				: generic.find((m) => m.id === candidateId)
					?? generic.find((m) => m.id.endsWith(`/${candidateId}`));
			if (match) {
				resolvedModelName = `${match.provider}/${match.id}`;
				return { provider: match.provider, model: match.id };
			}
		}

		// Inherit rung: the session model. Never matches the ladder (external
		// providers), so this only fires when no ladder model exists — zero-config
		// machines where pi itself demonstrably works.
		const current = (ctx as any).model as { provider?: string; id?: string } | undefined;
		if (current?.provider && current?.id) {
			resolvedModelName = `${current.provider}/${current.id} (inherited)`;
			return { provider: current.provider, model: current.id, inherited: true };
		}

		resolvedModelName = "";
		return undefined;
	}

	// -- Widget rendering -------------------------------------------------

	function updateWidget(ctx: ExtensionContext) {
		if (isCtxStale(ctx)) return;
		if (!ctx.hasUI) return;
		// Surface a failure once per failure streak even with the widget off -- otherwise
		// a broken model/auth setup silently stops summaries for good. (Reset on success.)
		if (lastError && !errorNotified) {
			errorNotified = true;
			ctx.ui.notify(`[session-summary] ${resolvedModelName || "(no model)"}: ${lastError}`, "warning");
		}
		if (!config.debugWidget) {
			ctx.ui.setWidget("session-summary", undefined);
			return;
		}

		// Build the display line
		const parts: string[] = [];
		const branch = ctx.sessionManager.getBranch();
		const compaction = getCompactionSummary(branch);

		if (compaction || lastSummary) {
			if (compaction && lastSummary) {
				// Truncate compaction to keep it short
				const shortCompaction = compaction.length > 80
					? compaction.slice(0, 77) + "..."
					: compaction;
				parts.push(`${shortCompaction} | ${lastSummary}`);
			} else if (lastSummary) {
				parts.push(lastSummary);
			} else if (compaction) {
				const shortCompaction = compaction.length > 120
					? compaction.slice(0, 117) + "..."
					: compaction;
				parts.push(shortCompaction);
			}
		}

		if (parts.length === 0 && turnsSinceSummary === 0) {
			// Nothing to show yet — display waiting message with model info
			if (resolvedModelName) {
				ctx.ui.setWidget("session-summary", [`Waiting for first message (will use ${resolvedModelName} to summarize)`], { placement: "belowEditor" });
			} else if (lastError) {
				ctx.ui.setWidget("session-summary", [`[session-summary] ${lastError}`], { placement: "belowEditor" });
			} else {
				ctx.ui.setWidget("session-summary", undefined);
			}
			return;
		}

		let line = parts.join("");

		// Staleness indicators
		if (turnsSinceSummary > 0) {
			if (lastSummary) {
				// Summary exists but is stale -- prepend age
				line = `[${turnsSinceSummary} turn${turnsSinceSummary > 1 ? "s" : ""} ago] ${line}`;
			} else {
				// No summary yet -- show turn count as the content
				const turnsLabel = turnsSinceSummary === 1 ? "1 new turn" : `${turnsSinceSummary} new turns`;
				line = line ? `${line} + ${turnsLabel}` : turnsLabel;
			}
		}

		// Append error code if any
		if (lastError) {
			line = `${line} [err: ${lastError}]`;
		}

		// Truncate to terminal width to prevent wrapping
		const cols = process.stdout.columns || 120;
		if (line.length > cols - 2) {
			line = line.slice(0, cols - 5) + "...";
		}

		ctx.ui.setWidget("session-summary", [line], { placement: "belowEditor" });
	}

	// -- LLM summary generation -------------------------------------------

	async function generateSummary(
		ctx: ExtensionContext,
		opts?: { deltaEntries?: SessionEntry[]; forceFull?: boolean },
	) {
		try {
			await generateSummaryInner(ctx, opts);
		} catch (err) {
			// A session replacement/reload can invalidate ctx between our awaits;
			// every ctx getter then throws. Nothing to render into -- just stop.
			if (isCtxStale(ctx)) return;
			// Genuine failure: surface it in the widget and let the caller see it
			// (/summary:update awaits us, so it reaches the runner's diagnostics).
			const msg = (err as any)?.message || String(err);
			lastError = msg.slice(0, 80);
			updateWidget(ctx);
			throw err;
		}
	}

	async function generateSummaryInner(
		ctx: ExtensionContext,
		opts?: { deltaEntries?: SessionEntry[]; forceFull?: boolean },
	) {
		if (pendingLLMCall) return;
		if (isCtxStale(ctx)) return;
		if (manualName) return; // user owns the name

		const resolved = resolveModel(ctx);
		if (!resolved) {
			lastError = "No summary model — set provider/model in ~/.pi/agent/session-summary.json (/summary:settings)";
			updateWidget(ctx);
			return;
		}

		const model = ctx.modelRegistry.find(resolved.provider, resolved.model);
		if (!model) {
			lastError = "MODEL_NOT_FOUND";
			updateWidget(ctx);
			return;
		}

		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		// The await above can span a session replacement -- re-check before touching ctx.
		if (isCtxStale(ctx)) return;
		if (!auth?.ok || !auth.apiKey) {
			lastError = "NO_API_KEY";
			updateWidget(ctx);
			return;
		}

		const branch = ctx.sessionManager.getBranch();
		// Branch shrank (fork / branch switch) — the delta baseline is invalid; rebuild full.
		let deltaEntries = opts?.deltaEntries;
		if (deltaEntries && processedEntryCount + deltaEntries.length > branch.length) deltaEntries = undefined;

		// Decide: full rebuild vs incremental update. Full rebuild consumes the
		// whole conversation; incremental embeds only the uncovered delta.
		const deltaConv = deltaEntries?.length ? buildConversation(deltaEntries) : "";
		// A provided delta that renders to nothing (empty slice, or only metadata
		// entries like usage/model_change) is a no-op, NOT a reason to rebuild the
		// whole conversation. Consume it so it doesn't rescan every turn.
		if (deltaEntries && lastSummary && !opts?.forceFull && !deltaConv.trim()) {
			processedEntryCount += deltaEntries.length;
			return;
		}
		const deltaTokens = deltaConv ? estimateTokens(deltaConv) : Infinity;
		const shouldResummarize = !lastSummary || !!opts?.forceFull || deltaTokens >= config.resummarizeTokenThreshold;

		const fullConversation = shouldResummarize ? buildConversation(branch) : "";
		const conversation = shouldResummarize ? fullConversation : deltaConv;
		if (!conversation.trim()) return;

		// Entries this call will cover on success (captured now: the branch can
		// grow while the fire-and-forget LLM call is in flight; the leftovers
		// simply ride along in the next delta).
		const coveredCount = deltaEntries?.length ? processedEntryCount + deltaEntries.length : branch.length;

		// Full rebuilds must survive compaction: buildConversation skips
		// CompactionEntry (not type "message"), so post-compaction rebuilds would
		// otherwise only see entries after the compression point. Re-attach the
		// compaction summary as context so the name keeps the pre-compaction thread.
		const compaction = shouldResummarize ? getCompactionSummary(branch) : undefined;
		const compactionNote = compaction
			? `[Earlier session context, compacted away]: ${compaction.slice(0, 2000)}${compaction.length > 2000 ? "…" : ""}\n\n`
			: "";

		let prompt: string;
		if (shouldResummarize) {
			prompt = [
				"Summarize this coding session in a SINGLE SHOT line (max ~80 chars).",
				"Highlight: headline of the current problem the user is working on (taking into account current progress, and immediate next step if outlined).",
				"Be maximally specific and concrete.",
				"",
				"<conversation>",
				compactionNote + conversation,
				"</conversation>",
			].join("\n");
		} else {
			prompt = [
				"Here is the previous one-line summary of this coding session:",
				`<summary>${lastSummary}</summary>`,
				"",
				"Here is what happened in the conversation since that summary was generated:",
				"<conversation>",
				conversation,
				"</conversation>",
				"",
				"Update the summary ONLY if the conversation means a major update - default should be to repeat it verbatim.",
				"If nothing material changed, return the previous summary exactly.",
				"Summarize this coding session (not just progress from last time!) in a SINGLE SHOT line (max ~80 chars).",
				"Highlight: headline of the current problem the user is working on - in the whole session, not just the <conversation> increment (taking into account current progress, and immediate next step if outlined).",
				"Be maximally specific and concrete.",
			].join("\n");
		}

		pendingLLMCall = true;

		// Telemetry facts captured synchronously: ctx getters can go stale mid-flight.
		const callStarted = Date.now();
		const telemetryBase: TelemetryBase = {
			kind: "summary",
			session: ctx.sessionManager.getSessionId() ?? "(unknown)",
			project: ctx.cwd,
			mode: ctx.mode,
		};
		const telemetryProvider = `${model.provider}/${model.id}`;
		const telemetryUpdate: SummaryEventData["update"] = shouldResummarize ? "full" : "incremental";

		// Fire-and-forget: non-blocking async LLM call
		// Reasoning effort: pin-specified via `:effort` suffix, else minimal — then
		// clamped to the model's own thinkingLevelMap. Without the clamp an
		// unsupported level is dropped on the wire and the server default (often
		// the expensive tier, e.g. glm-5.3-flash) quietly applies instead.
		const requestedEffort = resolved.effort ?? "minimal";
		const effort = clampEffort(requestedEffort, model);
		if (effort !== requestedEffort && config.verbose && latestCtx && !isCtxStale(latestCtx) && latestCtx.hasUI) {
			try {
				latestCtx.ui.notify(`[session-summary] effort ${requestedEffort} unsupported by ${model.id} — using ${effort}`, "info");
			} catch { /* stale ctx */ }
		}
		complete(model, {
			systemPrompt: "You are a concise summarizer. Output a single line summary of a coding session.",
			messages: [{
				role: "user" as const,
				content: [{ type: "text" as const, text: prompt }],
				timestamp: Date.now(),
			}],
		}, {
			apiKey: auth.apiKey,
			headers: auth.headers,
			// Note: the Codex (ChatGPT OAuth) API does not honor maxTokens; the prompt's
			// "single line" instruction is the effective cap there.
			maxTokens: config.maxTokens,
			reasoning: effort as any,
			timeoutMs: LLM_TIMEOUT_MS,
		} as any)
			.then((response) => {
				// Track usage/cost
				if (response.usage) {
					totalTokens.input += response.usage.input;
					totalTokens.output += response.usage.output;
					if (response.usage.cost) {
						totalCost.input += response.usage.cost.input;
						totalCost.output += response.usage.cost.output;
						totalCost.cacheRead += response.usage.cost.cacheRead;
						totalCost.cacheWrite += response.usage.cost.cacheWrite;
						totalCost.total += response.usage.cost.total;
					}
				}
				llmCallCount++;
				// Handle provider-level errors (e.g. codex "invalid_workspace_selected")
				if (response.stopReason === "error") {
					const errMsg = response.errorMessage || "unknown provider error";
					// Extract a short code from JSON error responses. Providers prefix the
					// payload ("OpenAI API error (403): {…}") — parse the embedded JSON,
					// not the whole string.
					let code = errMsg;
					try {
						const jsonStart = errMsg.indexOf("{");
						const parsed = jsonStart >= 0 ? JSON.parse(errMsg.slice(jsonStart)) : null;
						code = (parsed && (parsed.code
							|| parsed?.detail?.code
							|| parsed?.error?.code
							|| parsed?.error?.message
							|| (typeof parsed?.detail === "string" ? parsed.detail : null))) || errMsg;
					} catch {}
					lastError = String(code).slice(0, 80);
					// Only auto-detected models get rejected; an explicitly configured model is the user's call.
					if (!(config.provider && config.model)) {
						rejectedModels.add(`${model.provider}/${model.id}`);
						// Fatal provider errors — auth/region (HTTP 401/403): every model
						// from that provider fails identically, so skip the whole provider,
						// not just this model. Transient errors (429/5xx) stay model-scoped.
						if (/\(40[13]\)/.test(errMsg) || code === "unsupported_country_region_territory") {
							rejectedProviders.add(model.provider);
						}
					}
					emitTelemetry(config.telemetry, telemetryBase, {
						update: telemetryUpdate,
						provider: telemetryProvider,
						effort,
						outcome: "error",
						error: String(code).slice(0, 80),
						ms: Date.now() - callStarted,
					});
					return; // don't update summary
				}

				const text = response.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join(" ")
					.trim()
					// Collapse to single line
					.replace(/\n+/g, " ");

				if (text) {
					const summaryText = sanitizeName(text);
					const changed = summaryText !== lastSummary;
					lastSummary = summaryText;
					processedEntryCount = coveredCount;
					turnsSinceSummary = 0;
					lastSummaryTime = Date.now();
					lastError = "";
					errorNotified = false;
					// First-run whisper: one per pi process (not reset by resetState),
					// independent of verbose — the community-norm "it's working" moment.
					let toast: string | undefined;
					if (!firstRunToasted) {
						firstRunToasted = true;
						toast = "session-summary: /resume now shows one-line summaries · /summary:settings to tune";
					} else if (config.verbose && changed) {
						const mode = shouldResummarize ? "resummarize" : "incremental";
						toast = `[summary:${mode}] ${lastSummary}`;
					}
					// The captured pi/ctx may be stale if the session was replaced while
					// this async call was in flight (e.g. non-interactive runs). Skip the
					// side effects in that case -- the state above is already updated.
					if (!latestCtx || !isCtxStale(latestCtx)) {
						try {
							// Update session name so it shows in /resume — unless the user
							// manually named the session while our call was in flight.
							if (!manualName) pi.setSessionName(lastSummary);
							if (toast && latestCtx?.hasUI) latestCtx.ui.notify(toast, "info");
						} catch {
							// ctx/pi became stale between the check and use -- ignore
						}
					}
				}
				emitTelemetry(config.telemetry, telemetryBase, {
					update: telemetryUpdate,
					provider: telemetryProvider,
					effort,
					outcome: "ok",
					...(response.usage
						? {
								inputTokens: response.usage.input,
								outputTokens: response.usage.output,
								...(response.usage.cost ? { cost: response.usage.cost.total } : {}),
							}
						: {}),
					ms: Date.now() - callStarted,
				});
			})
			.catch((err) => {
				const msg = err?.message || String(err);
				// err.name is usually just "Error" -- useless; prefer code/status/message
				const code = err?.code || err?.status || msg.slice(0, 80);
				lastError = String(code);
				emitTelemetry(config.telemetry, telemetryBase, {
					update: telemetryUpdate,
					provider: telemetryProvider,
					effort,
					outcome: "error",
					error: String(code).slice(0, 80),
					ms: Date.now() - callStarted,
				});
			})
			.finally(() => {
				pendingLLMCall = false;
				// Guard + try/catch: isCtxStale() can race with a teardown happening
				// mid-updateWidget, and this fire-and-forget chain has no further
				// .catch() to absorb a throw into an unhandled rejection.
				if (latestCtx && !isCtxStale(latestCtx)) {
					try {
						updateWidget(latestCtx);
					} catch {
						// ctx went stale mid-update -- nothing to render into
					}
				}
			});
	}

	// -- Decision gate flow -------------------------------------------------

	/** Gate + summarize, run fire-and-forget after the debounce window passes.
	 *  Never throws (callers swallow; failures land in lastError/widget). */
	async function gateAndSummarize(ctx: ExtensionContext) {
		if (manualName) return;
		const branch = ctx.sessionManager.getBranch();
		// Branch shrank (fork / branch switch) — start the delta over.
		if (branch.length < processedEntryCount) processedEntryCount = 0;
		const deltaEntries = branch.slice(processedEntryCount);

		if (!lastSummary) {
			// First summary of the session: no gate (nothing to compare against).
			await generateSummary(ctx, { forceFull: true });
			return;
		}

		const activity = buildActivityDigest(deltaEntries);
		const gateStarted = Date.now();
		const gateBase: TelemetryBase = {
			kind: "gate",
			session: ctx.sessionManager.getSessionId() ?? "(unknown)",
			project: ctx.cwd,
			mode: ctx.mode,
		};
		let verdict: GateVerdict | undefined;
		try {
			verdict = await runDecisionGate(config.decisionGate, gateState, lastSummary, activity);
		} catch {
			// Contract: runDecisionGate never throws. Belt-and-braces — a gate crash
			// must degrade to stock behavior, never stall summaries.
			verdict = undefined;
		}
		if (verdict?.provider) gateCallCount++;
		// A verdict means a gate attempt actually happened (success OR fall-through
		// failure). Gate unavailable (undefined) = no call, no event.
		if (verdict) {
			emitTelemetry(config.telemetry, gateBase, {
				provider: verdict.provider ?? "(none)",
				outcome: verdict.error ? "error" : "ok",
				...(verdict.error ? { error: verdict.error } : {}),
				...(verdict.error ? {} : { decision: verdict.decision }),
				...(verdict.materialP !== undefined ? { materialP: verdict.materialP } : {}),
				...(verdict.attempts?.length ? { attempts: verdict.attempts } : {}),
				ms: Date.now() - gateStarted,
			});
		}

		if (verdict) {
			if (config.verbose && latestCtx && !isCtxStale(latestCtx) && latestCtx.hasUI) {
				try {
					latestCtx.ui.notify(`[gate:${verdict.decision}] ${verdict.reason} (p=${verdict.materialP?.toFixed(2) ?? "?"}${verdict.provider ? `, ${verdict.provider}` : ""}${verdict.attempts?.length ? `; after: ${verdict.attempts.join(", ")}` : ""})`, "info");
				} catch { /* stale ctx */ }
			}
			if (verdict.decision === "skip") {
				// Nothing material — consume the delta so it doesn't pile up, keep the
				// name frozen. The summary is deliberately current, so the widget's
				// stale counter resets too ("[N turns ago]" would read as neglect).
				processedEntryCount = branch.length;
				turnsSinceSummary = 0;
				updateWidget(ctx);
				return;
			}
			await generateSummary(ctx, {
				deltaEntries: verdict.decision === "summarize" ? deltaEntries : undefined,
				forceFull: verdict.decision === "resummarize-full",
			});
			return;
		}

		// Gate unavailable (no provider keys / disabled): stock behavior, but keep
		// the delta optimization — the incremental prompt embeds only the delta,
		// and a huge delta still upgrades to a full rebuild via the threshold.
		await generateSummary(ctx, { deltaEntries });
	}

	// -- Commands ---------------------------------------------------------

	pi.registerCommand("summary:settings", {
		description: "Create/show session-summary settings file",
		handler: async (_args, ctx) => {
			const globalPath = join(getAgentDir(), "session-summary.json");
			if (!existsSync(globalPath)) {
				mkdirSync(dirname(globalPath), { recursive: true });
				// Materialize the resolved model (auto-detected or configured) into the
				// settings — EXCEPT the inherit rung: freezing it would turn live
				// session-model inheritance into a static pin. Leave empty → stays dynamic.
				const resolved = resolveModel(ctx);
				const pinned = resolved && !resolved.inherited;
				const settingsToWrite = {
					...DEFAULTS,
					provider: pinned ? resolved!.provider : "",
					// Preserve the effort suffix — writing the bare model would drop a
					// `:high` pin to the (clamped) default on next load.
					model: pinned ? resolved!.model + (resolved!.effort ? ":" + resolved!.effort : "") : "",
				};
				delete (settingsToWrite as any).decisionGate;
				writeFileSync(globalPath, JSON.stringify(settingsToWrite, null, 2) + "\n");
				ctx.ui.notify(`Created ${globalPath}`, "success");
			} else {
				ctx.ui.notify(`Settings file already exists: ${globalPath}`, "info");
			}
			ctx.ui.notify(`Edit: ${globalPath} — then /reload to apply`, "info");
		},
	});

	pi.registerCommand("summary:update", {
		description: "Force-update the session summary now",
		handler: async (_args, ctx) => {
			if (manualName) {
				ctx.ui.notify("Summary is locked — force-update skipped. /summary:lock or /summary:clear re-enables updates", "warning");
				return;
			}
			if (pendingLLMCall) {
				ctx.ui.notify("Summary update already in progress", "info");
				return;
			}
			latestCtx = ctx;
			// Force by resetting debounce timer; an explicit request should always report its failure
			lastSummaryTime = 0;
			errorNotified = false;
			ctx.ui.notify("Generating summary...", "info");
			await generateSummary(ctx, { forceFull: true });
		},
	});

	pi.registerCommand("summary:clear", {
		description: "Clear the session summary/name",
		handler: async (_args, ctx) => {
			resetState();
			lastSummary = "";
			processedEntryCount = ctx.sessionManager.getBranch().length;
			pi.setSessionName("");
			latestCtx = ctx;
			updateWidget(ctx);
			ctx.ui.notify("Summary cleared", "info");
		},
	});

	pi.registerCommand("summary:cost", {
		description: "Show summary model and its cost (this session; or rollup: project | lifetime)",
		handler: async (args, ctx) => {
			const scope = (args || "").trim().toLowerCase();

			if (scope === "project" || scope === "lifetime" || scope === "all") {
				if (!config.telemetry.enabled) {
					ctx.ui.notify(
						`Telemetry is off — enable it in ~/.pi/agent/session-summary.json: "telemetry": { "enabled": true }, then /reload. It appends metadata-only lines to ${config.telemetry.path || "~/.pi/agent/session-summary/usage.jsonl"} (never conversation content).`,
						"info",
					);
					return;
				}
				const rollup = readRollup(config.telemetry, scope === "project" ? { project: ctx.cwd } : undefined);
				const label = scope === "project" ? `project ${tildify(ctx.cwd)}` : "lifetime";
				if (!rollup.summaryCalls && !rollup.gateCalls) {
					ctx.ui.notify(`No usage logged for ${label} yet${rollup.skipped ? ` (${rollup.skipped} unparseable lines skipped)` : ""}`, "info");
					return;
				}
				const costStr = rollup.cost > 0 ? `$${rollup.cost.toFixed(4)}` : "$0";
				const unknownStr = rollup.costUnknown ? ` (${rollup.costUnknown} calls w/o reported cost)` : "";
				const errStr = rollup.errors ? `, ${rollup.errors} errors` : "";
				const span = rollup.first ? ` · ${rollup.first.slice(0, 10)}→${rollup.last!.slice(0, 10)}` : "";
				// One notify for the whole rollup: pi's TUI collapses consecutive info
				// notifies into a single status line (only the last message survives),
				// so per-line notifies would hide everything but the final provider.
				const lines = [
					`${label}: ${rollup.summaryCalls} summarizer call${rollup.summaryCalls === 1 ? "" : "s"}, ${rollup.gateCalls} gate call${rollup.gateCalls === 1 ? "" : "s"} (${rollup.gateSkips} skips${errStr}) · tokens ${rollup.inputTokens}→${rollup.outputTokens} · cost: ${costStr}${unknownStr}${span}${rollup.skipped ? ` · ${rollup.skipped} unparseable lines` : ""}`,
				];
				// Grouped by kind: LLMs (summarizer) and decision models (gate) read
				// as separate ledgers — they have different units (tokens/cost vs
				// verdicts) and different mental buckets.
				const llmRows: string[] = [];
				const gateRows: string[] = [];
				for (const [provider, s] of [...rollup.byProvider.entries()].sort((a, b) => b[1].calls - a[1].calls)) {
					const pc = s.cost > 0 ? `, $${s.cost.toFixed(4)}` : "";
					const pu = s.costUnknown ? `, ${s.costUnknown} w/o cost` : "";
					const row = `    ${provider}: ${s.calls} call${s.calls === 1 ? "" : "s"}${pc}${pu} · ${s.inputTokens}→${s.outputTokens} tok`;
					(s.kind === "gate" ? gateRows : llmRows).push(row);
				}
				// Decision models first — they literally run first.
				if (gateRows.length) lines.push("  Decision models:", ...gateRows);
				if (llmRows.length) lines.push("  LLMs:", ...llmRows);
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			} else if (scope && scope !== "session") {
				ctx.ui.notify("Usage: /summary:cost [session|project|lifetime]", "info");
				return;
			}

			// Ensure model is resolved fresh
			if (!resolvedModelName) resolveModel(ctx);
			const model = resolvedModelName || "(none)";
			const costStr = totalCost.total > 0 ? `$${totalCost.total.toFixed(4)}` : "$0";
			const gateStr = gateCallCount ? ` + ${gateCallCount} gate call${gateCallCount === 1 ? "" : "s"}` : "";
			const line = `${model} | ${llmCallCount} llm call${llmCallCount === 1 ? "" : "s"}${gateStr} | tokens: ${totalTokens.input}→${totalTokens.output} | cost: ${costStr} (in: $${totalCost.input.toFixed(4)}, out: $${totalCost.output.toFixed(4)}, cache-r: $${totalCost.cacheRead.toFixed(4)}, cache-w: $${totalCost.cacheWrite.toFixed(4)})`;
			ctx.ui.notify(line, "info");
		},
	});

	pi.registerCommand("summary:gate", {
		description: "Show decision-gate provider status and dry-run a verdict",
		handler: async (_args, ctx) => {
			const gateConfig = config.decisionGate;
			if (!gateConfig.enabled) {
				ctx.ui.notify("Decision gate disabled (decisionGate.enabled: false)", "info");
				return;
			}
			// One notify per outcome, with the provider status prepended: pi's TUI
			// collapses consecutive info notifies into a single status line, so a
			// separate status notify would be replaced before it can be read.
			const gateStatus = gateProviderStatus(gateConfig, gateState).map((line) => `[gate] ${line}`).join("\n");
			const branch = ctx.sessionManager.getBranch();
			if (branch.length < processedEntryCount) processedEntryCount = 0;
			const deltaEntries = branch.slice(processedEntryCount);
			if (!lastSummary) {
				ctx.ui.notify(`${gateStatus}\nNo summary yet — the first summary always runs the LLM (nothing to gate)`, "info");
				return;
			}
			const activity = buildActivityDigest(deltaEntries);
			if (!activity.trim()) {
				ctx.ui.notify(`${gateStatus}\nNo uncovered activity (${processedEntryCount}/${branch.length} entries covered by the summary) — the pipeline already judged everything. New turns reopen the dry run inside the debounce window.`, "info");
				return;
			}
			const verdict = await runDecisionGate(gateConfig, gateState, lastSummary, activity);
			const msg = verdict
				? `${verdict.decision.toUpperCase()} — ${verdict.reason}${verdict.provider ? ` [${verdict.provider}]` : ""}${verdict.materialP !== undefined ? ` p(material)=${verdict.materialP.toFixed(2)}` : ""}`
				: "Gate unavailable (no provider keys) — LLM path runs ungated";
			ctx.ui.notify(`${gateStatus}\n${msg}`, "info");
		},
	});

	pi.registerCommand("summary:lock", {
		description: "Toggle: freeze/resume auto summary updates for this session",
		handler: async (_args, ctx) => {
			if (!manualName && !lastSummary) {
				ctx.ui.notify("No summary yet — nothing to lock", "info");
				return;
			}
			manualName = !manualName;
			if (manualName) {
				// Lock whatever the name currently is — covers both the auto text
				// ("this one is perfect") and a prior manual /name.
				try {
					const name = pi.getSessionName();
					if (name) lastSummary = name;
				} catch { /* stale runtime — keep current state */ }
				ctx.ui.notify(`session-summary: 🔒 frozen "${lastSummary}" — auto-updates off (/summary:lock again to resume)`, "info");
			} else {
				ctx.ui.notify("session-summary: 🔓 auto-updates resumed — next turn end reconciles any gap", "info");
			}
		},
	});

	// -- Event handlers ---------------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		// Reload config (picks up changes on /reload)
		config = loadConfig(ctx.cwd);
		resetState();
		latestCtx = ctx;

		// Resolve model early so waiting message shows model name
		const resolved = resolveModel(ctx);
		if (!resolved) {
			lastError = "No summary model — set provider/model in ~/.pi/agent/session-summary.json (/summary:settings)";
		}

		restoreFromSessionName();
		// Delta baseline: everything currently in the branch was already covered by
		// the persisted summary when the session was last alive (fork fix — stock
		// started the baseline at 0, forcing a full re-summarize after every resume).
		processedEntryCount = ctx.sessionManager.getBranch().length;
		updateWidget(ctx);
	});

	// Manual-name guard: any name that is not ours (i.e. set via /name, --name,
	// or the resume picker) freezes auto-naming until /summary:clear. Our own
	// writes land the exact lastSummary string, so they pass through untouched.
	pi.on("session_info_changed", async () => {
		if (manualName) return;
		try {
			const name = pi.getSessionName();
			if (name && name !== lastSummary) {
				manualName = true;
				if (config.verbose && latestCtx && !isCtxStale(latestCtx) && latestCtx.hasUI) {
					latestCtx.ui.notify("[session-summary] manual name detected — auto-naming frozen (/summary:clear to re-enable)", "info");
				}
			}
		} catch {
			// stale pi runtime — nothing to guard
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		latestCtx = ctx;
		// Scripted sessions (pi -p, JSON mode) don't surface the name to a TUI
		// user — don't spend summarizer/gate calls there unless opted in via
		// runHeadless. Interactive modes (tui, rpc) are unaffected.
		if (!config.runHeadless && (ctx.mode === "print" || ctx.mode === "json")) return;
		if (manualName) return;
		turnsSinceSummary++;
		updateWidget(ctx);

		// Debounce: only proceed if enough time has passed
		const now = Date.now();
		const elapsed = now - lastSummaryTime;
		if (elapsed < config.debounceSeconds * 1000 && lastSummary) {
			// Too soon -- widget already shows hybrid line with turn count
			return;
		}

		// Gate + generate asynchronously (non-blocking). The gate can only skip or
		// shape the call — every failure path falls through to the stock summary.
		gateAndSummarize(ctx).catch(() => {});
	});
}
