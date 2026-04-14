/**
 * Tilde Path Extension
 *
 * Modifies the system prompt to display the current working directory
 * with ~ notation instead of absolute paths (e.g., ~/project instead of
 * /Users/username/project).
 *
 * Placement: ~/.pi/agent/extensions/tilde-path/ (global)
 *            .pi/extensions/tilde-path/ (project-local)
 */

import { homedir } from "node:os";
import { relative } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function tildePathExtension(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => {
		const home = homedir();
		const cwdRegex = /Current working directory: (.+)$/m;

		const modifiedPrompt = event.systemPrompt.replace(cwdRegex, (_, cwd) => {
			const displayCwd = cwd.startsWith(home) ? `~${relative(home, cwd)}` : cwd;
			return `Current working directory: ${displayCwd}`;
		});

		return { systemPrompt: modifiedPrompt };
	});
}
