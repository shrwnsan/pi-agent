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

	const utcDayKey = (d: Date) =>
		`${String(d.getUTCFullYear()).slice(2)}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
	const utcStamp = (d: Date, withDate: boolean) => {
		const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
		return withDate ? `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${hm}` : hm;
	};

	pi.on("session_start", () => {
		anchorDayUtc = utcDayKey(new Date());
	});

	pi.registerCommand("tps", {
		description: "Toggle TPS performance notifications",
		handler: async (_args, ctx) => {
			tpsEnabled = !tpsEnabled;
			ctx.ui.notify(`TPS notifications ${tpsEnabled ? "enabled" : "disabled"}`, "info");
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
