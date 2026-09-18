/**
 * tps — per-run telemetry notification, footer-dialect edition.
 *
 *   󱐌24.2tps ↑104k ↓864 Σ110k R4.2M W0 · 35.7s   (R/W omitted when both zero)
 *   ⚡︎24.2tps ↑104k ↓864 Σ110k · 35.7s           (unicode tier, no cache)
 *
 * Glyph tiers mirror minimal-mode's convention: unicode (default, renders
 * everywhere), nerd (paste your NF flash glyph into the config), ascii (none).
 * ↑ input · ↓ output · Σ total · R cache-read · W cache-write. Cumulative
 * context/caching stays the footer's job — this line is per-run.
 *
 * Config (~/.pi/agent/tps.json, all optional):
 *   { "tier": "unicode" | "nerd" | "ascii", "nerdGlyph": "󱐌",
 *     "showTotal": true, "disabled": false }
 *
 * Toggle in-session: /tps
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface TpsConfig {
	tier?: "unicode" | "nerd" | "ascii";
	nerdGlyph?: string;
	showTotal?: boolean;
	disabled?: boolean;
}

const CONFIG_PATH = join(homedir(), ".pi", "agent", "tps.json");
const GLYPHS: Record<NonNullable<TpsConfig["tier"]>, string> = {
	unicode: "\u26A1\uFE0E", // ⚡︎ text presentation
	nerd: "", // filled from config.nerdGlyph; falls back to unicode when unset
	ascii: "",
};

function loadConfig(): TpsConfig {
	try {
		const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as TpsConfig;
		return typeof raw === "object" && raw !== null ? raw : {};
	} catch {
		return {};
	}
}

/** 864 → "864", 103783 → "103.8k", 4200000 → "4.2M" */
function humanize(n: number): string {
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
	const cfg = loadConfig();
	let tpsEnabled = cfg.disabled !== true;
	let agentStartMs: number | null = null;
	const tier = cfg.tier ?? "unicode";
	const glyph = tier === "ascii" ? "" : tier === "nerd" ? cfg.nerdGlyph || GLYPHS.unicode : GLYPHS.unicode;
	const showTotal = cfg.showTotal !== false;

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
		}
		parts.push(`· ${elapsedSeconds.toFixed(1)}s`);

		ctx.ui.notify(parts.join(" "), "info");
	});
}
