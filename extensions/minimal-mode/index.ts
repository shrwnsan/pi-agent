/**
 * Minimal Mode — compact tool result summaries on top of pi's built-in renderers.
 *
 * v2 philosophy: recent pi versions ship excellent built-in tool renderers
 * (bash preview cards with duration, edit diff previews, syntax highlighting,
 * per-tool click-to-expand). This extension no longer replaces any of that.
 * It only adds what's still missing:
 *
 * - bash: collapsed status line  `✓ 1.2s · 132 lines ▸`  (output hidden until
 *   expanded; set "bashPreview": true in the config to also keep a preview)
 * - find/grep/ls: collapsed count summaries  `✓ → 12 matches ▸`  instead of
 *   the built-in 20 raw lines
 * - read, write, edit: intentionally untouched — built-ins are superior
 *   (read compact cards, write highlighting, edit live diff preview)
 *
 * Expand/collapse remains pi's built-in per-tool toggle: Ctrl+O globally, or
 * click a tool block in fullscreen TUI mode.
 *
 * Configuration (~/.pi/agent/minimal-mode.json):
 * {
 *   "glyphs": "unicode",          // "unicode" | "nerd" | "ascii"
 *   "overrides": { "check": "✔" }, // per-glyph surgical overrides
 *   "bashPreview": false           // keep preview lines under the bash status line
 * }
 * Environment: PI_GLYPHS=nerd|unicode|ascii, or NERD_FONT=1.
 */

import type {
	AgentToolResult,
	ExtensionAPI,
	ToolDefinition,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { loadConfig, resolveGlyphs, type GlyphSet, type MinimalModeConfig } from "./glyphs.ts";

const PREVIEW_LINES = 5;
const DURATION_CACHE_MAX = 64;

function textOutput(result: AgentToolResult<any>): string {
	for (const block of result.content) {
		if (block.type === "text") return block.text;
	}
	return "";
}

function countLines(output: string): number {
	return output.trim() ? output.trimEnd().split("\n").length : 0;
}

function firstLine(output: string, max = 80): string {
	const line = output.trim().split("\n")[0] ?? "";
	return line.length > max ? `${line.slice(0, max)}…` : line;
}

/** Collapsed status line: `✓ 1.2s · 132 lines ▸` */
function statusLine(
	failed: boolean,
	result: AgentToolResult<any>,
	theme: Theme,
	glyphs: GlyphSet,
	durationMs: number | undefined,
): string {
	const glyph = failed
		? theme.fg("error", glyphs.fail)
		: theme.fg("success", glyphs.check);
	const bits: string[] = [];
	if (durationMs !== undefined) bits.push(`${(durationMs / 1000).toFixed(1)}s`);
	const lines = countLines(textOutput(result));
	if (lines > 0) bits.push(`${lines} line${lines === 1 ? "" : "s"}`);
	const details = result.details as { truncation?: { truncated?: boolean } } | undefined;
	if (details?.truncation?.truncated) bits.push(`${glyphs.ellipsis} truncated`);
	const summary = theme.fg("muted", bits.join(" · "));
	const caret = theme.fg("muted", glyphs.collapsed);
	return `${glyph}${summary ? ` ${summary}` : ""} ${caret}`;
}

export default function minimalMode(pi: ExtensionAPI) {
	const config: MinimalModeConfig = loadConfig();
	const glyphs = resolveGlyphs(config);

	// --- bash: collapsed status line (output hidden unless bashPreview) -----
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
					if (durations.size >= DURATION_CACHE_MAX) {
						durations.delete(durations.keys().next().value as string);
					}
					durations.set(toolCallId, Date.now() - started);
				}
			},
			renderResult(result, options, theme, context) {
				if (options.isPartial || options.expanded) {
					return orig.renderResult
						? orig.renderResult(result as AgentToolResult<any>, options, theme, context)
						: new Text(textOutput(result), 0, 0);
				}
				const lines = [
					statusLine(context.isError === true, result, theme, glyphs, durations.get(context.toolCallId)),
				];
				if (config.bashPreview) {
					const preview = textOutput(result)
						.trimEnd()
						.split("\n")
						.slice(0, PREVIEW_LINES)
						.map((line) => theme.fg("toolOutput", line));
					lines.push(...preview);
				}
				return new Text(lines.join("\n"), 0, 0);
			},
		});
	}

	// --- find/grep/ls: collapsed count summaries ----------------------------
	for (const [name, create, noun] of [
		["find", createFindToolDefinition, "files"],
		["grep", createGrepToolDefinition, "matches"],
		["ls", createLsToolDefinition, "entries"],
	] as const) {
		const orig = create(process.cwd()) as ToolDefinition<any, any, any>;
		void name;
		pi.registerTool({
			...orig,
			execute(toolCallId, params, signal, onUpdate, ctx) {
				const fresh = create(ctx.cwd) as ToolDefinition<any, any, any>;
				return fresh.execute(toolCallId, params, signal, onUpdate, ctx);
			},
			renderResult(result, options, theme, context) {
				if (options.isPartial || options.expanded) {
					return orig.renderResult
						? orig.renderResult(result, options, theme, context)
						: new Text(textOutput(result), 0, 0);
				}
				const output = textOutput(result);
				if (context.isError === true) {
					return new Text(
						`${theme.fg("error", glyphs.fail)} ${theme.fg("muted", firstLine(output))} ${theme.fg("muted", glyphs.collapsed)}`,
						0,
						0,
					);
				}
				const count = countLines(output);
				const summary = theme.fg("muted", `${glyphs.arrow} ${count} ${noun}`);
				return new Text(
					`${theme.fg("success", glyphs.check)} ${summary} ${theme.fg("muted", glyphs.collapsed)}`,
					0,
					0,
				);
			},
		});
	}
}
