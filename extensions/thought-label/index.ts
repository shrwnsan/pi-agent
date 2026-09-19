/**
 * Thought Label — collapsed thinking header experiment. VERSION-LOCKED to pi 0.85.x.
 *
 * Want:  "󰧑 Thinking... ▸" (animated shimmer on "Thinking...") while a turn streams
 *        "󰧑 Thought · 4s ▸" once it ends (or "Thought · a few seconds" for short ones)
 *        "󰧑 Thought ▸" for pre-extension historical blocks (duration unknown)
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
 *   5. WAVE (v4.3): while an instance is streaming with thinking-only content,
 *      a 60ms timer invalidates it so pi re-bakes the label, and the
 *      accessor emits per-char ANSI (faint-band, no bold crest) — a shimmer
 *      sweeping "Thinking...". Only the collapse glyph "▸" stays static. The
 *      TUI reference for requestRender is captured from
 *      InteractiveMode.prototype.mountInteractiveTui.
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
 *     "wave": true, "waveMs": 60,
 *     "disabled": false }
 *   Stock (non-NF) machines: { "tier": "unicode" } → big ☕ via system emoji.
 *   Wave uses standard SGR faint/bold — degrades to plain text if unsupported.
 *
 * Toggle in-session: /thought-label (prints patch/tracking diagnostics)
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AssistantMessageComponent, InteractiveMode } from "@earendil-works/pi-coding-agent";
import { loadTierConfig, resolveTierGlyph } from "../../lib/tier-glyphs.ts";
import { homedir } from "node:os";
import { join } from "node:path";

interface ThoughtLabelConfig {
	briefMaxS?: number;
	briefText?: string;
	wave?: boolean;
	waveMs?: number;
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
		CONFIG_PATH,
	);
	let enabled = cfg.disabled !== true;
	// Nerd-first defaults: md-brain 󰧑 (U+F09D1). Stock (non-NF) machines set
	// {"tier": "unicode"} locally → big ☕ via system emoji fonts. ASCII = bare.
	const tierCfg = { tier: "nerd" as "nerd" | "unicode" | "ascii", nerdGlyph: "󰧑", ...cfg };
	const prefix = resolveTierGlyph(tierCfg, { unicode: "\u2615" }) + (tierCfg.tier === "ascii" ? "" : " ");
	const briefMaxS = cfg.briefMaxS ?? 4;
	const briefText = cfg.briefText ?? "a few seconds";
	const waveEnabled = cfg.wave !== false;
	const waveMs = Math.max(50, cfg.waveMs ?? 60);

	let installed = false;
	let installNote = "";
	const tracked = new Set<any>();
	// Historical durations, reconstructed at session_start from session-entry
	// timestamps: assistant-entry ts − previous branch-entry ts (entries are
	// written at completion, so the gap = generation time of that message —
	// same semantics as the live first-roundtrip measurement). Keyed by the
	// message object identity from the restored branch.
	const histDur = new Map<object, string>();
	let origUpdate: ((this: any, message: unknown, isStreaming?: boolean) => void) | null = null;
	// TUI ref lives on globalThis: it survives /reload closure generations (the
	// tagged prototype wrapper is installed once, so a reloaded generation must
	// read the ref captured by an earlier generation or by the next mount).
	const gt = globalThis as { __thoughtLabelTui?: { requestRender: (force?: boolean) => void } | null };
	function getTui() {
		return gt.__thoughtLabelTui ?? null;
	}
	let waveTimer: ReturnType<typeof setInterval> | null = null;
	let waveStartedAt = 0;
	let wavePhase = 0;

	// Current turn timing state. respMs = first provider roundtrip of the turn
	// (the thinking phase, at least for think-then-act models at high effort).
	let turnActive = false;
	let reqStartMs: number | null = null;
	let respEndMs: number | null = null;
	let lastDurText: string | null = null;

	function liveLabel(inst: any): string {
		let raw = (inst.__tlRaw ?? "Thinking...").toLowerCase();
		if (!enabled) return raw;
		let label: string;
		if (inst.__tlFrozen) {
			label = inst.__tlFrozen;
		} else {
			const hist = histDur.get(inst.lastMessage);
			if (hist) {
				label = hist;
			} else if (!inst.isStreaming) {
				// Completed message (history, or a finished round mid-turn).
				label = "thought ▸";
			} else if (waveEnabled && getTui()) {
				// Streaming: shimmer glyph + text; collapse glyph stays static.
				const m = raw.match(/^(.*?\S)(\s*▸\s*)$/s);
				const animatePart = prefix + (m ? m[1] : raw);
				const suffix = m ? m[2] : "";
				return (
					"" +
					[...animatePart]
						.map((ch, i) => {
							// Faint troughs travelling through otherwise-normal chars.
							return Math.sin(i * 0.9 - wavePhase) < -0.5 ? `\x1b[2m${ch}\x1b[22m` : ch;
						})
						.join("") +
					suffix
				);
			} else {
				label = raw;
			}
			return `${prefix}${label}`;
		}
		return `${prefix}${label}`;
	}

	/**
	 * Post-bake italic strip. pi bakes the label via chalk.italic(chalk.fg(label)),
	 * and chalk REWRITES any [23m inside our string back to [3m (applyStyle's
	 * re-open logic) — cancelling italic in-string is impossible. Instead we patch
	 * the FINAL bytes of the baked Text node: drop [3m and [23m.
	 */
	function stripItalics(inst: any): void {
		try {
			const cc = inst.contentContainer;
			const stack: any[] = [...(cc?.children ?? [])];
			while (stack.length) {
				const node = stack.shift();
				if (!node) continue;
				// Wave faint-marks split words with SGR codes — match on the
				// ANSI-stripped plain text, not the raw bytes.
				const plain = typeof node.text === "string" ? node.text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "") : "";
				if (typeof node.text === "string" && /\x1b\[3m/.test(node.text) && /thought|thinking/i.test(plain)) {
					const cleaned = node.text.replace(/\x1b\[3m/g, "").replace(/\x1b\[23m/g, "");
					if (cleaned !== node.text) node.setText(cleaned);
					return; // label found and cleaned
				}
				if (node.child) stack.push(node.child);
				if (node.children) stack.push(...node.children);
			}
		} catch {
			/* cosmetic only */
		}
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

	function captureTui(): void {
		try {
			const proto = (InteractiveMode as any).prototype;
			if (!proto || typeof proto.mountInteractiveTui !== "function") return;
			if ((proto.mountInteractiveTui as any).__thoughtLabelCapture) return;
			const orig = proto.mountInteractiveTui;
			const wrapped = function (this: any, tui: any, components: unknown[]) {
				if (tui && typeof tui.requestRender === "function") gt.__thoughtLabelTui = tui;
				return orig.call(this, tui, components);
			} as any;
			wrapped.__thoughtLabelCapture = true;
			proto.mountInteractiveTui = wrapped;
		} catch {
			/* capture is best-effort; wave simply stays off without a tui ref */
		}
	}

	function thinkingOnly(inst: any): boolean {
		const content = inst.lastMessage?.content;
		return Array.isArray(content) && content.length > 0 && content.every((b: any) => b?.type === "thinking");
	}

	function waveTick(): void {
		const tui = getTui();
		if (!turnActive || !tui) return;
		// Self-reap: a /reload mid-turn orphans this generation's interval (its
		// agent_end handler is gone). Any real turn ends long before this cap.
		if (Date.now() - waveStartedAt > 30 * 60_000) {
			stopWave();
			return;
		}
		wavePhase += 0.6;
		try {
			let touched = 0;
			for (const inst of tracked) {
				// Only invalidate thinking-only streaming instances: the rebuild is
				// cheap there and the label is the only visible child. Once text
				// starts streaming, freeze the shimmer (markdown rebuilds are heavy).
				if (inst.isStreaming && thinkingOnly(inst)) {
					inst.invalidate();
					touched++;
				}
			}
			// Skip the frame when nothing qualified — no wasted renders on turns
			// whose thinking phase already handed off to text.
			if (touched > 0) tui.requestRender();
		} catch {
			/* animation is cosmetic; never break the session */
		}
	}

	function startWave(): void {
		if (waveTimer || !waveEnabled || !waveEnabledNow()) return;
		waveStartedAt = Date.now();
		waveTimer = setInterval(waveTick, waveMs);
	}

	function waveEnabledNow(): boolean {
		return enabled && waveEnabled;
	}

	function stopWave(): void {
		if (waveTimer) {
			clearInterval(waveTimer);
			waveTimer = null;
		}
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
				const res = orig.call(this, message, isStreaming);
				try {
					stripItalics(this);
					// Historical block with a reconstructed duration: freeze + re-bake
					// once (the first bake happened before the freeze was known).
					if (enabled && !this.__tlFrozen && this.lastMessage) {
						const hist = histDur.get(this.lastMessage);
						if (hist) {
							this.__tlFrozen = hist;
							orig.call(this, this.lastMessage);
							stripItalics(this);
						}
					}
				} catch {
					/* cosmetic only */
				}
				return res;
			} as any;
			wrapped.__thoughtLabelPatch = true; // reload idempotency marker
			proto.updateContent = wrapped;
			origUpdate = orig;
			captureTui();
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
				if (inst.lastMessage) {
					origUpdate.call(inst, inst.lastMessage);
					stripItalics(inst);
				}
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
		try {
			// Supported-API belt (v4.6): set the lowercase base label through
			// ctx.ui.setHiddenThinkingLabel so even edge-case components that miss
			// our accessor still show it. Glyph prefix is added by the getter, so
			// the raw stays glyph-free (no double-prefix). Per-instance wave and
			// durations remain accessor-side.
			const ui = (ctx as any).ui;
			if (enabled && ui && typeof ui.setHiddenThinkingLabel === "function") {
				ui.setHiddenThinkingLabel("thinking… ▸");
			}
		} catch {
			/* cosmetic only */
		}
		// Startup-rendered blocks were baked before reconstruction landed; one
		// deferred sweep re-strips them (setText clears their render cache).
		setTimeout(() => {
			for (const inst of tracked) stripItalics(inst);
		}, 0);
		// Reconstruct historical thinking durations from session-entry timestamps.
		try {
			const branch = (ctx as any).sessionManager?.getBranch?.() ?? [];
			let prevTs: number | null = null;
			for (const entry of branch as any[]) {
				const ts = entry?.timestamp ? Date.parse(entry.timestamp) : NaN;
				const msg = entry?.type === "message" ? entry.message : null;
				if (msg?.role === "assistant" && !Number.isNaN(prevTs) && !Number.isNaN(ts) && ts > prevTs) {
					const secs = (ts - prevTs) / 1000;
					if (secs < 3600) histDur.set(msg, `thought · ${fmtDuration(secs, briefMaxS, briefText)} ▸`);
				}
				prevTs = Number.isNaN(ts) ? prevTs : ts;
			}
		} catch {
			/* reconstruction is best-effort */
		}
		if (!installed && ctx.hasUI && installNote) ctx.ui.notify(installNote, "warning");
	});

	pi.on("agent_start", () => {
		turnActive = true;
		reqStartMs = null;
		respEndMs = null;
		// Everything still unfrozen predates this turn — but if it has a
		// reconstructed duration from the session file, keep that instead.
		for (const inst of tracked) {
			// Never freeze a streaming instance: a late agent_start (resume + queued
			// message) must not strip its upcoming duration.
			if (!inst.__tlFrozen && !inst.isStreaming && !histDur.has(inst.lastMessage)) {
				inst.__tlFrozen = "thought ▸";
				try {
					if (inst.lastMessage && origUpdate) {
						origUpdate.call(inst, inst.lastMessage);
						stripItalics(inst);
					}
				} catch {
					/* cosmetic only */
				}
			}
		}
		startWave();
	});

	pi.on("before_provider_request", () => {
		if (reqStartMs === null) reqStartMs = Date.now();
	});

	pi.on("after_provider_response", () => {
		if (reqStartMs !== null && respEndMs === null) respEndMs = Date.now();
	});

	pi.on("agent_end", () => {
		turnActive = false;
		stopWave();
		const now = Date.now();
		const seconds =
			reqStartMs !== null && respEndMs !== null
				? (respEndMs - reqStartMs) / 1000
				: reqStartMs !== null
					? (now - reqStartMs) / 1000
					: null;
		lastDurText = seconds !== null ? fmtDuration(seconds, briefMaxS, briefText) : null;
		if (!enabled) return;
		// Resolve every turn instance now — with the measured duration when we
		// have one, otherwise duration-less. Never leave them dangling for the
		// next agent_start to sweep with the wrong label.
		const label = lastDurText ? `thought · ${lastDurText} ▸` : "thought ▸";
		for (const inst of tracked) {
			// agent_end is authoritative: streaming is over, so every turn instance
			// resolves here (measured duration, or duration-less when untimed).
			if (!inst.__tlFrozen && !histDur.has(inst.lastMessage)) {
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
			if (!enabled) stopWave();
			const trackedCount = tracked.size;
			ctx.ui.notify(
				`thought-label ${enabled ? "enabled" : "disabled"} · patched:${installed} · tracked:${trackedCount} · hist:${histDur.size} · lastDur:${lastDurText ?? "—"} · wave:${waveEnabled && getTui() ? "on" : "off"}`,
				"info",
			);
			if (enabled) reRenderTracked();
		},
	});
}
