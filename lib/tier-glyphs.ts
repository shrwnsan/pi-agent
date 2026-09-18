/**
 * Shared single-glyph tier helpers for pi-agent extensions (tps, thought-label).
 *
 * Convention (mirrors minimal-mode's tier idea, narrowed to one glyph):
 *   - "unicode" — default; renders everywhere (e.g. ⚡︎ / ☕︎ text presentation)
 *   - "nerd"    — Nerd Font glyph from the extension's own config (`nerdGlyph`);
 *                 falls back to the unicode glyph when unset
 *   - "ascii"   — no glyph (or an ASCII stand-in)
 *
 * Deliberately dependency-free and pi-import-free: this file is loaded by every
 * consuming extension, so keep the API tiny, pure, and stable. Config files stay
 * per-extension (each passes its own path) — no cross-extension config coupling.
 */
import { readFileSync } from "node:fs";

export type GlyphTier = "unicode" | "nerd" | "ascii";

export interface TierGlyphConfig {
	tier?: GlyphTier;
	nerdGlyph?: string;
	disabled?: boolean;
}

/** Safe JSON config read; returns {} on missing/corrupt file. */
export function loadTierConfig<T extends TierGlyphConfig>(configPath: string): Partial<T> {
	try {
		const raw: unknown = JSON.parse(readFileSync(configPath, "utf8"));
		return typeof raw === "object" && raw !== null ? (raw as Partial<T>) : {};
	} catch {
		return {};
	}
}

/** Resolve the display glyph for a tier config. nerd falls back to unicode. */
export function resolveTierGlyph(
	cfg: TierGlyphConfig,
	glyphs: { unicode: string; ascii?: string },
): string {
	const tier = cfg.tier ?? "unicode";
	if (tier === "ascii") return glyphs.ascii ?? "";
	if (tier === "nerd") return cfg.nerdGlyph || glyphs.unicode;
	return glyphs.unicode;
}
