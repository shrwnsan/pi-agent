/**
 * Footer Path — minimal footer: `[machine] repo · branch` + pi's stats line.
 *
 * Replaces pi's default footer (which starts with the absolute cwd) with a
 * compact two-line form:
 *
 *   [box] dotfiles · main                             ← line 1 (this extension)
 *   ↑225k ↓80k R6.4M CH99.6% 11.5%/1.0M   (zai) glm… ← line 2 (replicated stats)
 *
 * Line 1 is the compact, worktree-aware path. Machine label is shown only
 * when this isn't the local machine (see machineLabel() below). Line 2
 * replicates pi's built-in token/context/model stats from the documented
 * extension data path (ctx.getContextUsage(), ctx.sessionManager.getEntries(),
 * ctx.model) so taking over the footer doesn't lose it.
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
 * taken from the path segment after a `.worktrees/` directory when present.
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
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

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

// --- stats line (mirrors pi's built-in footer computation) ------------------

interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

interface UsageLike {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: { total?: number };
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
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

					// Line 1 — compact path
					const chain: string[] = [parts.repo];
					if (parts.worktree) chain.push(theme.fg("muted", `wt:${parts.worktree}`));
					const getSessionName = (ctx.sessionManager as { getSessionName?: () => string | undefined })
						.getSessionName;
					const sessionName = getSessionName?.call(ctx.sessionManager);
					if (sessionName) chain.push(theme.fg("muted", sessionName));
					if (branch) chain.push(theme.fg("accent", branch));
					const chainText = chain.join(theme.fg("muted", " · "));
					const tag = machineSegment(theme);
					const line1 =
						tag && style === "tag"
							? `${tag} ${chainText}`
							: tag
								? [tag, chainText].join(theme.fg("muted", " · "))
								: chainText;
					const lines = [truncateToWidth(line1, width)];

					// Line 2 — token/context stats + model (mirrors built-in footer)
					const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
					let latestCacheHitRate: number | undefined;
					const add = (u: UsageLike): void => {
						totals.input += u.input ?? 0;
						totals.output += u.output ?? 0;
						totals.cacheRead += u.cacheRead ?? 0;
						totals.cacheWrite += u.cacheWrite ?? 0;
						totals.cost += u.cost?.total ?? 0;
					};
					for (const entry of ctx.sessionManager.getEntries()) {
						const e = entry as {
							type: string;
							message?: { role?: string; usage?: UsageLike };
							usage?: UsageLike;
						};
						if (e.type === "message" && e.message?.role === "assistant" && e.message.usage) {
							add(e.message.usage);
							const u = e.message.usage;
							const promptTokens = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
							latestCacheHitRate =
								promptTokens > 0 ? ((u.cacheRead ?? 0) / promptTokens) * 100 : undefined;
						} else if (e.type === "message" && e.message?.role === "toolResult" && e.message.usage) {
							add(e.message.usage);
						} else if ((e.type === "branch_summary" || e.type === "compaction") && e.usage) {
							add(e.usage);
						}
					}

					const statsParts: string[] = [];
					if (totals.input) statsParts.push(`↑${formatTokens(totals.input)}`);
					if (totals.output) statsParts.push(`↓${formatTokens(totals.output)}`);
					if (totals.cacheRead) statsParts.push(`R${formatTokens(totals.cacheRead)}`);
					if (totals.cacheWrite) statsParts.push(`W${formatTokens(totals.cacheWrite)}`);
					if ((totals.cacheRead > 0 || totals.cacheWrite > 0) && latestCacheHitRate !== undefined) {
						statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
					}
					if (totals.cost) statsParts.push(`$${totals.cost.toFixed(3)}`);

					const contextUsage = ctx.getContextUsage?.();
					const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const percentValue = contextUsage?.percent ?? 0;
					const percentText = contextUsage?.percent != null ? `${percentValue.toFixed(1)}%` : "?";
					const contextText = `${percentText}/${formatTokens(contextWindow)}`;
					const contextStyled =
						percentValue > 90
							? theme.fg("error", contextText)
							: percentValue > 70
								? theme.fg("warning", contextText)
								: contextText;
					statsParts.push(contextStyled);

					let statsLeft = statsParts.join(" ");
					const model = ctx.model;
					const thinking = ctx.thinkingLevel;
					let right = model?.id ?? "no-model";
					if (model?.reasoning && thinking) {
						right = thinking === "off" ? `${right} • thinking off` : `${right} • ${thinking}`;
					}
					const providerCount = footerData.getAvailableProviderCount?.();
					if (typeof providerCount === "number" && providerCount > 1 && model?.provider) {
						right = `(${model.provider}) ${right}`;
					}
					let statsLeftWidth = visibleWidth(statsLeft);
					if (statsLeftWidth > width) {
						statsLeft = truncateToWidth(statsLeft, width, "...");
						statsLeftWidth = visibleWidth(statsLeft);
					}
					const rightWidth = visibleWidth(right);
					const minPadding = 2;
					let line2: string;
					if (statsLeftWidth + minPadding + rightWidth <= width) {
						const padding = " ".repeat(width - statsLeftWidth - rightWidth);
						line2 = theme.fg("dim", statsLeft) + padding + theme.fg("dim", right);
					} else {
						const available = width - statsLeftWidth - minPadding;
						const rightText = available > 0 ? truncateToWidth(right, available, "") : "";
						const padding = " ".repeat(Math.max(0, width - statsLeftWidth - visibleWidth(rightText)));
						line2 = theme.fg("dim", statsLeft) + padding + theme.fg("dim", rightText);
					}
					lines.push(line2);

					// Line 3 — extension statuses (setStatus), as the built-in does
					const statuses = footerData.getExtensionStatuses?.();
					if (statuses && statuses.size > 0) {
						const sorted = Array.from(statuses.entries())
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, text]) => text.replace(/[\r\n\t]+/g, " ").replace(/ +/g, " ").trim());
						lines.push(truncateToWidth(theme.fg("dim", sorted.join(" ")), width));
					}

					return lines;
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
		description: "Toggle footer-path ([machine] repo · branch + stats)",
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
