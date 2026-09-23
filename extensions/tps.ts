/**
 * tps — per-run telemetry notification, footer-dialect edition.
 *
 *   󱐌21.4tps ↑193k ↓955 Σ194k R256 W0.0 H0.1% · 44.6s · 14:23      (UTC; same UTC day as session start)
 *   ⚡︎21.4tps ↑193k ↓955 Σ194k R256 W0.0 H0.1% · 44.6s · 09-19 02:14  (UTC day rolled over mid-session)
 *
 * Glyph tiers via lib/tier-glyphs.ts (unicode default, nerd via config, ascii).
 * ↑ input · ↓ output · Σ total · R cache-read · W cache-write · H cache-hit %
 * (H uses the footer's own formula: cacheRead / (input + cacheRead + cacheWrite)).
 * Zero-valued token counts render as "0.0" — measured-float-zero, not absent.
 * Final segment: turn-finish wall clock in UTC; grows a MM-DD prefix when the
 * finished turn's UTC day differs from the session's anchor day (session_start,
 * so /reload and resume re-anchor). Cumulative context/caching stays the
 * footer's job — this line is per-run.
 *
 * Config (~/.pi/agent/tps.json, all optional):
 *   { "tier": "nerd" | "unicode" | "ascii",   ← default "nerd" (󱐌)
 *     "nerdGlyph": "<swap NF glyph, e.g. md-flash_outline 󰛕>",
 *     "showTotal": true, "disabled": false }
 *   Stock (non-NF) machines: { "tier": "unicode" } → ⚡︎.
 *
 * Toggle in-session: /tps
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadTierConfig, resolveTierGlyph } from "../lib/tier-glyphs.ts";
import { homedir } from "node:os";
import { join } from "node:path";

interface TpsConfig {
	showTotal?: boolean;
}

const CONFIG_PATH = join(homedir(), ".pi", "agent", "tps.json");

/** 864 → "864", 103783 → "103.8k", 4200000 → "4.2M"; exact zero → "0.0" */
function humanize(n: number): string {
	if (n === 0) return "0.0";
	if (n >= 1_000_000) {
		const m = n / 1_000_000;
		return `${m >= 100 ? Math.round(m) : Math.round(m * 10) / 10}M`;
	}
	if (n >= 1000) {
		const k = n / 1000;
		return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`;
	}
	return String(n);
}

export default function (pi: ExtensionAPI) {
	const cfg = loadTierConfig<TpsConfig & { tier?: "unicode" | "nerd" | "ascii"; nerdGlyph?: string; disabled?: boolean }>(CONFIG_PATH);
	let tpsEnabled = cfg.disabled !== true;
	let agentStartMs: number | null = null;
	// Nerd-first defaults: 󱐌 flash (U+F140C). Stock machines set {"tier":
	// "unicode"} locally → ⚡︎ via system emoji.
	const tierCfg = { tier: "nerd" as "nerd" | "unicode" | "ascii", nerdGlyph: "󱐌", ...cfg };
	const glyph = resolveTierGlyph(tierCfg, { unicode: "\u26A1\uFE0E" });
	const showTotal = cfg.showTotal !== false;
	// UTC day anchor: set at session_start (/reload + resume re-anchor). When the
	// finished turn's UTC day differs, the timestamp grows a MM-DD prefix.
	let anchorDayUtc: string | null = null;
	let lastResumedLine: string | null = null;

	const utcDayKey = (d: Date) =>
		`${String(d.getUTCFullYear()).slice(2)}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
	const utcStamp = (d: Date, withDate: boolean) => {
		const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
		return withDate ? `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${hm}` : hm;
	};

	pi.on("session_start", (_event, ctx) => {
		anchorDayUtc = utcDayKey(new Date());
		// Resume reconstruction: rebuild the LAST finished turn from session
		// entries and re-emit its line, so --resume restores the per-run stats
		// (same philosophy as thought-label's histDur). A turn = the assistant
		// entries after a user entry; duration = last-assistant ts − user ts,
		// matching live semantics (agent_start → agent_end wall clock includes
		// tool time).
		if (!ctx.hasUI || !tpsEnabled) return;
		try {
			let group: { startTs: number; endTs: number; input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number } | null = null;
			let last: typeof group = null;
			for (const entry of (ctx.sessionManager.getBranch?.() ?? ctx.sessionManager.getEntries()) as any[]) {
				const ts = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
				if (entry.type === "message" && entry.message?.role === "user") {
					group = Number.isNaN(ts) ? group : { startTs: ts, endTs: ts, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
				} else if (entry.type === "message" && entry.message?.role === "assistant" && entry.message.usage && group) {
					const u = entry.message.usage;
					group.input += u.input || 0;
					group.output += u.output || 0;
					group.cacheRead += u.cacheRead || 0;
					group.cacheWrite += u.cacheWrite || 0;
					group.totalTokens += u.totalTokens || 0;
					if (!Number.isNaN(ts)) group.endTs = ts;
					last = group; // latest group that actually produced usage
				}
			}
			if (last && last.output > 0 && last.endTs > last.startTs) {
				const elapsedSeconds = (last.endTs - last.startTs) / 1000;
				const parts = [`${glyph}${(last.output / elapsedSeconds).toFixed(1)}tps`, `↑${humanize(last.input)}`, `↓${humanize(last.output)}`];
				if (showTotal) parts.push(`Σ${humanize(last.totalTokens)}`);
				if (last.cacheRead > 0 || last.cacheWrite > 0) {
					parts.push(`R${humanize(last.cacheRead)}`, `W${humanize(last.cacheWrite)}`);
					const promptTokens = last.input + last.cacheRead + last.cacheWrite;
					if (last.cacheRead > 0 && promptTokens > 0) parts.push(`H${((last.cacheRead / promptTokens) * 100).toFixed(1)}%`);
				}
				parts.push(`· ${elapsedSeconds.toFixed(1)}s`);
				const ended = new Date(last.endTs);
				parts.push(`· ${utcStamp(ended, anchorDayUtc !== null && utcDayKey(ended) !== anchorDayUtc)}`);
				lastResumedLine = parts.join(" ");
				ctx.ui.notify(lastResumedLine, "info");
			}
		} catch {
			/* reconstruction is best-effort */
		}
	});

	pi.registerCommand("tps", {
		description: "Toggle TPS performance notifications",
		handler: async (_args, ctx) => {
			tpsEnabled = !tpsEnabled;
			const state = `TPS notifications ${tpsEnabled ? "enabled" : "disabled"}`;
			// Re-show the reconstructed line on demand — the boot toast is transient
			// and easy to miss.
			ctx.ui.notify(lastResumedLine ? `${state} · last turn: ${lastResumedLine}` : state, "info");
		},
	});

	pi.on("agent_start", () => {
		agentStartMs = Date.now();
	});

	pi.on("agent_end", (event, ctx) => {
		if (!ctx.hasUI) return;
		if (!tpsEnabled) return;
		if (agentStartMs === null) return;

		const elapsedMs = Date.now() - agentStartMs;
		agentStartMs = null;
		if (elapsedMs <= 0) return;

		let input = 0;
		let output = 0;
		let cacheRead = 0;
		let cacheWrite = 0;
		let totalTokens = 0;

		for (const message of event.messages) {
			if (message.role !== "assistant") continue;
			input += message.usage.input || 0;
			output += message.usage.output || 0;
			cacheRead += message.usage.cacheRead || 0;
			cacheWrite += message.usage.cacheWrite || 0;
			totalTokens += message.usage.totalTokens || 0;
		}

		if (output <= 0) return;

		const elapsedSeconds = elapsedMs / 1000;
		const tps = (output / elapsedSeconds).toFixed(1);

		const parts = [`${glyph}${tps}tps`, `↑${humanize(input)}`, `↓${humanize(output)}`];
		if (showTotal) parts.push(`Σ${humanize(totalTokens)}`);
		if (cacheRead > 0 || cacheWrite > 0) {
			parts.push(`R${humanize(cacheRead)}`, `W${humanize(cacheWrite)}`);
			if (cacheRead > 0) {
				// Footer formula: hit% = cacheRead / (input + cacheRead + cacheWrite)
				const promptTokens = input + cacheRead + cacheWrite;
				if (promptTokens > 0) {
					parts.push(`H${((cacheRead / promptTokens) * 100).toFixed(1)}%`);
				}
			}
		}
		parts.push(`· ${elapsedSeconds.toFixed(1)}s`);
		const now = new Date();
		parts.push(`· ${utcStamp(now, anchorDayUtc !== null && utcDayKey(now) !== anchorDayUtc)}`);

		ctx.ui.notify(parts.join(" "), "info");
	});
}
