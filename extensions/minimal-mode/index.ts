/**
 * Minimal Mode — compact tool result summaries on top of pi's built-in renderers.
 *
 * v3: true single-line collapsed rows (Amp-style). pi ≥0.78 ships excellent
 * built-in tool renderers (bash preview cards, edit diff previews, syntax
 * highlighting, per-tool click-to-expand). This extension only adds what's
 * still missing:
 *
 * - bash: collapsed → ONE dim line  `✓ git status · 0.3s · 4 lines ▸`
 *   (the `$ command` header is suppressed once the result lands; set
 *   "bashPreview": true to also keep ~5 preview lines under it)
 * - find/grep/ls: collapsed → ONE line  `✓ grep /pat/ → 12 matches ▸`
 * - thinking: hidden blocks read  `Thinking… ▸`  (configurable label)
 * - read, write, edit: intentionally untouched — built-ins are superior
 *
 * Expand/collapse remains pi's built-in per-tool toggle: Ctrl+O globally, or
 * click a tool block in fullscreen TUI mode.
 *
 * Configuration (~/.pi/agent/minimal-mode.json):
 * {
 *   "glyphs": "unicode",            // "unicode" | "nerd" | "ascii"
 *   "overrides": { "check": "✔" },  // per-glyph surgical overrides
 *   "bashPreview": false,           // preview lines under the bash one-liner
 *   "thinkingLabel": "Thinking… ▸"  // hidden thinking block label
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
import { createBashToolDefinition, createFindToolDefinition, createGrepToolDefinition, createLsToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { loadConfig, resolveGlyphs, type GlyphSet, type MinimalModeConfig } from "./glyphs.ts";

const PREVIEW_LINES = 5;
const CACHE_MAX = 128;

function textOutput(result: AgentToolResult<any>): string {
	for (const block of result.content) {
		if (block.type === "text") return block.text;
	}
	return "";
}

function countLines(output: string): number {
	return output.trim() ? output.trimEnd().split("\n").length : 0;
}

function truncateMiddle(text: string, max: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	if (flat.length <= max) return flat;
	const half = Math.floor((max - 1) / 2);
	return `${flat.slice(0, half)}…${flat.slice(-half)}`;
}

/** Collapsed one-liner: `✓ git status · 0.3s · 4 lines ▸` */
function bashOneLiner(
	command: string,
	theme: Theme,
	glyphs: GlyphSet,
	ok: boolean,
	durationMs: number | undefined,
	lines: number,
	truncated: boolean,
): string {
	const glyph = ok ? theme.fg("success", glyphs.check) : theme.fg("error", glyphs.fail);
	const bits: string[] = [truncateMiddle(command, 48)];
	if (durationMs !== undefined) bits.push(`${(durationMs / 1000).toFixed(1)}s`);
	if (lines > 0) bits.push(`${lines} line${lines === 1 ? "" : "s"}`);
	if (truncated) bits.push(glyphs.ellipsis);
	return `${glyph} ${theme.fg("muted", bits.join(" · "))} ${theme.fg("muted", glyphs.collapsed)}`;
}

/** Collapsed one-liner for find/grep/ls: `✓ grep /pat/ → 12 matches ▸` */
function countOneLiner(
	summary: string,
	theme: Theme,
	glyphs: GlyphSet,
	ok: boolean,
	count: number,
	noun: string,
): string {
	const glyph = ok ? theme.fg("success", glyphs.check) : theme.fg("error", glyphs.fail);
	const query = theme.fg("muted", truncateMiddle(summary, 40));
	const result = ok
		? theme.fg("muted", `${glyphs.arrow} ${count} ${noun}`)
		: theme.fg("muted", "failed");
	return `${glyph} ${query} ${result} ${theme.fg("muted", glyphs.collapsed)}`;
}

export default function minimalMode(pi: ExtensionAPI) {
	const config: MinimalModeConfig = loadConfig();
	const glyphs = resolveGlyphs(config);

	// Hidden thinking blocks: label with a collapse affordance
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		const label =
			typeof config.thinkingLabel === "string" && config.thinkingLabel.length > 0
				? config.thinkingLabel
				: `Thinking${glyphs.ellipsis} ${glyphs.collapsed}`;
		ctx.ui.setHiddenThinkingLabel(label);
	});

	// --- bash: single-line collapsed rows -----------------------------------
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
				// Once the result has landed, the one-liner in renderResult is the
				// whole row — drop the `$ command` header.
				if (!context.expanded && durations.has(context.toolCallId)) {
					return new Text("", 0, 0);
				}
				return orig.renderCall ? orig.renderCall(args, theme, context) : new Text("", 0, 0);
			},
			renderResult(result, options, theme, context) {
				if (options.isPartial || options.expanded) {
					return orig.renderResult
						? orig.renderResult(result as AgentToolResult<any>, options, theme, context)
						: new Text(textOutput(result), 0, 0);
				}
				const args = (context as { args?: { command?: string } }).args;
				const details = result.details as { truncation?: { truncated?: boolean } } | undefined;
				const one = bashOneLiner(
					args?.command ?? "",
					theme,
					glyphs,
					context.isError !== true,
					durations.get(context.toolCallId),
					countLines(textOutput(result)),
					details?.truncation?.truncated === true,
				);
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

	// --- find/grep/ls: single-line collapsed rows ----------------------------
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
				if (!context.expanded && completed.has(context.toolCallId)) {
					return new Text("", 0, 0);
				}
				return orig.renderCall ? orig.renderCall(args, theme, context) : new Text("", 0, 0);
			},
			renderResult(result, options, theme, context) {
				if (options.isPartial || options.expanded) {
					return orig.renderResult
						? orig.renderResult(result as AgentToolResult<any>, options, theme, context)
						: new Text(textOutput(result), 0, 0);
				}
				const args = (context as { args?: Record<string, unknown> }).args ?? {};
				const argSummary =
					typeof args.pattern === "string"
						? `${toolName} ${args.pattern}`
						: typeof args.path === "string"
							? `${toolName} ${args.path}`
							: toolName;
				const one = countOneLiner(
					argSummary.trim(),
					theme,
					glyphs,
					context.isError !== true,
					countLines(textOutput(result)),
					noun,
				);
				return new Text(one, 0, 0);
			},
		});
	}
}
