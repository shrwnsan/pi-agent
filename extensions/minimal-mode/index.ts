/**
 * Minimal Mode — compact tool result summaries on top of pi's built-in renderers.
 *
 * Collapsed rows are ONE uniform line per call; expanded rows keep the
 * summary with a flipped caret above the full output:
 *
 *   collapsed:  ✓ git status · 0.3s ▸
 *   expanded:   $ git status -s            ← built-in header (full command)
 *               ✓ 0.3s ▾                   ← caret flipped
 *               ... full output ...
 *
 * Wrapped tools: bash, find, grep, ls, read, write, edit. Everything else
 * (built-in or custom) renders as pi ships it. Expand/collapse remains pi's
 * built-in per-tool toggle: Ctrl+O globally, or click a tool block in
 * fullscreen TUI mode.
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
import { Container, Text, truncateToWidth } from "@earendil-works/pi-tui";
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

/**
 * Uniform row line: glyph + summary + caret, single color by default.
 * statusColor=true keeps the green/red glyph with muted text.
 */
function rowLine(
	theme: Theme,
	glyphs: GlyphSet,
	ok: boolean,
	summary: string,
	caret: string,
	statusColor: boolean,
): string {
	const body = `${summary} ${caret}`.trim();
	if (statusColor) {
		const glyph = ok ? theme.fg("success", glyphs.check) : theme.fg("error", glyphs.fail);
		return `${glyph} ${theme.fg("muted", body)}`;
	}
	return theme.fg("muted", `${ok ? glyphs.check : glyphs.fail} ${body}`);
}

function tildePath(path: string): string {
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
	if (home && path.startsWith(home)) return `~${path.slice(home.length)}`;
	return path;
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

	/** Collapsed: hide the header at draw time once this call has completed. */
	function liveCallSuppression(
		callComponent: ReturnType<NonNullable<ToolDefinition<any, any, any>["renderCall"]>>,
		done: (toolCallId: string) => boolean,
		toolCallId: string,
	) {
		return {
			render(width: number): string[] {
				if (done(toolCallId)) return [];
				return callComponent.render(width);
			},
			invalidate() {
				callComponent.invalidate();
			},
		};
	}

	// --- bash: `✓ git status · 0.3s ▸` ---------------------------------------
	{
		const durations = new Map<string, number>();
		const orig = createBashToolDefinition(process.cwd());
		pi.registerTool({
			...orig,
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				const fresh = createBashToolDefinition(ctx.cwd);
				const started = Date.now();
				try {
					return await fresh.execute(toolCallId, params, signal, onUpdate, ctx);
				} finally {
					if (durations.size >= CACHE_MAX) {
						durations.delete(durations.keys().next().value as string);
					}
					durations.set(toolCallId, Date.now() - started);
				}
			},
			renderCall(args, theme, context) {
				if (context.expanded) {
					return orig.renderCall ? orig.renderCall(args, theme, context) : new Text("", 0, 0);
				}
				// pi caches the returned component (lastComponent pattern) and does
				// NOT re-invoke renderCall when the result lands — check completion
				// at draw time instead.
				const callComponent = orig.renderCall ? orig.renderCall(args, theme, context) : new Text("", 0, 0);
				return liveCallSuppression(callComponent, (id) => durations.has(id), context.toolCallId);
			},
			renderResult(result, options, theme, context) {
				if (options.isPartial) {
					return orig.renderResult
						? orig.renderResult(result as AgentToolResult<any>, options, theme, context)
						: new Text(textOutput(result), 0, 0);
				}
				const args = (context as { args?: { command?: string } }).args;
				const duration = durations.get(context.toolCallId);
				const secs = duration !== undefined ? `${(duration / 1000).toFixed(1)}s` : "";
				const summary = [truncateMiddle(args?.command ?? "", 48), secs].filter(Boolean).join(" · ");

				if (options.expanded) {
					const container = new Container();
					container.addChild(new Text(rowLine(theme, glyphs, context.isError !== true, secs, glyphs.expanded, statusColor), 0, 0));
					if (orig.renderResult) {
						container.addChild(orig.renderResult(result as AgentToolResult<any>, options, theme, context));
					} else {
						container.addChild(new Text(textOutput(result), 0, 0));
					}
					return container;
				}

				const one = rowLine(theme, glyphs, context.isError !== true, summary, glyphs.collapsed, statusColor);
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

	// --- find/grep/ls: `✓ grep /pat/ → 12 matches ▸` -------------------------
	for (const [toolName, create, noun] of [
		["find", createFindToolDefinition, "files"],
		["grep", createGrepToolDefinition, "matches"],
		["ls", createLsToolDefinition, "entries"],
	] as const) {
		const orig = create(process.cwd()) as ToolDefinition<any, any, any>;
		const completed = new Set<string>();
		pi.registerTool({
			...orig,
			execute(toolCallId, params, signal, onUpdate, ctx) {
				const fresh = create(ctx.cwd) as ToolDefinition<any, any, any>;
				const result = fresh.execute(toolCallId, params, signal, onUpdate, ctx);
				if (completed.size >= CACHE_MAX) {
					const oldest = completed.values().next().value;
					if (oldest !== undefined) completed.delete(oldest);
				}
				completed.add(toolCallId);
				return result;
			},
			renderCall(args, theme, context) {
				if (context.expanded) {
					return orig.renderCall ? orig.renderCall(args, theme, context) : new Text("", 0, 0);
				}
				const callComponent = orig.renderCall ? orig.renderCall(args, theme, context) : new Text("", 0, 0);
				return liveCallSuppression(callComponent, (id) => completed.has(id), context.toolCallId);
			},
			renderResult(result, options, theme, context) {
				if (options.isPartial) {
					return orig.renderResult
						? orig.renderResult(result as AgentToolResult<any>, options, theme, context)
						: new Text(textOutput(result), 0, 0);
				}
				const args = (context as { args?: Record<string, unknown> }).args ?? {};
				const query =
					typeof args.pattern === "string"
						? `${toolName} ${args.pattern}`
						: typeof args.path === "string"
							? `${toolName} ${tildePath(args.path)}`
							: toolName;
				const ok = context.isError !== true;
				const countNum = textOutput(result).trimEnd().split("\n").filter(Boolean).length;

				if (options.expanded) {
					const expandedSummary = ok
						? `${glyphs.arrow} ${countNum} ${noun}`
						: "failed";
					const container = new Container();
					container.addChild(new Text(rowLine(theme, glyphs, ok, expandedSummary, glyphs.expanded, statusColor), 0, 0));
					if (orig.renderResult) {
						container.addChild(orig.renderResult(result as AgentToolResult<any>, options, theme, context));
					} else {
						container.addChild(new Text(textOutput(result), 0, 0));
					}
					return container;
				}

				const countText = ok ? `${query} ${glyphs.arrow} ${countNum} ${noun}` : `${query} failed`;
				return new Text(rowLine(theme, glyphs, ok, countText, glyphs.collapsed, statusColor), 0, 0);
			},
		});
	}

	// --- read/write/edit: `✓ edit src/foo.ts ▸` ------------------------------
	for (const [toolName, create] of [
		["read", createReadToolDefinition],
		["write", createWriteToolDefinition],
		["edit", createEditToolDefinition],
	] as const) {
		const orig = create(process.cwd()) as ToolDefinition<any, any, any>;
		const completed = new Set<string>();
		pi.registerTool({
			...orig,
			execute(toolCallId, params, signal, onUpdate, ctx) {
				const fresh = create(ctx.cwd) as ToolDefinition<any, any, any>;
				const result = fresh.execute(toolCallId, params, signal, onUpdate, ctx);
				if (completed.size >= CACHE_MAX) {
					const oldest = completed.values().next().value;
					if (oldest !== undefined) completed.delete(oldest);
				}
				completed.add(toolCallId);
				return result;
			},
			renderCall(args, theme, context) {
				if (context.expanded) {
					return orig.renderCall ? orig.renderCall(args, theme, context) : new Text("", 0, 0);
				}
				const callComponent = orig.renderCall ? orig.renderCall(args, theme, context) : new Text("", 0, 0);
				return liveCallSuppression(callComponent, (id) => completed.has(id), context.toolCallId);
			},
			renderResult(result, options, theme, context) {
				if (options.isPartial) {
					return orig.renderResult
						? orig.renderResult(result as AgentToolResult<any>, options, theme, context)
						: new Text(textOutput(result), 0, 0);
				}
				const args = (context as { args?: Record<string, unknown> }).args ?? {};
				const path = typeof args.path === "string" ? tildePath(args.path) : "";
				const summary = `${toolName} ${truncateMiddle(path, 48)}`.trim();

				if (options.expanded) {
					const container = new Container();
					container.addChild(new Text(rowLine(theme, glyphs, context.isError !== true, summary, glyphs.expanded, statusColor), 0, 0));
					if (orig.renderResult) {
						container.addChild(orig.renderResult(result as AgentToolResult<any>, options, theme, context));
					} else {
						container.addChild(new Text(textOutput(result), 0, 0));
					}
					return container;
				}

				return new Text(rowLine(theme, glyphs, context.isError !== true, summary, glyphs.collapsed, statusColor), 0, 0);
			},
		});
	}
}
