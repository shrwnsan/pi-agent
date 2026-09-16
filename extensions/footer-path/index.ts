/**
 * Footer Path — minimal footer: `[machine] repo · branch`, worktree-aware.
 *
 * Replaces pi's default footer path display (absolute cwd + branch) with a
 * compact form:
 *
 *   [box] dotfiles · main                (container — default "tag" style)
 *   dotfiles · main                      (local machine — no machine segment)
 *   dotfiles · wt:experiment · main      (linked git worktree)
 *
 * Machine label is shown only when this isn't the local machine. Contexts:
 * - SSH session (SSH_CONNECTION / SSH_TTY)          → short hostname
 * - Docker/devcontainer/AgentBox                    → "box"    (icon: cube)
 * - other containers/VMs via systemd-detect-virt    → "box" / short hostname
 * - WSL                                             → "wsl"    (icon: tux)
 * - manual override                                 → FOOTER_MACHINE_NAME env var
 *
 * Display styles (machineStyle in ~/.pi/agent/footer-path.json):
 *   "tag"   (default)  [box] dotfiles · main   — machine demoted to metadata
 *   "dot"              box · dotfiles · main   — machine as a chain segment
 *   "glyph"            ▣ box · dotfiles · main — icon + label in the chain
 *   "none"             dotfiles · main         — machine suppressed entirely
 *
 * Nerd Font tier (glyphs: "nerd", or PI_GLYPHS/NERD_FONT env) swaps the glyph
 * style's ▣ for a context icon: cube (container), server (SSH), desktop (VM),
 * tux (WSL). All Font Awesome 4 codepoints — actually present in the font.
 *
 * Worktrees: detected once at session start via `git rev-parse`; the name is
 * taken from the path segment after a `.worktrees/` directory when present,
 * falling back to the git dir basename.
 *
 * All probes (git + virtualization) run once at session start — nothing
 * subprocess-y in the render path. Branch updates come from
 * footerData.onBranchChange(). Toggle with /footer-path.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

type MachineContext = "container" | "remote" | "vm" | "wsl";
type GlyphTier = "unicode" | "nerd" | "ascii";
type MachineStyle = "tag" | "dot" | "glyph" | "none";

interface MachineInfo {
	label: string;
	context: MachineContext;
}

interface FooterPathConfig {
	machineStyle?: MachineStyle;
	glyphs?: GlyphTier;
}

const MACHINE_STYLES: MachineStyle[] = ["tag", "dot", "glyph", "none"];
const GLYPH_TIERS: GlyphTier[] = ["unicode", "nerd", "ascii"];

// Font Awesome 4 PUA codepoints — \u escapes keep the source font-proof.
const NERD_MACHINE_ICONS: Record<MachineContext, string> = {
	container: "\uf1b2", // cube
	remote: "\uf233", // server
	vm: "\uf108", // desktop
	wsl: "\uf17c", // linux/tux
};
const UNICODE_MACHINE_GLYPH = "▣"; // near-universal: DejaVu/Menlo/Segoe fallback

function shortHostname(): string {
	return hostname().replace(/\.local$/, "");
}

function isWsl(): boolean {
	if (process.env.WSL_DISTRO_NAME) return true;
	try {
		return /microsoft/i.test(readFileSync("/proc/version", "utf8"));
	} catch {
		return false;
	}
}

/** systemd-detect-virt probe — Linux only, returns the virtualization type. */
function detectVirt(): { type: "container" | "vm"; name: string } | null {
	if (process.platform !== "linux") return null;
	try {
		const run = (flag: string): { ok: boolean; out: string } => {
			const result = spawnSync("systemd-detect-virt", [flag], { encoding: "utf8" });
			return { ok: result.status === 0, out: result.stdout?.trim() ?? "" };
		};
		const container = run("-c");
		if (container.ok && container.out) return { type: "container", name: container.out };
		const vm = run("-v");
		if (vm.ok && vm.out) return { type: "vm", name: vm.out };
	} catch {
		// systemd-detect-virt missing — fall through
	}
	return null;
}

function machineLabel(): MachineInfo | null {
	const override = process.env.FOOTER_MACHINE_NAME;
	if (override) return { label: override, context: "container" };
	if (process.env.SSH_CONNECTION || process.env.SSH_TTY) {
		return { label: shortHostname(), context: "remote" };
	}
	const inContainer =
		existsSync("/.dockerenv") ||
		!!process.env.DEVCONTAINER ||
		!!process.env.REMOTE_CONTAINERS ||
		!!process.env.AGENTBOX;
	if (inContainer) return { label: "box", context: "container" };
	const virt = detectVirt();
	if (virt?.type === "container") return { label: "box", context: "container" };
	if (virt?.type === "vm") return { label: shortHostname() || virt.name, context: "vm" };
	if (isWsl()) return { label: "wsl", context: "wsl" };
	return null;
}

function loadConfig(): FooterPathConfig {
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(join(process.env.HOME ?? "~", ".pi", "agent", "footer-path.json"), "utf8"),
		);
		if (typeof parsed !== "object" || parsed === null) return {};
		return parsed as FooterPathConfig;
	} catch {
		return {};
	}
}

function configValue<T extends string>(value: unknown, allowed: T[], fallback: T): T {
	return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

function resolveTier(config: FooterPathConfig): GlyphTier {
	const explicit = process.env.PI_GLYPHS?.toLowerCase();
	if (explicit && (GLYPH_TIERS as string[]).includes(explicit)) return explicit as GlyphTier;
	const nerd = process.env.NERD_FONT?.toLowerCase();
	if (nerd === "1" || nerd === "true") return "nerd";
	return configValue(config.glyphs, GLYPH_TIERS, "unicode");
}

function gitInfo(cwd: string): { repo: string; worktree: string | null } {
	const parts = { repo: basename(cwd), worktree: null as string | null };
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
		const config = loadConfig();
		const style = configValue(config.machineStyle, MACHINE_STYLES, "tag");
		const tier = resolveTier(config);
		const machine = style === "none" ? null : machineLabel();
		const parts = gitInfo(ctx.cwd);

		const machineSegment = (theme: Theme): string | null => {
			if (!machine) return null;
			if (style === "tag") return theme.fg("muted", `[${machine.label}]`);
			if (style === "dot") return theme.fg("dim", machine.label);
			const icon =
				tier === "nerd" ? NERD_MACHINE_ICONS[machine.context] : tier === "ascii" ? "" : UNICODE_MACHINE_GLYPH;
			return theme.fg("dim", icon ? `${icon} ${machine.label}` : machine.label);
		};

		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: unsubscribe,
				invalidate() {},
				render(width: number): string[] {
					const branch = footerData.getGitBranch();
					const chain: string[] = [parts.repo];
					if (parts.worktree) chain.push(theme.fg("muted", `wt:${parts.worktree}`));
					if (branch) chain.push(theme.fg("accent", branch));
					const chainText = chain.join(theme.fg("muted", " · "));
					const tag = machineSegment(theme);
					const line =
						tag && style === "tag" ? `${tag} ${chainText}` : tag ? [tag, chainText].join(theme.fg("muted", " · ")) : chainText;
					return [truncateToWidth(line, width)];
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
		description: "Toggle footer-path ([machine] repo · branch)",
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
