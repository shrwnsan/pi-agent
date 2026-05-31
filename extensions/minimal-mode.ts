/**
 * Minimal Mode Extension - Custom tool display with collapsed/expanded views
 *
 * Overrides built-in tools with custom rendering:
 * - Collapsed mode: Shows tool call header with summary counts, no full output
 * - Expanded mode: Shows full output
 *
 * Note: The read tool is intentionally NOT overridden — v0.75.5+ built-in compact
 * read cards provide superior collapsed rendering with smart file classification
 * (skill, docs, resource) and OSC 8 clickable hyperlinks.
 *
 * Use Ctrl+O to toggle between collapsed and expanded views.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { homedir } from "os";

/**
 * Shorten a path by replacing home directory with ~
 */
function shortenPath(path: string): string {
	const home = homedir();
	if (path.startsWith(home)) {
		return `~${path.slice(home.length)}`;
	}
	return path;
}

export default function (pi: ExtensionAPI) {
	// =========================================================================
	// Bash Tool
	// =========================================================================
	pi.registerTool({
		name: "bash",
		label: "bash",
		description:
			"Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first).",
		parameters: createBashTool(process.cwd()).parameters,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return createBashTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const text = context.lastComponent ?? new Text("", 0, 0);
			const command = args.command || "...";
			const timeout = args.timeout as number | undefined;
			const timeoutSuffix = timeout ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";

			text.setText(theme.fg("toolTitle", theme.bold(`$ ${command}`)) + timeoutSuffix);
			return text;
		},

		renderResult(result, { expanded }, theme, context) {
			const text = context.lastComponent ?? new Text("", 0, 0);

			if (!expanded) {
				text.setText("");
				return text;
			}

			const textContent = result.content.find((c) => c.type === "text");
			if (!textContent || textContent.type !== "text") {
				text.setText("");
				return text;
			}

			const output = textContent.text
				.trim()
				.split("\n")
				.map((line) => theme.fg("toolOutput", line))
				.join("\n");

			text.setText(output ? `\n${output}` : "");
			return text;
		},
	});

	// =========================================================================
	// Write Tool
	// =========================================================================
	pi.registerTool({
		name: "write",
		label: "write",
		description:
			"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
		parameters: createWriteTool(process.cwd()).parameters,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return createWriteTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const text = context.lastComponent ?? new Text("", 0, 0);
			const path = shortenPath(args.path || "");
			const pathDisplay = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
			const lineCount = args.content ? args.content.split("\n").length : 0;
			const lineInfo = lineCount > 0 ? theme.fg("muted", ` (${lineCount} lines)`) : "";

			text.setText(`${theme.fg("toolTitle", theme.bold("write"))} ${pathDisplay}${lineInfo}`);
			return text;
		},

		renderResult(result, { expanded }, theme, context) {
			const text = context.lastComponent ?? new Text("", 0, 0);

			if (!expanded) {
				text.setText("");
				return text;
			}

			if (result.content.some((c) => c.type === "text" && c.text)) {
				const textContent = result.content.find((c) => c.type === "text");
				if (textContent?.type === "text" && textContent.text) {
					text.setText(`\n${theme.fg("error", textContent.text)}`);
					return text;
				}
			}

			text.setText("");
			return text;
		},
	});

	// =========================================================================
	// Edit Tool
	// =========================================================================
	pi.registerTool({
		name: "edit",
		label: "edit",
		description:
			"Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.",
		parameters: createEditTool(process.cwd()).parameters,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return createEditTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const text = context.lastComponent ?? new Text("", 0, 0);
			const path = shortenPath(args.path || "");
			const pathDisplay = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");

			text.setText(`${theme.fg("toolTitle", theme.bold("edit"))} ${pathDisplay}`);
			return text;
		},

		renderResult(result, { expanded }, theme, context) {
			const text = context.lastComponent ?? new Text("", 0, 0);

			if (!expanded) {
				text.setText("");
				return text;
			}

			const textContent = result.content.find((c) => c.type === "text");
			if (!textContent || textContent.type !== "text") {
				text.setText("");
				return text;
			}

			const content = textContent.text;
			if (content.includes("Error") || content.includes("error")) {
				text.setText(`\n${theme.fg("error", content)}`);
			} else {
				text.setText(`\n${theme.fg("toolOutput", content)}`);
			}
			return text;
		},
	});

	// =========================================================================
	// Find Tool
	// =========================================================================
	pi.registerTool({
		name: "find",
		label: "find",
		description:
			"Find files by name pattern (glob). Searches recursively from the specified path. Output limited to 200 results.",
		parameters: createFindTool(process.cwd()).parameters,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return createFindTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const text = context.lastComponent ?? new Text("", 0, 0);
			const pattern = args.pattern || "";
			const path = shortenPath(args.path || ".");
			const limit = args.limit;

			let display = `${theme.fg("toolTitle", theme.bold("find"))} ${theme.fg("accent", pattern)}`;
			display += theme.fg("toolOutput", ` in ${path}`);
			if (limit !== undefined) {
				display += theme.fg("toolOutput", ` (limit ${limit})`);
			}

			text.setText(display);
			return text;
		},

		renderResult(result, { expanded }, theme, context) {
			const text = context.lastComponent ?? new Text("", 0, 0);

			const textContent = result.content.find((c) => c.type === "text");
			if (!textContent || textContent.type !== "text") {
				text.setText("");
				return text;
			}

			if (!expanded) {
				const count = textContent.text.trim().split("\n").filter(Boolean).length;
				text.setText(count > 0 ? theme.fg("muted", ` → ${count} files`) : "");
				return text;
			}

			const output = textContent.text
				.trim()
				.split("\n")
				.map((line) => theme.fg("toolOutput", line))
				.join("\n");

			text.setText(output ? `\n${output}` : "");
			return text;
		},
	});

	// =========================================================================
	// Grep Tool
	// =========================================================================
	pi.registerTool({
		name: "grep",
		label: "grep",
		description:
			"Search file contents by regex pattern. Uses ripgrep for fast searching. Output limited to 200 matches.",
		parameters: createGrepTool(process.cwd()).parameters,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return createGrepTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const text = context.lastComponent ?? new Text("", 0, 0);
			const pattern = args.pattern || "";
			const path = shortenPath(args.path || ".");
			const glob = args.glob;
			const limit = args.limit;

			let display = `${theme.fg("toolTitle", theme.bold("grep"))} ${theme.fg("accent", `/${pattern}/`)}`;
			display += theme.fg("toolOutput", ` in ${path}`);
			if (glob) {
				display += theme.fg("toolOutput", ` (${glob})`);
			}
			if (limit !== undefined) {
				display += theme.fg("toolOutput", ` limit ${limit}`);
			}

			text.setText(display);
			return text;
		},

		renderResult(result, { expanded }, theme, context) {
			const text = context.lastComponent ?? new Text("", 0, 0);

			const textContent = result.content.find((c) => c.type === "text");
			if (!textContent || textContent.type !== "text") {
				text.setText("");
				return text;
			}

			if (!expanded) {
				const count = textContent.text.trim().split("\n").filter(Boolean).length;
				text.setText(count > 0 ? theme.fg("muted", ` → ${count} matches`) : "");
				return text;
			}

			const output = textContent.text
				.trim()
				.split("\n")
				.map((line) => theme.fg("toolOutput", line))
				.join("\n");

			text.setText(output ? `\n${output}` : "");
			return text;
		},
	});

	// =========================================================================
	// Ls Tool
	// =========================================================================
	pi.registerTool({
		name: "ls",
		label: "ls",
		description:
			"List directory contents with file sizes. Shows files and directories with their sizes. Output limited to 500 entries.",
		parameters: createLsTool(process.cwd()).parameters,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return createLsTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const text = context.lastComponent ?? new Text("", 0, 0);
			const path = shortenPath(args.path || ".");
			const limit = args.limit;

			let display = `${theme.fg("toolTitle", theme.bold("ls"))} ${theme.fg("accent", path)}`;
			if (limit !== undefined) {
				display += theme.fg("toolOutput", ` (limit ${limit})`);
			}

			text.setText(display);
			return text;
		},

		renderResult(result, { expanded }, theme, context) {
			const text = context.lastComponent ?? new Text("", 0, 0);

			const textContent = result.content.find((c) => c.type === "text");
			if (!textContent || textContent.type !== "text") {
				text.setText("");
				return text;
			}

			if (!expanded) {
				const count = textContent.text.trim().split("\n").filter(Boolean).length;
				text.setText(count > 0 ? theme.fg("muted", ` → ${count} entries`) : "");
				return text;
			}

			const output = textContent.text
				.trim()
				.split("\n")
				.map((line) => theme.fg("toolOutput", line))
				.join("\n");

			text.setText(output ? `\n${output}` : "");
			return text;
		},
	});
}
