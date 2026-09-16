/**
 * Minimal Mode — compact tool result summaries on top of pi's built-in renderers.
 *
 * v4: stateful carets. Collapsed rows show `▸`, expanded rows keep the
 * summary line with `▾` above the output:
 *
 *   collapsed:  ✓ git status · 0.3s · 4 lines ▸
 *   expanded:   $ git status -s            ← built-in header (full command)
 *               ✓ 0.3s · 4 lines ▾         ← summary, caret flipped
 *               ... full output ...        ← built-in output
 *
 * Also: hidden thinking blocks read `Thinking… ▸` (configurable label).
 * read, write, edit remain untouched — built-ins are superior.
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

function countLines(output: string): number {
	return output.trim() ? output.trimEnd().split("\n").length : 0;
}

function truncateMiddle(text: string, max: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	if (flat.length <= max) return flat;
	const half = Math.floor((max - 1) / 2);
	return `${flat.slice(0, half)}…${flat.slice(-half)}`;
}

interface StatParts {
	glyph: string;
	text: string;
}

/** Shared `✓ 0.3s · 4 lines` body (command/query excluded). */
function statParts(
	theme: Theme,
	glyphs: GlyphSet,
	ok: boolean,
	durationMs: number | undefined,
	lines: number,
	truncated: boolean,
): StatParts {
	const glyph = ok ? theme.fg("success", glyphs.check) : theme.fg("error", glyphs.fail);
	const bits: string[] = [];
	if (durationMs !== undefined) bits.push(`${(durationMs / 1000).toFixed(1)}s`);
	if (lines > 0) bits.push(`${lines} line${lines === 1 ? "" : "s"}`);
	if (truncated) bits.push(glyphs.ellipsis);
	return { glyph, text: bits.join(" · ") };
}

/** Collapsed bash one-liner: `✓ git status · 0.3s · 4 lines ▸` */
function bashOneLiner(
	command: string,
	theme: Theme,
	glyphs: GlyphSet,
	ok: boolean,
	durationMs: number | undefined,
	lines: number,
	truncated: boolean,
): string {
	const { glyph, text } = statParts(theme, glyphs, ok, durationMs, lines, truncated);
	const cmd = theme.fg("muted", truncateMiddle(command, 48));
	const body = text ? `${cmd} · ${text}` : cmd;
	return `${glyph} ${body} ${theme.fg("muted", glyphs.collapsed)}`;
}

/** Expanded bash summary: `✓ 0.3s · 4 lines ▾` (command is in the header above) */
function bashExpandedLine(
	theme: Theme,
	glyphs: GlyphSet,
	ok: boolean,
	durationMs: number | undefined,
	lines: number,
	truncated: boolean,
): string {
	const { glyph, text } = statParts(theme, glyphs, ok, durationMs, lines, truncated);
	return `${glyph} ${theme.fg("muted", text)} ${theme.fg("muted", glyphs.expanded)}`;
}

/** Collapsed find/grep/ls one-liner: `✓ grep /pat/ → 12 matches ▸` */
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

/** Expanded find/grep/ls summary: `✓ → 12 matches ▾` */
function countExpandedLine(
	theme: Theme,
	glyphs: GlyphSet,
	ok: boolean,
	count: number,
	noun: string,
): string {
	const glyph = ok ? theme.fg("success", glyphs.check) : theme.fg("error", glyphs.fail);
	const result = ok
		? theme.fg("muted", `${glyphs.arrow} ${count} ${noun}`)
		: theme.fg("muted", "failed");
	return `${glyph} ${result} ${theme.fg("muted", glyphs.expanded)}`;
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

	// --- bash: single-line collapsed rows, caret-flipped expanded rows -------
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
				// Collapsed: pi caches the returned component (lastComponent pattern)
				// and does NOT re-invoke renderCall when the result lands — return a
				// live component that checks completion at draw time. Once the
				// duration is recorded, the one-liner in the result region owns the
				// whole row and the header renders nothing.
				const toolCallId = context.toolCallId;
				const callComponent = orig.renderCall
					? orig.renderCall(args, theme, context)
					: new Text("", 0, 0);
				return {
					render(width: number): string[] {
						if (durations.has(toolCallId)) return [];
						return callComponent.render(width);
					},
					invalidate() {
						callComponent.invalidate();
					},
				};
			},
			renderResult(result, options, theme, context) {
				if (options.isPartial) {
					return orig.renderResult
						? orig.renderResult(result as AgentToolResult<any>, options, theme, context)
						: new Text(textOutput(result), 0, 0);
				}
				const args = (context as { args?: { command?: string } }).args;
				const details = result.details as { truncation?: { truncated?: boolean } } | undefined;
				const ok = context.isError !== true;
				const durationMs = durations.get(context.toolCallId);
				const lines = countLines(textOutput(result));
				const truncated = details?.truncation?.truncated === true;

				if (options.expanded) {
					const container = new Container();
					container.addChild(new Text(bashExpandedLine(theme, glyphs, ok, durationMs, lines, truncated), 0, 0));
					if (orig.renderResult) {
						container.addChild(orig.renderResult(result as AgentToolResult<any>, options, theme, context));
					} else {
						container.addChild(new Text(textOutput(result), 0, 0));
					}
					return container;
				}

				const one = bashOneLiner(args?.command ?? "", theme, glyphs, ok, durationMs, lines, truncated);
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
				if (context.expanded) {
					return orig.renderCall ? orig.renderCall(args, theme, context) : new Text("", 0, 0);
				}
				// Collapsed: same live-component pattern as bash — hide the header
				// at draw time once this call has completed.
				const toolCallId = context.toolCallId;
				const callComponent = orig.renderCall
					? orig.renderCall(args, theme, context)
					: new Text("", 0, 0);
				return {
					render(width: number): string[] {
						if (completed.has(toolCallId)) return [];
						return callComponent.render(width);
					},
					invalidate() {
						callComponent.invalidate();
					},
				};
			},
			renderResult(result, options, theme, context) {
				if (options.isPartial) {
					return orig.renderResult
						? orig.renderResult(result as AgentToolResult<any>, options, theme, context)
						: new Text(textOutput(result), 0, 0);
				}
				const ok = context.isError !== true;
				const count = countLines(textOutput(result));

				if (options.expanded) {
					const container = new Container();
					container.addChild(new Text(countExpandedLine(theme, glyphs, ok, count, noun), 0, 0));
					if (orig.renderResult) {
						container.addChild(orig.renderResult(result as AgentToolResult<any>, options, theme, context));
					} else {
						container.addChild(new Text(textOutput(result), 0, 0));
					}
					return container;
				}

				const args = (context as { args?: Record<string, unknown> }).args ?? {};
				const argSummary =
					typeof args.pattern === "string"
						? `${toolName} ${args.pattern}`
						: typeof args.path === "string"
							? `${toolName} ${args.path}`
							: toolName;
				return new Text(countOneLiner(argSummary.trim(), theme, glyphs, ok, count, noun), 0, 0);
			},
		});
	}
}
