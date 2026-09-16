/**
 * Footer Path — minimal footer: `machine · repo · branch`, worktree-aware.
 *
 * Replaces pi's default footer path display (absolute cwd + branch) with a
 * compact form:
 *
 *   box · dotfiles · main                (container or remote)
 *   dotfiles · main                      (local machine)
 *   dotfiles · wt:experiment · main      (linked git worktree)
 *
 * Machine label is shown only when this isn't the local machine:
 * - SSH session (SSH_CONNECTION / SSH_TTY)        → short hostname
 * - container (/.dockerenv, DEVCONTAINER, REMOTE_CONTAINERS, AGENTBOX) → "box"
 * - manual override                               → FOOTER_MACHINE_NAME env var
 *
 * Worktrees: detected once at session start via `git rev-parse`; the name is
 * taken from the path segment after a `.worktrees/` directory when present,
 * falling back to the git dir basename.
 *
 * The git probe runs once — cwd is fixed per session. Branch updates come from
 * pi's footerData.onBranchChange() (no git subprocess in the render path).
 *
 * Toggle with /footer-path.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { basename, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

interface StaticParts {
	machine: string | null;
	repo: string;
	worktree: string | null;
}

function machineLabel(): string | null {
	const override = process.env.FOOTER_MACHINE_NAME;
	if (override) return override;
	if (process.env.SSH_CONNECTION || process.env.SSH_TTY) {
		return hostname().replace(/\.local$/, "");
	}
	const inContainer =
		existsSync("/.dockerenv") ||
		!!process.env.DEVCONTAINER ||
		!!process.env.REMOTE_CONTAINERS ||
		!!process.env.AGENTBOX;
	if (inContainer) return "box";
	return null;
}

function gitInfo(cwd: string): StaticParts {
	const parts: StaticParts = { machine: machineLabel(), repo: basename(cwd), worktree: null };
	try {
		const run = (args: string[]): string => {
			const result = spawnSync("git", args, { cwd, encoding: "utf8" });
			return result.status === 0 ? (result.stdout?.trim() ?? "") : "";
		};
		const toplevel = run(["rev-parse", "--show-toplevel"]);
		if (!toplevel) return parts; // not a git repo — keep folder name
		parts.repo = basename(toplevel);
		const gitDir = resolve(cwd, run(["rev-parse", "--absolute-git-dir"]));
		const commonDir = resolve(cwd, run(["rev-parse", "--git-common-dir"]));
		if (gitDir && commonDir && gitDir !== commonDir) {
			const marker = `${sep}.worktrees${sep}`;
			const idx = cwd.lastIndexOf(marker);
			parts.worktree = idx !== -1 ? cwd.slice(idx + marker.length).split(sep)[0] : basename(gitDir);
		}
	} catch {
		// git missing or unavailable — folder name is fine
	}
	return parts;
}

export default function footerPath(pi: ExtensionAPI) {
	let enabled = false;

	const install = (ctx: ExtensionContext): void => {
		const parts = gitInfo(ctx.cwd);
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: unsubscribe,
				invalidate() {},
				render(width: number): string[] {
					const branch = footerData.getGitBranch();
					const segments: string[] = [];
					if (parts.machine) segments.push(theme.fg("dim", parts.machine));
					segments.push(parts.repo);
					if (parts.worktree) segments.push(theme.fg("muted", `wt:${parts.worktree}`));
					if (branch) segments.push(theme.fg("accent", branch));
					return [truncateToWidth(segments.join(theme.fg("muted", " · ")), width)];
				},
			};
		});
	};

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		enabled = true;
		install(ctx);
	});

	pi.registerCommand("footer-path", {
		description: "Toggle footer-path (machine · repo · branch)",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			enabled = !enabled;
			if (enabled) {
				install(ctx);
			} else {
				ctx.ui.setFooter(undefined); // restore built-in footer
			}
			ctx.ui.notify(enabled ? "footer-path on" : "footer-path off — built-in footer restored");
		},
	});
}
