/**
 * Minimal Mode — compact tool result summaries on top of pi's built-in renderers.
 *
 * Collapsed rows are ONE uniform line per call, in all three states:
 *
 *   running:    ○ git clone … ▸
 *   collapsed:  ✓ git status ▸
 *   failed:     ✗ npm test ▸
 *   expanded:   $ git status -s            ← built-in header (full command)
 *               ... full output ...        ← built-in output, nothing else
 *
 * The `$ command` header is suppressed from the moment execution starts, so
 * long commands never wrap into a wall of text. Expanding restores the
 * built-in header and full output — no summary line in between.
 *
 * Clicks: one left-click anywhere on a wrapped row toggles that block. Rapid
 * re-clicks (<350ms) are debounced — a double-click no longer toggles twice
 * and cancels itself out.
 *
 * Wrapped tools: bash, find, grep, ls, read, write, edit. Everything else
 * renders as pi ships it. Expand/collapse remains pi's built-in per-tool
 * toggle: Ctrl+O globally, or click a tool block in fullscreen TUI mode.
 *
 * Contract safety: expanded delegations pass built-ins a clean
 * `lastComponent: undefined`, so they always rebuild their own components
 * and our custom row components never leak into the built-ins' reuse chain
 * (the bold tool-name fallback was exactly that: a TypeError inside the
 * built-in renderCall, caught by pi, rendered as createCallFallback).
 *
 * Configuration (~/.pi/agent/minimal-mode.json):
 * {
 *   "glyphs": "unicode",            // "unicode" | "nerd" | "ascii"
 *   "overrides": { "check": "✔" },  // per-glyph surgical overrides
 *   "bashPreview": false,           // preview lines under the bash one-liner
 *   "thinkingLabel": "Thinking… ▸", // hidden thinking block label
 *   "statusColor": false            // true → green/red glyph, rest muted
 * }
 * Environment: PI_GLYPHS=nerd|unicode|ascii, or NERD_FONT=1.
 */

import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { loadConfig, resolveGlyphs, type GlyphSet, type MinimalModeConfig } from "./glyphs.ts";

const PREVIEW_LINES = 5;
const CACHE_MAX = 128;
const CLICK_DEBOUNCE_MS = 350;

function textOutput(result: AgentToolResult<any>): string {
	for (const block of result.content) {
		if (block.type === "text") return block.text;
	}
	return "";
}

function truncateMiddle(text: string, max: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	if (flat.length <= max) return flat;
	const half = Math.floor((max - 1) / 2);
	return `${flat.slice(0, half)}…${flat.slice(-half)}`;
}

/** Uniform collapsed row: glyph + summary + caret, single color by default. */
function rowLine(
	theme: Theme,
	glyphs: GlyphSet,
	glyph: string,
	ok: boolean,
	summary: string,
	caret: string,
	statusColor: boolean,
): string {
	const body = `${summary} ${caret}`.trim();
	if (statusColor) {
		const color = glyph === glyphs.running ? "accent" : ok ? "success" : "error";
		return `${theme.fg(color, glyph)} ${theme.fg("muted", body)}`;
	}
	return theme.fg("muted", `${glyph} ${body}`);
}

function tildePath(path: string): string {
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
	if (home && path.startsWith(home)) return `~${path.slice(home.length)}`;
	return path;
}

/** Per-tool start times, shared by renderCall/renderResult at draw time: lets
 *  the collapsed header tell "executing" from "not started yet" so the built-in
 *  `$ command` header stays suppressed while a call runs. */
interface ToolClock {
	starts: Map<string, number>;
}

function newClock(): ToolClock {
	return { starts: new Map() };
}

function prune(map: Map<string, number>): void {
	if (map.size >= CACHE_MAX) {
		map.delete(map.keys().next().value as string);
	}
}

/**
 * Swallow left-clicks that arrive within CLICK_DEBOUNCE_MS of the previous
 * one for the same tool call. Without this, a double-click toggles the block
 * twice — net zero — which reads as "clicking does nothing".
 */
/** Built-in renderers mutate lastComponent — always hand them a clean one. */
function cleanContext(context: any): any {
	return { ...context, lastComponent: undefined };
}

const lastToggleAt = new Map<string, number>();

function withClickDebounce(component: Component, toolCallId: string): Component {
	return {
		render(width: number) {
			return component.render(width);
		},
		invalidate() {
			component.invalidate();
		},
		handleMouse(event: TuiMouseEvent) {
			if (event.type === "click" && event.button === "left") {
				const now = Date.now();
				const last = lastToggleAt.get(toolCallId) ?? 0;
				lastToggleAt.set(toolCallId, now);
				if (now - last < CLICK_DEBOUNCE_MS) return { handled: true };
			}
			return undefined; // fall through: pi's MouseRegion toggles normally
		},
	};
}

export default function minimalMode(pi: ExtensionAPI) {
	const config: MinimalModeConfig = loadConfig();
	const glyphs = resolveGlyphs(config);
	const statusColor = config.statusColor === true;

	// Tool calls that have a final result — fresh (executed this session) or
	// restored from the session file. Restored rows have no clock data, so the
	// collapsed live header needs this to yield the row to the result one-liner.
	const resultsById = new Set<string>();

	// --- temporary debug instrumentation ---
	const debug = { calls: new Map<string, number>(), lastError: new Map<string, string>() };
	function debugCall(label: string): void {
		debug.calls.set(label, (debug.calls.get(label) ?? 0) + 1);
	}
	function debugError(label: string, err: unknown): void {
		const message = err instanceof Error ? err.message : String(err);
		if (debug.lastError.get(label) !== message) debug.lastError.set(label, message);
	}
	function instrument<T>(label: string, fn: () => T): T {
		debugCall(label);
		try {
			return fn();
		} catch (err) {
			debugError(label, err);
			return new Text("", 0, 0) as T;
		}
	}
	pi.registerCommand("minimal-debug", {
		description: "Dump minimal-mode renderer debug state",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			const lines = ["minimal-mode debug:"];
			for (const [k, v] of debug.calls) lines.push(`calls ${k}: ${v}`);
			for (const [k, v] of debug.lastError) lines.push(`LAST ERROR ${k}: ${v}`);
			if (debug.calls.size === 0 && debug.lastError.size === 0) lines.push("(nothing recorded)");
			ctx.ui.notify(lines.join("\n"));
		},
	});

	// Hidden thinking blocks: label with a collapse affordance
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		const label =
			typeof config.thinkingLabel === "string" && config.thinkingLabel.length > 0
				? config.thinkingLabel
				: `Thinking${glyphs.ellipsis} ${glyphs.collapsed}`;
		ctx.ui.setHiddenThinkingLabel(label);
	});

	/**
	 * Live call header: collapsed, it disappears once execution starts (the
	 * running/done one-liner in the result region owns the row). Expanded,
	 * it stays as the built-in full-command header. pi caches the returned
	 * component (lastComponent pattern) and does not re-invoke renderCall on
	 * state changes — hence the draw-time checks in render().
	 */
	function liveCallHeader(
		origCall: ((args: any, theme: Theme, context: any) => any) | undefined,
		args: any,
		theme: Theme,
		context: { expanded?: boolean; toolCallId: string },
		clock: ToolClock,
		runningSummary: string,
		toolName: string,
	): Component {
		if (context.expanded) {
			const component = instrument(`${toolName}:call-expanded`, () =>
				origCall ? origCall(args, theme, cleanContext(context)) : new Text("", 0, 0),
			);
			return withClickDebounce(component, context.toolCallId);
		}
		const callComponent = instrument(`${toolName}:call`, () =>
			origCall ? origCall(args, theme, cleanContext(context)) : new Text("", 0, 0),
		);
		const toolCallId = context.toolCallId;
		return withClickDebounce(
			{
				render(width: number): string[] {
					try {
						// A final result exists (executed this session or restored): the
						// one-liner in the result region owns the row.
						if (resultsById.has(toolCallId)) return [];
						const startedAt = clock.starts.get(toolCallId);
						if (startedAt !== undefined) {
							const line = rowLine(theme, glyphs, glyphs.running, true, runningSummary, glyphs.collapsed, statusColor);
							return [truncateToWidth(line, width)];
						}
						return callComponent.render(width); // not started → built-in header
					} catch (err) {
						// Never let a header-render bug take down the whole TUI.
						debugError(`${toolName}:live-header`, err);
						return callComponent.render(width);
					}
				},
				invalidate() {
					callComponent.invalidate();
				},
			},
			toolCallId,
		);
	}

	// --- bash: `○ git clone … ▸` → `✓ git status ▸` ------------
	{
		const toolName = "bash";
		const clock = newClock();
		const orig = createBashToolDefinition(process.cwd());
		pi.registerTool({
			...orig,
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				const fresh = createBashToolDefinition(ctx.cwd);
				prune(clock.starts);
				clock.starts.set(toolCallId, Date.now());
				return fresh.execute(toolCallId, params, signal, onUpdate, ctx);
			},
			renderCall(args, theme, context) {
				debugCall(`${toolName}:renderCall`);
				return liveCallHeader(
					orig.renderCall?.bind(orig),
					args,
					theme,
					context,
					clock,
					truncateMiddle(args?.command ?? "", 48),
					toolName,
				);
			},
			renderResult(result, options, theme, context) {
				debugCall(`${toolName}:renderResult${options.expanded ? "+x" : options.isPartial ? "+p" : ""}`);
				if (!options.isPartial) resultsById.add(context.toolCallId);
				// Expanded (running or done): built-in rendering, untouched.
				if (options.expanded) {
					const component = instrument(`${toolName}:result-expanded`, () =>
						orig.renderResult
							? orig.renderResult(result as AgentToolResult<any>, options, theme, cleanContext(context))
							: new Text(textOutput(result), 0, 0),
					);
					return withClickDebounce(component, context.toolCallId);
				}
				// Collapsed + running: the live header owns the row.
				if (options.isPartial) return new Text("", 0, 0);

				const args = (context as { args?: { command?: string } }).args;
				const summary = truncateMiddle(args?.command ?? "", 48);
				const one = rowLine(theme, glyphs, glyphs.check, context.isError !== true, summary, glyphs.collapsed, statusColor);
				if (config.bashPreview) {
					const preview = textOutput(result)
						.trimEnd()
						.split("\n")
						.slice(0, PREVIEW_LINES)
						.map((line) => theme.fg("toolOutput", line));
					return withClickDebounce(new Text([one, ...preview].join("\n"), 0, 0), context.toolCallId);
				}
				return withClickDebounce(new Text(one, 0, 0), context.toolCallId);
			},
		});
	}

	// --- find/grep/ls: `○ grep /pat/ ▸` → `✓ grep /pat/ → 12 matches ▸`
	for (const [toolName, create, noun] of [
		["find", createFindToolDefinition, "files"],
		["grep", createGrepToolDefinition, "matches"],
		["ls", createLsToolDefinition, "entries"],
	] as const) {
		const orig = create(process.cwd()) as ToolDefinition<any, any, any>;
		const clock = newClock();
		pi.registerTool({
			...orig,
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				const fresh = create(ctx.cwd) as ToolDefinition<any, any, any>;
				prune(clock.starts);
				clock.starts.set(toolCallId, Date.now());
				return fresh.execute(toolCallId, params, signal, onUpdate, ctx);
			},
			renderCall(args, theme, context) {
				debugCall(`${toolName}:renderCall`);
				const a = (args ?? {}) as Record<string, unknown>;
				const summary =
					typeof a.pattern === "string"
						? `${toolName} ${truncateMiddle(a.pattern, 32)}`
						: typeof a.path === "string"
							? `${toolName} ${truncateMiddle(tildePath(a.path), 32)}`
							: toolName;
				return liveCallHeader(orig.renderCall?.bind(orig), args, theme, context, clock, summary, toolName);
			},
			renderResult(result, options, theme, context) {
				debugCall(`${toolName}:renderResult${options.expanded ? "+x" : options.isPartial ? "+p" : ""}`);
				if (!options.isPartial) resultsById.add(context.toolCallId);
				if (options.expanded) {
					const component = instrument(`${toolName}:result-expanded`, () =>
						orig.renderResult
							? orig.renderResult(result as AgentToolResult<any>, options, theme, cleanContext(context))
							: new Text(textOutput(result), 0, 0),
					);
					return withClickDebounce(component, context.toolCallId);
				}
				if (options.isPartial) return new Text("", 0, 0);

				const a = (context as { args?: Record<string, unknown> }).args ?? {};
				const query =
					typeof a.pattern === "string"
						? `${toolName} ${truncateMiddle(a.pattern, 32)}`
						: typeof a.path === "string"
							? `${toolName} ${truncateMiddle(tildePath(a.path), 32)}`
							: toolName;
				const countNum = textOutput(result).trimEnd().split("\n").filter(Boolean).length;
				const countPart = context.isError !== true ? `${glyphs.arrow} ${countNum} ${noun}` : "failed";
				const summary = [query, countPart].filter(Boolean).join(" ");
				return withClickDebounce(
					new Text(rowLine(theme, glyphs, glyphs.check, context.isError !== true, summary, glyphs.collapsed, statusColor), 0, 0),
					context.toolCallId,
				);
			},
		});
	}

	// --- read/write/edit: `○ edit src/foo.ts ▸` → `✓ edit src/foo.ts ▸`
	for (const [toolName, create] of [
		["read", createReadToolDefinition],
		["write", createWriteToolDefinition],
		["edit", createEditToolDefinition],
	] as const) {
		const orig = create(process.cwd()) as ToolDefinition<any, any, any>;
		const clock = newClock();
		pi.registerTool({
			...orig,
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				const fresh = create(ctx.cwd) as ToolDefinition<any, any, any>;
				prune(clock.starts);
				clock.starts.set(toolCallId, Date.now());
				return fresh.execute(toolCallId, params, signal, onUpdate, ctx);
			},
			renderCall(args, theme, context) {
				debugCall(`${toolName}:renderCall`);
				const a = (args ?? {}) as Record<string, unknown>;
				const summary =
					typeof a.path === "string" ? `${toolName} ${truncateMiddle(tildePath(a.path), 40)}` : toolName;
				return liveCallHeader(orig.renderCall?.bind(orig), args, theme, context, clock, summary, toolName);
			},
			renderResult(result, options, theme, context) {
				debugCall(`${toolName}:renderResult${options.expanded ? "+x" : options.isPartial ? "+p" : ""}`);
				if (!options.isPartial) resultsById.add(context.toolCallId);
				if (options.expanded) {
					const component = instrument(`${toolName}:result-expanded`, () =>
						orig.renderResult
							? orig.renderResult(result as AgentToolResult<any>, options, theme, cleanContext(context))
							: new Text(textOutput(result), 0, 0),
					);
					return withClickDebounce(component, context.toolCallId);
				}
				if (options.isPartial) return new Text("", 0, 0);

				const a = (context as { args?: Record<string, unknown> }).args ?? {};
				const path = typeof a.path === "string" ? truncateMiddle(tildePath(a.path), 40) : "";
				const summary = `${toolName} ${path}`.trim();
				return withClickDebounce(
					new Text(rowLine(theme, glyphs, glyphs.check, context.isError !== true, summary, glyphs.collapsed, statusColor), 0, 0),
					context.toolCallId,
				);
			},
		});
	}
}
