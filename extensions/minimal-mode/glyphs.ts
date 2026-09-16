/**
 * Glyph resolution for minimal-mode.
 *
 * Tiers (safest first):
 * - `unicode` (default): single-width glyphs that ship in pi's own TUI — safe on
 *   Linux/WSL/Windows/macOS default monospace font stacks.
 * - `nerd`: Nerd Font PUA glyphs — prettier, but renders as tofu on terminals
 *   without a Nerd Font. Opt-in only; we never guess upward.
 * - `ascii`: bulletproof fallback for dumb terminals.
 *
 * Resolution order:
 *   1. `PI_GLYPHS` env var ("nerd" | "unicode" | "ascii")
 *   2. `NERD_FONT` env var ("1"/"true" → nerd)
 *   3. `"glyphs"` key in ~/.pi/agent/minimal-mode.json
 *   4. unicode
 *
 * The failure mode we design around: unicode glyphs on a Nerd Font terminal
 * look fine, but nerd glyphs on a plain terminal render as tofu boxes.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface GlyphSet {
	/** success marker */
	check: string;
	/** failure marker */
	fail: string;
	/** collapsed disclosure */
	collapsed: string;
	/** expanded disclosure */
	expanded: string;
	/** count/summary arrow */
	arrow: string;
	/** truncation ellipsis */
	ellipsis: string;
}

export const GLYPH_KEYS = ["check", "fail", "collapsed", "expanded", "arrow", "ellipsis"] as const;
export type GlyphKey = (typeof GLYPH_KEYS)[number];

export type GlyphTier = "unicode" | "nerd" | "ascii";

const UNICODE: GlyphSet = {
	check: "✓",
	fail: "✗",
	collapsed: "▸",
	expanded: "▾",
	arrow: "→",
	ellipsis: "…",
};

// Font Awesome PUA codepoints — \u escapes keep the source font-proof.
const NERD: GlyphSet = {
	check: "\uf00c",
	fail: "\uf00d",
	collapsed: "\uf054",
	expanded: "\uf078",
	arrow: "→",
	ellipsis: "…",
};

const ASCII: GlyphSet = {
	check: "ok",
	fail: "x",
	collapsed: ">",
	expanded: "v",
	arrow: "->",
	ellipsis: "...",
};

export interface MinimalModeConfig {
	/** Glyph tier: "unicode" (default) | "nerd" | "ascii" */
	glyphs?: GlyphTier;
	/** Per-glyph surgical overrides on top of the resolved tier */
	overrides?: Partial<GlyphSet>;
	/** Keep a preview of bash output under the collapsed status line. */
	bashPreview?: boolean;
	/** Label for hidden thinking blocks (default: "Thinking… ▸"). */
	thinkingLabel?: string;
}

const CONFIG_PATH = join(homedir(), ".pi", "agent", "minimal-mode.json");

export function loadConfig(): MinimalModeConfig {
	try {
		const parsed: unknown = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
		if (typeof parsed !== "object" || parsed === null) return {};
		return parsed as MinimalModeConfig;
	} catch {
		return {};
	}
}

function tierFromEnv(): GlyphTier | undefined {
	const explicit = process.env.PI_GLYPHS?.toLowerCase();
	if (explicit === "nerd" || explicit === "unicode" || explicit === "ascii") return explicit;
	const nerd = process.env.NERD_FONT?.toLowerCase();
	if (nerd === "1" || nerd === "true") return "nerd";
	return undefined;
}

function isGlyphTier(value: unknown): value is GlyphTier {
	return value === "unicode" || value === "nerd" || value === "ascii";
}

export function resolveGlyphs(config: MinimalModeConfig): GlyphSet {
	let tier: GlyphTier | undefined = tierFromEnv() ?? config.glyphs;
	if (!isGlyphTier(tier)) tier = "unicode";
	const base: GlyphSet = { ...UNICODE, ...(tier === "nerd" ? NERD : tier === "ascii" ? ASCII : {}) };
	if (config.overrides) {
		for (const key of GLYPH_KEYS) {
			const value = config.overrides[key];
			if (typeof value === "string" && value.length > 0) base[key] = value;
		}
	}
	return base;
}
