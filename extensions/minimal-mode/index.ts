/**
 * Minimal Mode — compact tool result summaries on top of pi's built-in renderers.
 *
 * Collapsed rows are ONE uniform line per call, in all three states:
 *
 *   running:    ○ git clone … · 3.2s ▸     (elapsed ticks via partial updates)
 *   collapsed:  ✓ git status · 0.3s ▸
 *   failed:     ✗ npm test · 3.1s ▸
 *   expanded:   $ git status -s            ← built-in header (full command)
 *               ... full output ...        ← built-in output, nothing else
 *
 * The `$ command` header is suppressed from the moment execution starts, so
 * long commands never wrap into a wall of text. Expanding restores the
 * built-in header and full output — no summary line in between.
 *
 * Wrapped tools: bash, find, grep, ls, read, write, edit. Everything else
 * renders as pi ships it. Expand/collapse remains pi's built-in per-tool
 * toggle: Ctrl+O globally, or click a tool block in fullscreen TUI mode.
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
import { Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { loadConfig, resolveGlyphs, type GlyphSet, type MinimalModeConfig } from "./glyphs.ts";

const PREVIEW_LINES = 5;
const CACHE_MAX = 128;

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

function seconds(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
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

/** Per-tool timing state, shared by renderCall/renderResult at draw time. */
interface ToolClock {
	starts: Map<string, number>;
	durations: Map<string, number>;
}

function newClock(): ToolClock {
	return { starts: new Map(), durations: new Map() };
}

function prune(map: Map<string, number>): void {
	if (map.size >= CACHE_MAX) {
		map.delete(map.keys().next().value as string);
	}
}

export default function minimalMode(pi: ExtensionAPI) {
	const config: MinimalModeConfig = loadConfig();
	const glyphs = resolveGlyphs(config);
	const statusColor = config.statusColor === true;

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
	): Component {
		if (context.expanded) {
			return origCall ? origCall(args, theme, context) : new Text("", 0, 0);
		}
		const callComponent = origCall ? origCall(args, theme, context) : new Text("", 0, 0);
		const toolCallId = context.toolCallId;
		return {
			render(width: number): string[] {
				const durationMs = clock.durations.get(toolCallId);
				if (durationMs !== undefined) return []; // done → one-liner owns the row
				const startedAt = clock.starts.get(toolCallId);
				if (startedAt !== undefined) {
					const summary = [runningSummary, seconds(Date.now() - startedAt)]
						.filter(Boolean)
						.join(" · ");
					const line = rowLine(
						theme,
						glyphs,
						glyphs.running,
						true,
						summary,
						glyphs.collapsed,
						statusColor,
					);
					return [truncateToWidth(line, width)];
				}
				return callComponent.render(width); // not started → built-in header
			},
			invalidate() {
				callComponent.invalidate();
			},
		};
	}

	// --- bash: `○ git clone … · 3.2s ▸` → `✓ git status · 0.3s ▸` ------------
	{
		const clock = newClock();
		const orig = createBashToolDefinition(process.cwd());
		pi.registerTool({
			...orig,
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				const fresh = createBashToolDefinition(ctx.cwd);
				prune(clock.starts);
				clock.starts.set(toolCallId, Date.now());
				const started = Date.now();
				try {
					return await fresh.execute(toolCallId, params, signal, onUpdate, ctx);
				} finally {
					prune(clock.durations);
					clock.durations.set(toolCallId, Date.now() - started);
				}
			},
			renderCall(args, theme, context) {
				return liveCallHeader(
					orig.renderCall?.bind(orig),
					args,
					theme,
					context,
					clock,
					truncateMiddle(args?.command ?? "", 48),
				);
			},
			renderResult(result, options, theme, context) {
				// Expanded (running or done): built-in rendering, untouched.
				if (options.expanded) {
					return orig.renderResult
						? orig.renderResult(result as AgentToolResult<any>, options, theme, context)
						: new Text(textOutput(result), 0, 0);
				}
				// Collapsed + running: the live header owns the row.
				if (options.isPartial) return new Text("", 0, 0);

				const args = (context as { args?: { command?: string } }).args;
				const durationMs = clock.durations.get(context.toolCallId);
				const duration = durationMs !== undefined ? seconds(durationMs) : "";
				const command = truncateMiddle(args?.command ?? "", 48);
				const summary = [command, duration].filter(Boolean).join(" · ");
				const one = rowLine(theme, glyphs, glyphs.check, context.isError !== true, summary, glyphs.collapsed, statusColor);
				if (config.bashPreview) {
					const preview = textOutput(result)
						.trimEnd()
						.split("\n")
						.slice(0, PREVIEW_LINES)
						.map((line) => theme.fg("toolOutput", line));
					return new Text([one, ...preview].join("\n"), 0, 0);
				}
				return new Text(one, 0, 0);
			},
		});
	}

	// --- find/grep/ls: `○ grep /pat/ ▸` → `✓ grep /pat/ · 0.2s → 12 matches ▸`
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
				const started = Date.now();
				try {
					return await fresh.execute(toolCallId, params, signal, onUpdate, ctx);
				} finally {
					prune(clock.durations);
					clock.durations.set(toolCallId, Date.now() - started);
				}
			},
			renderCall(args, theme, context) {
				const a = (args ?? {}) as Record<string, unknown>;
				const summary =
					typeof a.pattern === "string"
						? `${toolName} ${truncateMiddle(a.pattern, 32)}`
						: typeof a.path === "string"
							? `${toolName} ${truncateMiddle(tildePath(a.path), 32)}`
							: toolName;
				return liveCallHeader(orig.renderCall?.bind(orig), args, theme, context, clock, summary);
			},
			renderResult(result, options, theme, context) {
				if (options.expanded) {
					return orig.renderResult
						? orig.renderResult(result as AgentToolResult<any>, options, theme, context)
						: new Text(textOutput(result), 0, 0);
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
				const duration = clock.durations.get(context.toolCallId);
				const durationText = duration !== undefined ? seconds(duration) : "";
				const summary = [query, durationText, countPart].filter(Boolean).join(" · ");
				return new Text(rowLine(theme, glyphs, glyphs.check, context.isError !== true, summary, glyphs.collapsed, statusColor), 0, 0);
			},
		});
	}

	// --- read/write/edit: `○ edit src/foo.ts ▸` → `✓ edit src/foo.ts · 0.1s ▸`
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
				const started = Date.now();
				try {
					return await fresh.execute(toolCallId, params, signal, onUpdate, ctx);
				} finally {
					prune(clock.durations);
					clock.durations.set(toolCallId, Date.now() - started);
				}
			},
			renderCall(args, theme, context) {
				const a = (args ?? {}) as Record<string, unknown>;
				const summary =
					typeof a.path === "string" ? `${toolName} ${truncateMiddle(tildePath(a.path), 40)}` : toolName;
				return liveCallHeader(orig.renderCall?.bind(orig), args, theme, context, clock, summary);
			},
			renderResult(result, options, theme, context) {
				if (options.expanded) {
					return orig.renderResult
						? orig.renderResult(result as AgentToolResult<any>, options, theme, context)
						: new Text(textOutput(result), 0, 0);
				}
				if (options.isPartial) return new Text("", 0, 0);

				const a = (context as { args?: Record<string, unknown> }).args ?? {};
				const path = typeof a.path === "string" ? truncateMiddle(tildePath(a.path), 40) : "";
				const summary = [`${toolName} ${path}`.trim(), clock.durations.get(context.toolCallId) !== undefined ? seconds(clock.durations.get(context.toolCallId) as number) : ""]
					.filter(Boolean)
					.join(" · ");
				return new Text(rowLine(theme, glyphs, glyphs.check, context.isError !== true, summary, glyphs.collapsed, statusColor), 0, 0);
			},
		});
	}
}
