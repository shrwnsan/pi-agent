/**
 * telemetry — opt-in, local-only JSONL usage log for session-summary.
 *
 * Privacy contract (enforced here, not by convention):
 *   - Off by default (`telemetry.enabled: false` in session-summary.json).
 *   - One append-only line per summarizer/gate attempt: when, which pi session,
 *     which project, which provider/model, outcome, tokens/cost, gate verdict.
 *   - NEVER logs conversation content, prompts, digests, or the summary text
 *     itself. The summary already lives in pi's session file, keyed by the same
 *     session id logged here — join if you need names, don't duplicate content.
 *   - Log lives in the agent dir (~/.pi/agent/session-summary/usage.jsonl),
 *     created 0600, never in a project .pi/ (those get committed to repos).
 *
 * JSONL because that is pi's own session-file idiom: one event per line,
 * append-only, crash-safe, greppable with jq. Rotation is left to the user
 * (delete the file to reset) — a year of heavy use is a few MB.
 *
 * Every write is best-effort: telemetry must never break summarizing.
 *
 * Part of the session-summary pi-agent fork (origin: pasky/pi-session-summary, MIT).
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// -- Configuration --------------------------------------------------------

export interface TelemetryConfig {
	enabled: boolean;
	/** Override the log path. Default: <agentDir>/session-summary/usage.jsonl */
	path?: string;
}

export const TELEMETRY_DEFAULTS: TelemetryConfig = { enabled: false };

export function defaultTelemetryPath(): string {
	return join(getAgentDir(), "session-summary", "usage.jsonl");
}

// -- Events ---------------------------------------------------------------

/** Call-site facts captured synchronously before any await (ctx can go stale). */
export interface TelemetryBase {
	kind: "summary" | "gate";
	/** pi session id (name/text deliberately excluded — see header). */
	session: string;
	/** Project cwd the session runs in; powers /summary:cost project. */
	project: string;
	/** tui | rpc | json | print */
	mode: string;
}

export interface SummaryEventData {
	update: "full" | "incremental";
	provider: string;
	/** Actual (post-clamp) reasoning effort sent to the model. */
	effort?: string;
	outcome: "ok" | "error";
	error?: string;
	inputTokens?: number;
	outputTokens?: number;
	cost?: number;
	ms: number;
}

export interface GateEventData {
	provider: string;
	outcome: "ok" | "error";
	error?: string;
	decision?: "skip" | "summarize" | "resummarize-full";
	materialP?: number;
	ms: number;
}

export function emitTelemetry(
	config: TelemetryConfig,
	base: TelemetryBase,
	data: SummaryEventData | GateEventData,
): void {
	if (!config.enabled) return;
	try {
		const path = config.path || defaultTelemetryPath();
		mkdirSync(dirname(path), { recursive: true });
		const event = { v: 1, ts: new Date().toISOString(), ...base, ...data };
		// mode 0o600 applies at file creation; appends keep the existing mode.
		appendFileSync(path, JSON.stringify(event) + "\n", { mode: 0o600 });
	} catch {
		// Telemetry must never break the extension.
	}
}

/** Display helper: $HOME → ~. Pure string op on render only — the log keeps
 *  absolute paths so rollup filters never break across path representations. */
export function tildify(p: string): string {
	const home = homedir();
	return p === home || p.startsWith(home + "/") ? "~" + p.slice(home.length) : p;
}

// -- Rollups ---------------------------------------------------------------

export interface Rollup {
	/** Malformed lines skipped during parse. */
	skipped: number;
	summaryCalls: number;
	gateCalls: number;
	gateSkips: number;
	errors: number;
	inputTokens: number;
	outputTokens: number;
	cost: number;
	/** Successful events that reported tokens but no cost (e.g. System One gates). */
	costUnknown: number;
	first?: string;
	last?: string;
	byProvider: Map<string, { kind: "summary" | "gate"; calls: number; cost: number; costUnknown: number; inputTokens: number; outputTokens: number }>;
}

export function emptyRollup(): Rollup {
	return {
		skipped: 0,
		summaryCalls: 0,
		gateCalls: 0,
		gateSkips: 0,
		errors: 0,
		inputTokens: 0,
		outputTokens: 0,
		cost: 0,
		costUnknown: 0,
		byProvider: new Map(),
	};
}

/** Read the log and aggregate. Missing file → empty rollup. */
export function readRollup(config: TelemetryConfig, filter?: { project?: string }): Rollup {
	const rollup = emptyRollup();
	const path = config.path || defaultTelemetryPath();
	let content: string;
	try {
		content = readFileSync(path, "utf-8");
	} catch {
		return rollup;
	}

	for (const line of content.split("\n")) {
		if (!line.trim()) continue;
		let e: any;
		try {
			e = JSON.parse(line);
		} catch {
			rollup.skipped++;
			continue;
		}
		if (filter?.project && e.project !== filter.project) continue;

		if (e.ts) {
			if (!rollup.first || e.ts < rollup.first) rollup.first = e.ts;
			if (!rollup.last || e.ts > rollup.last) rollup.last = e.ts;
		}
		const provider = typeof e.provider === "string" ? e.provider : "(unknown)";
		// Summary events group by provider:effort — a different effort is a
		// different effective configuration. Gate events have no effort.
		const effort = e.kind === "summary" && typeof e.effort === "string" && e.effort ? ":" + e.effort : "";
		const stats = rollup.byProvider.get(provider + effort) ?? { kind: e.kind, calls: 0, cost: 0, costUnknown: 0, inputTokens: 0, outputTokens: 0 };
		stats.calls++;

		if (e.outcome === "error") rollup.errors++;
		if (typeof e.inputTokens === "number") {
			rollup.inputTokens += e.inputTokens;
			stats.inputTokens += e.inputTokens;
		}
		if (typeof e.outputTokens === "number") {
			rollup.outputTokens += e.outputTokens;
			stats.outputTokens += e.outputTokens;
		}
		if (typeof e.cost === "number") {
			rollup.cost += e.cost;
			stats.cost += e.cost;
		} else if (e.outcome !== "error" && (typeof e.inputTokens === "number" || e.kind === "gate")) {
			rollup.costUnknown++;
			stats.costUnknown++;
		}

		if (e.kind === "summary") {
			rollup.summaryCalls++;
		} else if (e.kind === "gate") {
			rollup.gateCalls++;
			if (e.decision === "skip") rollup.gateSkips++;
		}
		rollup.byProvider.set(provider + effort, stats);
	}
	return rollup;
}
