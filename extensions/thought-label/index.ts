/**
 * Thought Label — collapsed thinking header experiment. VERSION-LOCKED to pi 0.85.x.
 *
 * Want:  "☕︎ Thinking...  ▸" while a turn streams
 *        "☕︎ Thought · 4s  ▸" once it ends (or "Thought · a few seconds" for short ones)
 *
 * HOW: pi exports AssistantMessageComponent; its collapsed thinking header renders
 * `${this.hiddenThinkingLabel}` at draw time, and the field is a plain property
 * assigned in the constructor. A prototype accessor therefore traps every
 * instance's label without touching instance internals:
 *   - set() captures instances + raw label ("Thinking...")
 *   - get() serves the glyph-prefixed live label, or a per-instance frozen
 *     "Thought · Xs" once its turn has ended (historical blocks keep their own
 *     turn's duration)
 *
 * Timing approximation: thinking phase ≈ first provider roundtrip of the turn
 * (before_provider_request → after_provider_response). With `max` thinking on
 * GLM-5.3 this is where the reasoning lives. Falls back to full turn duration
 * when no roundtrip was observed.
 *
 * SELF-DISABLING: capability-probes the seam and bails out (with a one-time
 * notice) if pi internals change. Re-verify on every pi upgrade — this is the
 * deal we signed for monkey-patching.
 *
 * Config (~/.pi/agent/thought-label.json, all optional):
 *   { "tier": "unicode" | "nerd" | "ascii",
 *     "nerdGlyph": "<paste NF brain glyph>",
 *     "briefMaxS": 4, "briefText": "a few seconds",
 *     "disabled": false }
 *
 * Toggle in-session: /thought-label
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import { loadTierConfig, resolveTierGlyph } from "../../lib/tier-glyphs.ts";
import { homedir } from "node:os";
import { join } from "node:path";

interface ThoughtLabelConfig {
	briefMaxS?: number;
	briefText?: string;
}

function fmtDuration(seconds: number, briefMaxS: number, briefText: string): string {
	if (seconds < briefMaxS) return briefText;
	if (seconds < 60) return `${Math.round(seconds)}s`;
	const m = Math.floor(seconds / 60);
	const r = Math.round(seconds % 60);
	return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

export default function (pi: ExtensionAPI) {
	const CONFIG_PATH = join(homedir(), ".pi", "agent", "thought-label.json");
	const cfg = loadTierConfig<ThoughtLabelConfig & { tier?: "unicode" | "nerd" | "ascii"; nerdGlyph?: string; disabled?: boolean }>(CONFIG_PATH);
	let enabled = cfg.disabled !== true;
	const prefix = resolveTierGlyph(cfg, { unicode: "\u2615\uFE0E" }); // ☕︎ text presentation
	const briefMaxS = cfg.briefMaxS ?? 4;
	const briefText = cfg.briefText ?? "a few seconds";

	let installed = false;
	let installNote = "";
	const tracked = new Set<any>();

	// Current turn timing state. respMs = first provider roundtrip of the turn
	// (the thinking phase, at least for think-then-act models at high effort).
	let turnActive = false;
	let reqStartMs: number | null = null;
	let respEndMs: number | null = null;
	let lastDurText: string | null = null;

	function install(): boolean {
		try {
			const proto = AssistantMessageComponent.prototype as any;
			if (typeof proto.setHiddenThinkingLabel !== "function" || typeof proto.updateContent !== "function") {
				installNote = "thought-label: AssistantMessageComponent seam missing — disabled";
				return false;
			}
			if (Object.getOwnPropertyDescriptor(proto, "hiddenThinkingLabel")) {
				installNote = "thought-label: hiddenThinkingLabel is no longer a plain field — disabled";
				return false;
			}
			Object.defineProperty(proto, "hiddenThinkingLabel", {
				configurable: true,
				get(this: any) {
					if (!enabled) return this.__tlRaw ?? "Thinking...";
					if (this.__tlFrozen) return prefix + this.__tlFrozen;
					if (turnActive) return prefix + (this.__tlRaw ?? "Thinking...");
					if (lastDurText) return `${prefix}Thought · ${lastDurText}`;
					return prefix + (this.__tlRaw ?? "Thinking...");
				},
				set(this: any, v: string) {
					this.__tlRaw = typeof v === "string" ? v : "Thinking...";
					tracked.add(this);
				},
			});
			return true;
		} catch (error) {
			installNote = `thought-label: install failed (${error instanceof Error ? error.message : String(error)}) — disabled`;
			return false;
		}
	}

	function freezeCompletedTurns(): void {
		if (!lastDurText) return;
		const label = `Thought · ${lastDurText}`;
		for (const inst of tracked) {
			if (!inst.__tlFrozen) inst.__tlFrozen = label;
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		installed = install();
		if (!installed && ctx.hasUI && installNote) ctx.ui.notify(installNote, "warning");
	});

	pi.on("agent_start", () => {
		turnActive = true;
		reqStartMs = null;
		respEndMs = null;
	});

	pi.on("before_provider_request", () => {
		if (reqStartMs === null) reqStartMs = Date.now();
	});

	pi.on("after_provider_response", () => {
		if (reqStartMs !== null && respEndMs === null) respEndMs = Date.now();
	});

	pi.on("agent_end", () => {
		turnActive = false;
		const now = Date.now();
		const seconds =
			reqStartMs !== null && respEndMs !== null
				? (respEndMs - reqStartMs) / 1000
				: reqStartMs !== null
					? (now - reqStartMs) / 1000
					: null;
		lastDurText = seconds !== null ? fmtDuration(seconds, briefMaxS, briefText) : null;
		freezeCompletedTurns();
	});

	pi.registerCommand("thought-label", {
		description: "Toggle the Thought Label collapsed-thinking experiment",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			if (!installed) {
				installed = install();
			}
			const trackedCount = tracked.size;
			ctx.ui.notify(
				`thought-label ${enabled ? "enabled" : "disabled"} · patched:${installed} · tracked:${trackedCount} · lastDur:${lastDurText ?? "—"}`,
				"info",
			);
		},
	});
}
