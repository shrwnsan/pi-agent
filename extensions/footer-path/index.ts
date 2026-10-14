/**
 * Footer Path — minimal footer: `[machine] repo · branch (+N⎇ fleet)` + pi's stats line.
 *
 * Replaces pi's default footer (which starts with the absolute cwd) with a
 * compact two-line form:
 *
 *   [box] dotfiles · main · +2⑂                         ← line 1 (this extension)
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
 * Worktree fleet: linked worktrees of the same repo (from `git worktree list
 * --porcelain`, excluding the session's own) render as `+N⎇` after the branch.
 * Snapshot at session start, re-probed on branch-change events (not per render
 * — nothing subprocess-y in the render path); worktrees created mid-session
 * appear on the next branch change or `/footer-path` toggle. Disable with
 * `"worktrees": "off"` in ~/.pi/agent/footer-path.json.
 *
 * All probes (git + virtualization) run once at session start — nothing
 * subprocess-y in the render path. Branch updates come from
 * footerData.onBranchChange(). Toggle with /footer-path; set the glyph tier
 * (unicode | nerd | ascii, persisted to footer-path.json) with
 * /footer-path:icon.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type MachineContext = "container" | "remote" | "vm" | "wsl";
type GlyphTier = "unicode" | "nerd" | "ascii";
type MachineStyle = "tag" | "dot" | "glyph" | "none";
type WorktreeStyle = "count" | "active" | "off";

interface MachineInfo {
	label: string;
	context: MachineContext;
}

interface FooterPathConfig {
	machineStyle?: MachineStyle;
	glyphs?: GlyphTier;
	worktrees?: WorktreeStyle;
	/** Opt-in: append the session name (summary) to the footer chain. Default false. */
	showSessionName?: boolean;
}

const MACHINE_STYLES: MachineStyle[] = ["tag", "dot", "glyph", "none"];
const GLYPH_TIERS: GlyphTier[] = ["unicode", "nerd", "ascii"];
const WORKTREE_STYLES: WorktreeStyle[] = ["count", "active", "off"];

// Font Awesome 4 PUA codepoints — \u escapes keep the source font-proof.
const NERD_MACHINE_ICONS: Record<MachineContext, string> = {
	container: "\uf1b2", // cube
	remote: "\uf233", // server
	vm: "\uf108", // desktop
	wsl: "\uf17c", // linux/tux
};
const UNICODE_MACHINE_GLYPH = "▣"; // near-universal: DejaVu/Menlo/Segoe fallback
const UNICODE_WORKTREE_GLYPH = "⑂"; // OCR fork — the tree itself
const NERD_WORKTREE_GLYPH = "\uf126"; // Font Awesome 4 code-fork
const UNICODE_BRANCH_GLYPH = "⎇"; // U+2387 branch symbol, widely cached
const NERD_BRANCH_GLYPH = "\uf418"; // git-branch
const ACTIVE_BADGE_GLYPH = "⚑"; // U+2691 — "git moved here most recently"

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

function gitInfo(cwd: string): {
	repo: string;
	worktree: string | null;
	toplevel: string | null;
	commonDir: string | null;
} {
	const parts = {
		repo: basename(cwd),
		worktree: null as string | null,
		toplevel: null as string | null,
		commonDir: null as string | null,
	};
	try {
		const run = (args: string[]): string => {
			const result = spawnSync("git", args, { cwd, encoding: "utf8" });
			return result.status === 0 ? (result.stdout?.trim() ?? "") : "";
		};
		const toplevel = run(["rev-parse", "--show-toplevel"]);
		if (!toplevel) return parts; // not a git repo — keep folder name
		parts.toplevel = toplevel;
		parts.repo = basename(toplevel);
		const gitDir = resolve(cwd, run(["rev-parse", "--absolute-git-dir"]));
		const commonDir = resolve(cwd, run(["rev-parse", "--git-common-dir"]));
		// git canonicalizes its outputs (macOS /var → /private/var) while
		// resolve() builds from the raw cwd — compare real paths, or every
		// root session on a symlinked tmp looks like a worktree named ".git"
		let realGitDir = gitDir;
		let realCommonDir = commonDir;
		try {
			realGitDir = realpathSync(gitDir);
			realCommonDir = realpathSync(commonDir);
		} catch {
			// vanished mid-probe — string compare is the fallback
		}
		parts.commonDir = realCommonDir || null;
		if (gitDir && commonDir && realGitDir !== realCommonDir) {
			const marker = `${sep}.worktrees${sep}`;
			const idx = cwd.lastIndexOf(marker);
			parts.worktree = idx !== -1 ? cwd.slice(idx + marker.length).split(sep)[0] : basename(gitDir);
		}
	} catch {
		// git missing or unavailable — folder name is fine
	}
	return parts;
}

interface WorktreeEntry {
	path: string;
	dir: string;
	branch: string;
}

/**
 * The repo's OTHER linked worktrees — `git worktree list --porcelain`,
 * excluding the session's own toplevel, bare entries, and detached HEADs
 * (no branch to name). [] on any probe failure.
 */
function worktreeList(toplevel: string | null): WorktreeEntry[] {
	if (!toplevel) return [];
	try {
		const result = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: toplevel, encoding: "utf8" });
		if (result.status !== 0) return [];
		const list: WorktreeEntry[] = [];
		let path = "";
		let isBare = false;
		let branch: string | null = null;
		const flush = (): void => {
			if (path && !isBare && branch && resolve(path) !== resolve(toplevel)) {
				list.push({ path, dir: basename(path), branch });
			}
			path = "";
			isBare = false;
			branch = null;
		};
		for (const line of (result.stdout ?? "").split("\n")) {
			if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
			else if (line === "bare") isBare = true;
			else if (line === "detached") branch = null;
			else if (line.startsWith("branch ")) branch = line.slice("branch refs/heads/".length);
			else if (line === "") flush();
		}
		flush();
		return list;
	} catch {
		return [];
	}
}

/**
 * The "git moved here" signal: mtime of the worktree's reflog (commits,
 * checkouts, resets, merges append) and index (staging) — verified on
 * macOS: HEAD itself does NOT move on commit. 0 = nothing measurable.
 */
function worktreeActivity(path: string): number {
	try {
		const pointer = readFileSync(join(path, ".git"), "utf8").trim();
		const gitDir = pointer.startsWith("gitdir:") ? resolve(path, pointer.slice("gitdir:".length).trim()) : "";
		if (!gitDir) return 0;
		let latest = 0;
		for (const file of ["logs/HEAD", "index"]) {
			try {
				latest = Math.max(latest, statSync(join(gitDir, file)).mtimeMs);
			} catch {
				// absent file — skip
			}
		}
		return latest;
	} catch {
		return 0;
	}
}

function mostRecentlyActive(list: WorktreeEntry[]): WorktreeEntry | null {
	let best: WorktreeEntry | null = null;
	let bestTime = -1;
	for (const entry of list) {
		const time = worktreeActivity(entry.path);
		if (time > bestTime) {
			bestTime = time;
			best = entry;
		}
	}
	return bestTime > 0 ? best : null;
}

function fleetCountLabel(count: number, tier: GlyphTier): string {
	const glyph = tier === "nerd" ? NERD_WORKTREE_GLYPH : tier === "ascii" ? "wt" : UNICODE_WORKTREE_GLYPH;
	return `+${count}${glyph}`;
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
		const worktreeStyle = configValue(config.worktrees, WORKTREE_STYLES, "count");
		const machine = style === "none" ? null : machineLabel();
		const parts = gitInfo(ctx.cwd);
		let fleet: WorktreeEntry[] = worktreeStyle === "off" ? [] : worktreeList(parts.toplevel);
		let active: WorktreeEntry | null =
			worktreeStyle === "active" ? mostRecentlyActive(fleet) : null;
		let watcher: FSWatcher | null = null;
		const reprobe = (): void => {
			if (worktreeStyle === "off") return;
			try {
				fleet = worktreeList(parts.toplevel);
				active = worktreeStyle === "active" ? mostRecentlyActive(fleet) : null;
			} catch {
				// keep previous snapshot
			}
		};

		const machineSegment = (theme: Theme): string | null => {
			if (!machine) return null;
			if (style === "tag") return theme.fg("muted", `[${machine.label}]`);
			if (style === "dot") return theme.fg("dim", machine.label);
			const icon =
				tier === "nerd" ? NERD_MACHINE_ICONS[machine.context] : tier === "ascii" ? "" : UNICODE_MACHINE_GLYPH;
			return theme.fg("dim", icon ? `${icon} ${machine.label}` : machine.label);
		};

		ctx.ui.setFooter((tui, theme, footerData) => {
			// Fleet + activity refresh — the root branch rarely changes in an
			// all-worktrees workflow, so a filesystem watch on git's worktree
			// metadata (commits/checkouts/staging append to per-worktree reflog
			// + index) is what keeps the snapshot honest. Debounced; on watch
			// failure the session-start snapshot stays.
			let debounce: ReturnType<typeof setTimeout> | null = null;
			let disposed = false;
			const scheduleReprobe = (): void => {
				if (disposed) return;
				if (debounce) clearTimeout(debounce);
				debounce = setTimeout(() => {
					debounce = null;
					if (disposed) return;
					reprobe();
					tui.requestRender();
				}, 300);
			};
			// FSEvents recursive watches can miss newly CREATED subdirs (git
			// worktree add), so a slow reconcile bounds that blind spot.
			let reconcile: ReturnType<typeof setInterval> | null = null;
			if (worktreeStyle !== "off" && parts.toplevel) {
				reconcile = setInterval(() => {
					if (!disposed) {
						reprobe();
						tui.requestRender();
					}
				}, 30_000);
			}
			if (worktreeStyle !== "off" && parts.commonDir) {
				try {
					const wtMetaDir = join(parts.commonDir, "worktrees");
					if (existsSync(wtMetaDir)) {
						watcher = watch(wtMetaDir, { recursive: true }, scheduleReprobe);
						watcher.on("error", () => {}); // snapshot stays
					}
				} catch {
					// no watch — snapshot from session start
				}
			}
			const unsubscribe = footerData.onBranchChange(() => {
				reprobe();
				tui.requestRender();
			});
			return {
				dispose: () => {
					disposed = true;
					if (debounce) clearTimeout(debounce);
					clearInterval(reconcile);
					watcher?.close();
					unsubscribe();
				},
				invalidate() {},
				render(width: number): string[] {
					const branch = footerData.getGitBranch();

					// Line 1 — compact path. Root branch stays bare (clean); a
					// worktree session wears the worktree glyph and collapses to
					// one segment when dir name and branch name match.
					const chain: string[] = [parts.repo];
					const wtPrefix = tier === "nerd" ? NERD_WORKTREE_GLYPH : tier === "ascii" ? "wt:" : UNICODE_WORKTREE_GLYPH;
					const brPrefix = tier === "nerd" ? NERD_BRANCH_GLYPH : tier === "ascii" ? "br:" : UNICODE_BRANCH_GLYPH;
					const branchIsDir =
						!!branch && !!parts.worktree && (branch === parts.worktree || branch.replace(/\//g, "-") === parts.worktree);
					if (parts.worktree) {
						if (branchIsDir) {
							chain.push(theme.fg("accent", `${wtPrefix}${branch}`));
						} else {
							chain.push(theme.fg("muted", `${wtPrefix}${parts.worktree}`));
							if (branch) chain.push(theme.fg("accent", `${brPrefix}${branch}`));
						}
					} else if (branch) {
						chain.push(theme.fg("accent", branch));
					}
					const getSessionName = (ctx.sessionManager as { getSessionName?: () => string | undefined })
						.getSessionName;
					const sessionName = config.showSessionName === true ? getSessionName?.call(ctx.sessionManager) : undefined;
					if (sessionName) chain.push(theme.fg("muted", sessionName));
					if (active && worktreeStyle === "active") {
						const badge = tier === "ascii" ? `act:${active.dir}` : `${ACTIVE_BADGE_GLYPH}${active.dir}`;
						chain.push(theme.fg("muted", badge));
					}
					if (fleet.length > 0) chain.push(theme.fg("muted", fleetCountLabel(fleet.length, tier)));
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

	pi.registerCommand("footer-path:icon", {
		description: "Glyph tier: unicode | nerd | ascii (no args cycles)",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;
			const raw = (Array.isArray(args) ? args.join(" ") : args) ?? "";
			const arg = raw.trim().toLowerCase().split(/\s+/)[0];
			const config = loadConfig();
			let tier: GlyphTier;
			if (arg) {
				if (!(GLYPH_TIERS as string[]).includes(arg)) {
					ctx.ui.notify(`footer-path:icon — unknown tier '${arg}'. Tiers: ${GLYPH_TIERS.join(", ")}`, "error");
					return;
				}
				tier = arg as GlyphTier;
			} else {
				// cycle unicode → nerd → ascii → … from the current tier
				tier = GLYPH_TIERS[(GLYPH_TIERS.indexOf(resolveTier(config)) + 1) % GLYPH_TIERS.length];
			}
			// persist: merge into footer-path.json, never clobber other keys
			try {
				const cfgPath = join(process.env.HOME ?? "~", ".pi", "agent", "footer-path.json");
				let existing: Record<string, unknown> = {};
				try {
					const parsed: unknown = JSON.parse(readFileSync(cfgPath, "utf8"));
					if (typeof parsed === "object" && parsed !== null) existing = parsed as Record<string, unknown>;
				} catch {
					// fresh file
				}
				existing.glyphs = tier;
				mkdirSync(dirname(cfgPath), { recursive: true });
				writeFileSync(cfgPath, JSON.stringify(existing, null, 2) + "\n");
			} catch {
				ctx.ui.notify("footer-path:icon — could not write footer-path.json", "error");
				return;
			}
			if (enabled) install(ctx); // re-resolve tier, re-render
			const explicitEnv = (process.env.PI_GLYPHS ?? "").toLowerCase();
			const envOverride =
				(explicitEnv && (GLYPH_TIERS as string[]).includes(explicitEnv)) ||
				["1", "true"].includes((process.env.NERD_FONT ?? "").toLowerCase());
			const sample =
				tier === "nerd" ? `+1${NERD_WORKTREE_GLYPH}` : tier === "ascii" ? "+1wt" : `+1${UNICODE_WORKTREE_GLYPH}`;
			ctx.ui.notify(
				`footer-path icon tier: ${tier} — fleet renders like ${sample}` +
					(envOverride ? " (note: PI_GLYPHS/NERD_FONT env overrides config)" : ""),
			);
		},
	});
}
