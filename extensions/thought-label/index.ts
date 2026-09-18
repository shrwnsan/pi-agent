/**
 * Thought Label — collapsed thinking header experiment. VERSION-LOCKED to pi 0.85.x.
 *
 * Want:  "☕︎ Thinking...  ▸" while a turn streams
 *        "☕︎ Thought · 4s  ▸" once it ends (or "Thought · a few seconds" for short ones)
 *        "☕︎ Thought  ▸" for pre-extension historical blocks (duration unknown)
 *
 * MECHANISM (v4). pi's AssistantMessageComponent declares `hiddenThinkingLabel`
 * as a CLASS FIELD — under define-semantics the engine creates an own property
 * per instance, so prototype accessors/setters never see it (v3's approach was
 * structurally dead). What IS patchable: the `updateContent` prototype method —
 * it bakes the collapsed header from `this.hiddenThinkingLabel` on every call
 * (each streaming delta, each expand/collapse click). So:
 *
 *   1. wrap `updateContent` once on the prototype (tagged for idempotent reload)
 *   2. on first call per instance, replace the instance's own data property with
 *      an own accessor (get: live label, set: raw store) — own accessors shadow
 *      the data property, and the render inside updateContent reads through it
 *   3. on agent_end, freeze instances created during the turn to "Thought · Xs"
 *      with that turn's duration and re-run updateContent to re-bake
 *   4. on agent_start, freeze still-unfrozen (historical) instances to plain
 *      "Thought" — honest label, unknown duration; never stamped with another
 *      turn's number
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
 *   { "tier": "nerd" | "unicode" | "ascii",   ← default "nerd" (md-brain 󰧑)
 *     "nerdGlyph": "<swap NF glyph, e.g. md-thought_bubble 󰟶>",
 *     "briefMaxS": 4, "briefText": "a few seconds",
 *     "disabled": false }
 *   Stock (non-NF) machines: { "tier": "unicode" } → big ☕ via system emoji.
 *
 * Toggle in-session: /thought-label (prints patch/tracking diagnostics)
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

const CONFIG_PATH = join(homedir(), ".pi", "agent", "thought-label.json");

function fmtDuration(seconds: number, briefMaxS: number, briefText: string): string {
	if (seconds < briefMaxS) return briefText;
	if (seconds < 60) return `${Math.round(seconds)}s`;
	const m = Math.floor(seconds / 60);
	const r = Math.round(seconds % 60);
	return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

export default function (pi: ExtensionAPI) {
	const cfg = loadTierConfig<ThoughtLabelConfig & { tier?: "unicode" | "nerd" | "ascii"; nerdGlyph?: string; disabled?: boolean }>(
		join(homedir(), ".pi", "agent", "thought-label.json"),
	);
	let enabled = cfg.disabled !== true;
	// Nerd-first defaults: md-brain 󰧑 (U+F09D1). Stock (non-NF) machines set
	// {"tier": "unicode"} locally → big ☕ via system emoji fonts. ASCII = bare.
	const tierCfg = { tier: "nerd" as "nerd" | "unicode" | "ascii", nerdGlyph: "󰧑", ...cfg };
	const prefix = resolveTierGlyph(tierCfg, { unicode: "\u2615" }) + (tierCfg.tier === "ascii" ? "" : " ");
	const briefMaxS = cfg.briefMaxS ?? 4;
	const briefText = cfg.briefText ?? "a few seconds";

	let installed = false;
	let installNote = "";
	const tracked = new Set<any>();
	let origUpdate: ((this: any, message: unknown, isStreaming?: boolean) => void) | null = null;

	// Current turn timing state. respMs = first provider roundtrip of the turn
	// (the thinking phase, at least for think-then-act models at high effort).
	let turnActive = false;
	let reqStartMs: number | null = null;
	let respEndMs: number | null = null;
	let lastDurText: string | null = null;

	function liveLabel(inst: any): string {
		const raw = inst.__tlRaw ?? "Thinking...";
		if (!enabled) return raw;
		if (inst.__tlFrozen) return prefix + inst.__tlFrozen;
		// Completed message (history, or a finished round mid-turn): isStreaming is
		// false the moment the component is constructed for a non-streaming
		// message. Duration unknown until agent_end freezes turn instances.
		if (!inst.isStreaming) return `${prefix}Thought ▸`;
		return prefix + raw;
	}

	/** Swap one instance's own data property for an own accessor we control. */
	function instrument(inst: any): void {
		if (inst.__tlInstrumented) return;
		inst.__tlInstrumented = true;
		tracked.add(inst);
		const desc = Object.getOwnPropertyDescriptor(inst, "hiddenThinkingLabel");
		const current = desc && "value" in desc && typeof desc.value === "string" ? desc.value : "Thinking...";
		Object.defineProperty(inst, "hiddenThinkingLabel", {
			configurable: true,
			get: () => liveLabel(inst),
			set: (v: unknown) => {
				inst.__tlRaw = typeof v === "string" ? v : "Thinking...";
			},
		});
		inst.__tlRaw = current;
	}

	function install(): boolean {
		try {
			const proto = AssistantMessageComponent.prototype as any;
			if (typeof proto.updateContent !== "function") {
				installNote = "thought-label: AssistantMessageComponent.updateContent missing — disabled";
				return false;
			}
			if ((proto.updateContent as any).__thoughtLabelPatch) return true; // idempotent reload
			// Cleanup: dead label accessor from v3 generations (shadowed by the
			// class field; harmless but remove if replaceable).
			const labelDesc = Object.getOwnPropertyDescriptor(proto, "hiddenThinkingLabel");
			if (labelDesc?.configurable) delete proto.hiddenThinkingLabel;

			const orig = proto.updateContent as (this: any, message: unknown, isStreaming?: boolean) => void;
			const wrapped = function (this: any, message: unknown, isStreaming?: boolean) {
				try {
					instrument(this);
				} catch {
					/* never break rendering */
				}
				return orig.call(this, message, isStreaming);
			} as any;
			wrapped.__thoughtLabelPatch = true; // reload idempotency marker
			proto.updateContent = wrapped;
			origUpdate = orig;
			return true;
		} catch (error) {
			installNote = `thought-label: install failed (${error instanceof Error ? error.message : String(error)}) — disabled`;
			return false;
		}
	}

	function reRenderTracked(): void {
		if (!origUpdate) return;
		for (const inst of tracked) {
			try {
				if (inst.lastMessage) origUpdate.call(inst, inst.lastMessage);
			} catch {
				/* component may be disposed; ignore */
			}
		}
	}

	// Install immediately at extension-load time — BEFORE the session transcript
	// renders, so resumed/history blocks get instrumented from their very first
	// updateContent call. session_start can fire after initial rendering on
	// resume, which left historical blocks stock (the "back to Thinking..."
	// regression). Failure notice still waits for session_start (needs UI).
	installed = install();

	pi.on("session_start", async (_event, ctx) => {
		if (!installed) installed = install();
		if (!installed && ctx.hasUI && installNote) ctx.ui.notify(installNote, "warning");
	});

	pi.on("agent_start", () => {
		turnActive = true;
		reqStartMs = null;
		respEndMs = null;
		// Everything still unfrozen predates this turn (session history, earlier
		// turns rendered before the extension loaded). Freeze them to a duration-
		// less "Thought" so agent_end never stamps them with this turn's number.
		for (const inst of tracked) {
			if (!inst.__tlFrozen) inst.__tlFrozen = "Thought ▸";
		}
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
		if (!enabled || !lastDurText) return;
		const label = `Thought · ${lastDurText} ▸`;
		for (const inst of tracked) {
			// Only instances born during this turn earn the duration; historical
			// ones were frozen to duration-less "Thought ▸" at agent_start.
			if (!inst.isStreaming && !inst.__tlFrozen) {
				inst.__tlFrozen = label;
			}
		}
		reRenderTracked();
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
			if (enabled) reRenderTracked();
		},
	});
}
