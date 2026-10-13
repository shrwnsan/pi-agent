/**
 * decision-gate — System One decision-model gate for session-summary.
 *
 * Decides whether a session's one-line summary needs regenerating BEFORE
 * spending a generative LLM call. The stock extension re-sends the whole
 * conversation to a summarizer every debounce window and asks it to "repeat
 * the summary verbatim" when nothing changed — LLMs paraphrase, so names
 * churn, and every no-op turn pays full tokens. This gate makes that
 * materiality call with a decision model (typed probabilities, zero
 * generated tokens) instead:
 *
 *   skip             — confident nothing material changed → keep the name
 *   summarize        — material change → incremental update (delta only)
 *   resummarize-full — topic drift → full re-summarize recentered on
 *                      recent work, not anchored on the stale title
 *
 * Providers are a unified registry: built-in presets (liquid, typesafe,
 * vercel) pre-seed the specs map and customs merge over them, so adding a
 * decision model is one specs entry + one env var. `providers` is the cycle
 * order; a provider is ACTIVE when it has no apiKeyEnv (keyless, e.g. local
 * endpoints) or its env var is set. The chain tries active providers in
 * order; a failed provider falls through to the next and is disabled for the
 * session after maxConsecutiveFailures consecutive failures; no active
 * providers → caller falls through to the stock generative path. The gate
 * can only save a call, never block one.
 *
 * Two wire formats:
 *   "systemone" — the shared System One contract (state + typed questions →
 *                 answers.<id>.noul/.choice). Used by Liquid AI d1
 *                 (d1:free, text-only, no published rate limits; free-tier
 *                 terms permit training on API content), TypeSafe Jev, and
 *                 any compatible endpoint (e.g. OpenRouter's decision
 *                 surfaces).
 *   "chat"      — OpenAI-compatible chat completions asked for a bare
 *                 YES/NO, mapped to 0.9/0.1. For gateways with no decision
 *                 endpoint (Vercel AI Gateway: $5/month free credit) and
 *                 local models (keyless spec + localhost URL).
 *
 * Keys come from env vars only (name via apiKeyEnv) — never config files.
 *
 * Part of the session-summary pi-agent fork (origin: pasky/pi-session-summary, MIT).
 */
import type { SessionEntry } from "./session-entries.ts";

// -- Configuration --------------------------------------------------------

export interface GateProviderSpec {
	/** Wire format. "systemone" = shared System One contract; "chat" = OpenAI-compatible YES/NO shim. */
	type: "systemone" | "chat";
	url: string;
	model: string;
	/** Env var holding the Bearer key. Omitted → keyless-active (local endpoints). */
	apiKeyEnv?: string;
	/** Per-provider timeout; overrides the gate-level timeoutMs. */
	timeoutMs?: number;
}

export interface DecisionGateConfig {
	enabled: boolean;
	/** Cycle order; names must exist in specs (unknown names are dropped). */
	providers: string[];
	/** p(material) >= confidenceThreshold → summarize; <= 1-threshold → skip; between → summarize (safe). */
	confidenceThreshold: number;
	/** Default provider timeout; per-spec timeoutMs wins. */
	timeoutMs: number;
	/** A provider is disabled for the session after this many consecutive failures. */
	maxConsecutiveFailures: number;
	/** Provider registry: built-in presets + user customs. */
	specs: Record<string, GateProviderSpec>;
}

/** Built-in presets. Customs and overrides merge over these in resolveGateConfig. */
export const BUILTIN_SPECS: Record<string, GateProviderSpec> = {
	liquid: {
		type: "systemone",
		url: "https://api.liquid.ai/decisions/v1/systemone",
		model: "d1:free",
		apiKeyEnv: "LIQUID_API_KEY",
	},
	typesafe: {
		type: "systemone",
		url: "https://api.typesafe.ai/v1/systemone",
		model: "jev-latest",
		apiKeyEnv: "TYPESAFE_API_KEY",
	},
	vercel: {
		type: "chat",
		url: "https://ai-gateway.vercel.sh/v1/chat/completions",
		model: "google/gemini-3.1-flash-lite",
		apiKeyEnv: "AI_GATEWAY_API_KEY",
	},
};

const DEFAULTS = {
	enabled: true,
	providers: ["liquid", "typesafe", "vercel"],
	confidenceThreshold: 0.7,
	timeoutMs: 5_000,
	maxConsecutiveFailures: 3,
};

/** Merge user config over defaults. Customs and preset overrides merge into
 *  the specs registry; invalid specs (no url) are dropped with a console
 *  error; order-list names without a spec are dropped. */
export function resolveGateConfig(raw?: Partial<DecisionGateConfig> | null): DecisionGateConfig {
	const specs: Record<string, GateProviderSpec> = { ...BUILTIN_SPECS };
	if (raw?.specs) {
		for (const [name, rawSpec] of Object.entries(raw.specs)) {
			// Merge over any existing preset so an override like
			// specs.liquid.model keeps the preset's url/apiKeyEnv.
			const sanitized = sanitizeSpec({ ...(specs[name] ?? {}), ...(rawSpec as any) });
			if (sanitized) {
				specs[name] = sanitized;
			} else {
				console.error(`[session-summary] decisionGate.specs.${name}: invalid — needs at least a url`);
			}
		}
	}
	const merged: DecisionGateConfig = {
		enabled: raw?.enabled ?? DEFAULTS.enabled,
		providers: (raw?.providers ?? DEFAULTS.providers).filter((n) => !!specs[n]),
		confidenceThreshold: Math.min(0.95, Math.max(0.55, raw?.confidenceThreshold ?? DEFAULTS.confidenceThreshold)),
		timeoutMs: raw?.timeoutMs ?? DEFAULTS.timeoutMs,
		maxConsecutiveFailures: raw?.maxConsecutiveFailures ?? DEFAULTS.maxConsecutiveFailures,
		specs,
	};
	return merged;
}

function sanitizeSpec(raw: any): GateProviderSpec | undefined {
	if (!raw || typeof raw !== "object" || typeof raw.url !== "string" || !raw.url) return undefined;
	const spec: GateProviderSpec = {
		type: raw.type === "chat" ? "chat" : "systemone",
		url: raw.url,
		model: typeof raw.model === "string" ? raw.model : "",
	};
	if (typeof raw.apiKeyEnv === "string" && raw.apiKeyEnv) spec.apiKeyEnv = raw.apiKeyEnv;
	if (typeof raw.timeoutMs === "number" && raw.timeoutMs > 0) spec.timeoutMs = raw.timeoutMs;
	return spec;
}

/** Active = keyless by design, or its key env var is set right now. */
function providerActive(spec: GateProviderSpec): boolean {
	return !spec.apiKeyEnv || !!process.env[spec.apiKeyEnv];
}

// -- Gate state (per session instance; reset on session_start) ------------

export interface GateState {
	/** provider name → consecutive failures; >= maxConsecutiveFailures disables for the session. */
	failures: Map<string, number>;
	/** Last verdict, for /summary:gate inspection. */
	lastVerdict?: GateVerdict;
}

export function createGateState(): GateState {
	return { failures: new Map() };
}

// -- Verdict --------------------------------------------------------------

export interface GateVerdict {
	decision: "skip" | "summarize" | "resummarize-full";
	reason: string;
	provider?: string;
	materialP?: number;
	topicConfidence?: number;
}

// -- Digest: what happened since the last summary -------------------------

const DIGEST_MAX_USER_CHARS = 400;   // per user message
const DIGEST_MAX_CHARS = 5_000;      // whole digest

/** Compact activity digest from session entries: user text + tool-call names.
 *  Deliberately excludes assistant prose and tool output — drift shows in what
 *  the user asked for and which tools ran, not in how the assistant phrased it. */
export function buildActivityDigest(entries: SessionEntry[]): string {
	const lines: string[] = [];
	let total = 0;

	for (const entry of entries) {
		if (entry.type !== "message" || !entry.message?.role) continue;
		const role = entry.message.role;

		if (role === "user") {
			const text = extractText(entry.message.content)
				.replace(/\s+/g, " ")
				.trim()
				.slice(0, DIGEST_MAX_USER_CHARS);
			if (text) {
				lines.push(`User: ${text}`);
				total += text.length;
			}
		} else if (role === "assistant") {
			for (const name of extractToolCallNames(entry.message.content)) {
				lines.push(`[tool: ${name}]`);
				total += name.length + 8;
			}
		}
		if (total > DIGEST_MAX_CHARS) break;
	}

	return lines.slice(0, 125).join("\n").slice(0, DIGEST_MAX_CHARS);
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (block && typeof block === "object" && (block as any).type === "text" && typeof (block as any).text === "string") {
			parts.push((block as any).text);
		}
	}
	return parts.join(" ");
}

function extractToolCallNames(content: unknown): string[] {
	if (!Array.isArray(content)) return [];
	const names: string[] = [];
	for (const block of content) {
		if (block && typeof block === "object" && (block as any).type === "toolCall" && typeof (block as any).name === "string") {
			names.push((block as any).name);
		}
	}
	return names;
}

// -- Questions (shared System One shape) -----------------------------------

function buildQuestions() {
	return {
		material_change: {
			type: "noul" as const,
			instructions:
				"Given the session summary and the recent activity that happened AFTER it, " +
				"did the work materially change what the session is about or its current goal?",
			criteria: {
				true: "New tasks, new problems, changed goal, or meaningful progress on the goal",
				false: "Routine continuation: acknowledgements, retries, small fixes, tests re-run, no change in goal or progress",
			},
		},
		topic: {
			type: "choice" as const,
			instructions: "Is the recent activity about the same topic as the summary, or a new topic?",
			criteria: {
				same_topic: "Continuation of the summarized work",
				new_topic: "A different problem or task than the summarized work",
			},
		},
	};
}

function buildGateStateText(summary: string, activity: string): string {
	return [
		`Current session summary: ${summary}`,
		"",
		`Recent activity since that summary was made:`,
		activity,
	].join("\n");
}

// -- Wire formats -----------------------------------------------------------

/** One System One evaluation call. Returns parsed answers, or throws with a short reason. */
async function systemOneCall(
	url: string, apiKey: string | undefined, model: string, state: string, timeoutMs: number,
): Promise<Record<string, any>> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
	const response = await fetch(url, {
		method: "POST",
		headers,
		body: JSON.stringify({ model, state, questions: buildQuestions() }),
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) {
		// Short reason only: response bodies can be long HTML/JSON blobs.
		throw new Error(`HTTP ${response.status}`);
	}
	const data = await response.json() as any;
	if (!data?.answers?.material_change || typeof data.answers.material_change.noul !== "number") {
		throw new Error("MALFORMED_RESPONSE");
	}
	return data.answers;
}

/** Chat shim: no decision endpoint needed — ask an OpenAI-compatible chat
 *  model for a bare YES/NO and map to 0.9/0.1. Tolerates punctuation and
 *  casing ("Yes.", " no"); anything else is a failure (safe fall-through). */
async function chatCall(
	spec: GateProviderSpec, apiKey: string | undefined, state: string, timeoutMs: number,
): Promise<number> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
	const response = await fetch(spec.url, {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: spec.model,
			max_tokens: 8,
			messages: [
				{
					role: "system",
					content: "You are a strict gate. Answer with exactly one word: YES or NO. YES means the recent activity materially changed what the session is about or its goal. NO means routine continuation.",
				},
				{ role: "user", content: state },
			],
		}),
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const data = await response.json() as any;
	const text = String(data?.choices?.[0]?.message?.content ?? "").trim();
	const firstAlpha = text.match(/[a-z]/i)?.[0]?.toUpperCase();
	if (firstAlpha === "Y") return 0.9;
	if (firstAlpha === "N") return 0.1;
	throw new Error("UNPARSABLE_ANSWER");
}

function errCode(err: unknown): string {
	const msg = err?.message || String(err);
	return msg === "The operation was aborted due to timeout" ? "TIMEOUT" : msg.slice(0, 40);
}

/** Record failure; returns true if the provider just got disabled for the session. */
function recordFailure(state: GateState, config: DecisionGateConfig, provider: string): boolean {
	const count = (state.failures.get(provider) ?? 0) + 1;
	state.failures.set(provider, count);
	return count >= config.maxConsecutiveFailures;
}

/** Map a System One answer pair to a verdict. */
function verdictFromAnswers(
	providerName: string, answers: Record<string, any>, threshold: number,
): GateVerdict {
	const p = answers.material_change.noul as number;
	const topic = answers.topic as { choice?: string; confidence?: number } | undefined;
	const topicConfidence = topic?.confidence;
	if (p >= threshold) {
		const drifted = topic?.choice === "new_topic" && (topicConfidence === undefined || topicConfidence >= threshold);
		return {
			decision: drifted ? "resummarize-full" : "summarize",
			reason: drifted ? "material change + topic drift" : "material change",
			provider: providerName,
			materialP: p,
			topicConfidence,
		};
	}
	if (p <= 1 - threshold) {
		return {
			decision: "skip",
			reason: "no material change",
			provider: providerName,
			materialP: p,
			topicConfidence,
		};
	}
	// Uncertain (p near 0.5) → spend the generative call; wrong-to-skip is worse than a redundant call.
	return {
		decision: "summarize",
		reason: `uncertain (p=${p.toFixed(2)}) → safe default`,
		provider: providerName,
		materialP: p,
		topicConfidence,
	};
}

/** Run the gate across the provider chain. Returns undefined when the gate is
 *  unavailable (disabled, or no active provider) — the caller must then fall
 *  through to the stock generative path. Never throws. */
export async function runDecisionGate(
	config: DecisionGateConfig,
	gateState: GateState,
	summary: string,
	activity: string,
): Promise<GateVerdict | undefined> {
	if (!config.enabled) return undefined;
	if (!summary || !activity.trim()) return undefined;

	const stateText = buildGateStateText(summary, activity);
	const threshold = config.confidenceThreshold;

	for (const name of config.providers) {
		const spec = config.specs[name];
		if (!spec || !providerActive(spec)) continue;
		if ((gateState.failures.get(name) ?? 0) >= config.maxConsecutiveFailures) continue;
		const apiKey = spec.apiKeyEnv ? process.env[spec.apiKeyEnv] : undefined;
		const timeoutMs = spec.timeoutMs ?? config.timeoutMs;

		try {
			let verdict: GateVerdict;
			if (spec.type === "chat") {
				const p = await chatCall(spec, apiKey, stateText, timeoutMs);
				gateState.failures.delete(name);
				verdict = {
					decision: p >= threshold ? "summarize" : "skip",
					reason: `chat gate answered ${p >= threshold ? "YES" : "NO"}`,
					provider: name,
					materialP: p,
				};
			} else {
				const answers = await systemOneCall(spec.url, apiKey, spec.model, stateText, timeoutMs);
				gateState.failures.delete(name);
				verdict = verdictFromAnswers(name, answers, threshold);
			}
			gateState.lastVerdict = verdict;
			return verdict;
		} catch (err) {
			const disabled = recordFailure(gateState, config, name);
			gateState.lastVerdict = {
				decision: "summarize",
				reason: `${name} failed (${errCode(err)})${disabled ? ", disabled for session" : ""} → fall through`,
				provider: name,
			};
			// fall through to the next active provider
		}
	}

	// Every provider was inactive (no key / all failed out / unknown names).
	// None active at all → gate is off for this machine (undefined, stock path
	// runs ungated). Some were active but all failed → summarize (stock path).
	const anyActive = config.providers.some((n) => {
		const spec = config.specs[n];
		return spec && providerActive(spec) && (gateState.failures.get(n) ?? 0) < config.maxConsecutiveFailures;
	});
	return anyActive ? gateState.lastVerdict : undefined;
}

/** Provider readiness for /summary:gate display, in cycle order. */
export function gateProviderStatus(config: DecisionGateConfig, gateState: GateState): string[] {
	return config.providers.map((name) => {
		const spec = config.specs[name];
		if (!spec) return `${name}: no spec`;
		const failures = gateState.failures.get(name) ?? 0;
		const disabled = failures >= config.maxConsecutiveFailures;
		const readiness = disabled
			? "disabled"
			: spec.apiKeyEnv
				? (process.env[spec.apiKeyEnv] ? "ready" : `no key (${spec.apiKeyEnv})`)
				: "keyless";
		return `${name}: ${readiness} · ${spec.type}/${spec.model || "(no model)"}${failures ? ` (${failures} fails)` : ""}`;
	});
}
