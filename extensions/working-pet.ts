/**
 * working-pet — replaces pi's braille "working" spinner with tiny 8-bit
 * pixel runners, or (big mode) a Chrome-dino stage above the prompt bar.
 *
 * BORDER PETS (default): compact 7-10px creatures running in place — dino,
 * mario-ish plumber, kaomoji jogger. Uses the SUPPORTED seam:
 * ctx.ui.setWorkingIndicator({ frames, intervalMs }) — no monkey-patching,
 * composes with status-align (the border renders whatever the indicator
 * emits). Sprites are 2 pixel-rows per text line via half-blocks (█ ▀ ▄).
 *
 * BIG MODE (`/working-pet big`): a small Chrome-style stage (8 text lines,
 * 12×10px dino) rendered as a widget above the prompt bar via
 * ctx.ui.setWidget(<component factory>). Monochrome — the terminal's own
 * foreground, zero ANSI — with the eye as a background hole, like the real
 * offline dino. The dino patrols the FULL width of the prompt bar (runs
 * right, flips, runs left) and hops the cactus at mid-field on every pass.
 * The widget exists only while pi is working (agent_start → agent_end); the
 * border indicator is reduced to the plain "working" message while it runs.
 *
 * PERFORMANCE: border-pet frames are built once at module load — the frame
 * tick and every streaming re-render just splice a prebuilt string. Cell
 * colors are run-length encoded (SGR emitted only on color changes, bg kept
 * alive across consecutive mixed cells and cleared before spaces / frame
 * end). Stage frames are built per tick and memoized per width.
 *
 * Applies on session_start (pi resets indicator options + clears widgets on
 * session switch). Commands:
 *   /working-pet            cycle: dino → mario → jogger → big → braille
 *   /working-pet dino|mario|jogger|big|braille
 */
import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionUIContext,
	WorkingIndicatorOptions,
} from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------- ANSI bits
const FG = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
const BG = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`;
const RST = "\x1b[39;49m";

// ---------------------------------------------------------------- palettes
const BODY = [134, 206, 115] as const; // chrome-dino green
const EYE = [26, 27, 38] as const; // near-bg dark
const CAP = [231, 76, 60] as const; // mario red
const DENIM = [69, 105, 224] as const; // overalls blue
const SKIN = [250, 197, 144] as const; // face/hands
const SHOE = [146, 104, 58] as const; // boots

// ---------------------------------------------------------------- pixel grid -> half-block line
type Cell = " " | "." | "B" | "E" | "R" | "D" | "S" | "H";
type RGB = readonly [number, number, number];
const PALETTE: Record<Exclude<Cell, " " | ".">, RGB> = {
	B: BODY, E: EYE, R: CAP, D: DENIM, S: SKIN, H: SHOE,
};

/**
 * Encode one pair of pixel rows into a text line: both set & same color →
 * █ · top only → ▀ · bottom only → ▄. SGR is emitted only when the cell's
 * color state actually changes (a terminal keeps fg/bg until told otherwise).
 * An active bg is legal across █ and mixed ▀ runs (hidden or overwritten)
 * but MUST be reset before spaces, fg-only half cells, and line end — or it
 * paints blocks over the border. '.' and ' ' are empty pixels; unknown
 * chars throw: a typo must not silently become a blank pixel.
 */
function encodePairLine(top: string, bottom: string): string {
	if (top.length !== bottom.length) {
		throw new Error(`working-pet: grid mismatch ${top.length} vs ${bottom.length}`);
	}
	let out = "";
	let fg: RGB | undefined; // currently active terminal fg
	let bg: RGB | undefined; // currently active terminal bg (undefined = default)
	for (let i = 0; i < bottom.length; i++) {
		const rawT = top[i] ?? " ";
		const rawB = bottom[i] ?? " ";
		const t = (rawT === "." ? " " : rawT) as Cell;
		const b = (rawB === "." ? " " : rawB) as Cell;
		if (t !== " " && !(t in PALETTE)) throw new Error(`working-pet: unknown grid char '${rawT}'`);
		if (b !== " " && !(b in PALETTE)) throw new Error(`working-pet: unknown grid char '${rawB}'`);
		const tc = t === " " ? undefined : PALETTE[t];
		const bc = b === " " ? undefined : PALETTE[b];
		if (tc && bc) {
			if (tc === bc) {
				if (fg !== tc) out += FG(...tc);
				out += "█"; // full block hides whatever bg is live
				fg = tc;
			} else {
				if (fg !== tc) out += FG(...tc);
				if (bg !== bc) out += BG(...bc);
				out += "▀";
				fg = tc;
				bg = bc;
			}
		} else if (tc || bc) {
			if (bg !== undefined) {
				out += RST; // half cell: stale bg would paint the empty half
				fg = undefined;
				bg = undefined;
			}
			const c = (tc ?? bc)!;
			if (fg !== c) out += FG(...c);
			out += tc ? "▀" : "▄";
			fg = c;
		} else {
			if (bg !== undefined) {
				out += RST; // a space on an active bg paints a block
				fg = undefined;
				bg = undefined;
			}
			out += " ";
		}
	}
	return out + RST; // always end clean: renderers append other content after
}

// ---------------------------------------------------------------- border pets
const DINO_TOPS = [" B   EBBBB", "  B  EBBBB"]; // tail flick
const DINO_LEGS = ["BBBBBBB.BB", "BBBBBB.BBB"]; // gap hops cols 7↔6
function dinoFrames(): string[] {
	const out: string[] = [];
	for (let f = 0; f < 4; f++) out.push(encodePairLine(DINO_TOPS[f % 2]!, DINO_LEGS[f % 2]!));
	return out;
}

const MAR_TOP = "RRSSESS";
const MAR_BOTS = ["DDDHHH.", "DDD.HHH"]; // boots swap sides = run in place
function marioFrames(): string[] {
	const out: string[] = [];
	for (let f = 0; f < 4; f++) out.push(encodePairLine(MAR_TOP, MAR_BOTS[f % 2]!));
	return out;
}

function joggerFrames(): string[] {
	return ["ᕕ( ᐛ )ᕗ", "ᕗ( ᐛ )ᕕ"].map((f) => FG(...BODY) + f + RST);
}

// ---------------------------------------------------------------- big: the Chrome stage (12×10px dino, 8 text lines)
const STAGE_H = 16;
type Grid = string[][];

// chrome dino, 12×10, faces right — authentic silhouette: blocky head with a
// background-hole eye near the top-back, jaw notch on the right, tail rising
// as a staircase to the left, tiny arm, two legs with feet pointing forward
const STAGE_DINO_A = [
	"......XXXXX.",
	"......X.XXXX",
	"......XXXXXX",
	"......XXXXX.",
	"X.....XXXXXX",
	"XX...XXXXXXX",
	"XXXXXXXXXXXX",
	".XXXXXXXXXXX",
	"..XX....XX..",
	"..XXX...XXXX",
];
const STAGE_DINO_B = [
	...STAGE_DINO_A.slice(0, 8),
	"...XX...XX..",
	"...XXXX..XXX",
];
const mirror = (rows: string[]) => rows.map((r) => [...r].reverse().join(""));
const STAGE_DINO_A_L = mirror(STAGE_DINO_A);
const STAGE_DINO_B_L = mirror(STAGE_DINO_B);
const CACTUS_SPRITE = ["B.", "BB", ".B"]; // 2×3
const GROUND_PAT = "BB B B BB B BBB B B"; // chrome dashed ground line
const HOP = [2, 3, 3, 2]; // 4-frame arc (palindrome, both directions read the same)

const clampW = (w: number) => Math.max(26, Math.min(w, 400));

function patrol(w: number): { T: number } {
	const D = (clampW(w) - 14) & ~1; // even travel distance: dx sweeps 1 .. 1+D (dino 12 wide)
	return { T: D / 2 }; // frames one-way at 2px/frame
}

function buildStageFrame(f: number, w: number): string[] {
	const width = clampW(w);
	const { T } = patrol(w);
	const g: Grid = Array.from({ length: STAGE_H }, () => Array<string>(width).fill("."));
	// ground: dashed line — the dino's feet sit right on top of it
	for (let x = 0; x < width; x++) {
		if (GROUND_PAT[x % GROUND_PAT.length] === "B") g[STAGE_H - 2]![x] = "B";
	}
	// patrol: run right across the bar, flip, run back — forever
	const leg = f % (2 * T);
	const goingRight = leg < T;
	const dx = goingRight ? 1 + 2 * leg : 1 + 2 * (2 * T - leg);
	// cactus sits at mid-field; hop as the head reaches it, either direction
	const cactC = Math.max(16, Math.min(Math.floor((width - 11) / 2), width - 19));
	for (let r = 0; r < CACTUS_SPRITE.length; r++) {
		for (let c = 0; c < CACTUS_SPRITE[r]!.length; c++) {
			if (CACTUS_SPRITE[r]![c] === "B") g[STAGE_H - 5 + r]![cactC + c] = "B";
		}
	}
	let dy = 0;
	if (goingRight) {
		const d = cactC - (dx + 11); // snout-to-cactus gap
		if (d >= -4 && d <= 2) dy = -HOP[Math.min(3, Math.max(0, Math.round((2 - d) / 2)))];
	} else {
		const d = dx - (cactC + 3); // front-to-cactus gap on the return pass
		if (d >= -4 && d <= 2) dy = -HOP[Math.min(3, Math.max(0, Math.round((2 - d) / 2)))];
	}
	const dino = goingRight ? ((f >> 1) & 1 ? STAGE_DINO_B : STAGE_DINO_A) : (f >> 1) & 1 ? STAGE_DINO_B_L : STAGE_DINO_A_L;
	for (let r = 0; r < dino.length; r++) {
		const y = 4 + dy + r;
		if (y < 0 || y >= STAGE_H) continue;
		for (let c = 0; c < 12; c++) {
			if (dino[r]![c] !== "." && dino[r]![c] !== " ") g[y]![dx + c] = dino[r]![c]!;
		}
	}
	const lines: string[] = [];
	for (let y = 0; y < STAGE_H; y += 2) {
		lines.push(encodePairLineMono(g[y]!.join(""), (g[y + 1] ?? g[y]!.map(() => ".").join(""))));
	}
	return lines;
}

/** Monochrome encoder: any non-empty pixel → block glyph in the terminal's own fg. Zero ANSI. */
function encodePairLineMono(top: string, bottom: string): string {
	if (top.length !== bottom.length) {
		throw new Error(`working-pet: grid mismatch ${top.length} vs ${bottom.length}`);
	}
	let out = "";
	for (let i = 0; i < bottom.length; i++) {
		const t = top[i] ?? " ";
		const b = bottom[i] ?? " ";
		const p = t !== " " && t !== ".";
		const q = b !== " " && b !== ".";
		out += p && q ? "█" : p ? "▀" : q ? "▄" : " ";
	}
	return out;
}

/** ANSI-aware clip: never cut an escape sequence, never leak colors past EOL. */
function clipLine(line: string, width: number): string {
	let out = "";
	let vis = 0;
	let i = 0;
	while (i < line.length) {
		if (line[i] === "\x1b") {
			const j = line.indexOf("m", i);
			if (j === -1) break;
			out += line.slice(i, j + 1);
			i = j + 1;
			continue;
		}
		if (vis >= width) break;
		out += line[i]!;
		vis++;
		i++;
	}
	return out.endsWith(RST) ? out : out + RST;
}

type StageComponent = {
	render(width: number): string[];
	invalidate(): void;
	dispose(): void;
};
type SetWidgetFn = ExtensionUIContext["setWidget"];
type WidgetFactory = Extract<Parameters<SetWidgetFn>[1], (...args: never[]) => unknown>;

function stageFactory(): WidgetFactory {
	return (tui, _theme) => {
		let f = 0;
		const cache = new Map<string, string[]>();
		const frame = (w: number): string[] => {
			const { T } = patrol(w);
			const k = `${w}:${f % (2 * T)}`;
			let hit = cache.get(k);
			if (!hit) {
				if (cache.size > 600) cache.clear();
				hit = buildStageFrame(f, w);
				cache.set(k, hit);
			}
			return hit;
		};
		const timer = setInterval(() => {
			f++;
			(tui as { requestRender(): void }).requestRender();
		}, 90);
		const component: StageComponent = {
			render(width: number) {
				return frame(Math.max(24, Math.min(width || 24, 400))).map((l) => clipLine(l, width));
			},
			invalidate() {},
			dispose() {
				clearInterval(timer);
			},
		};
		return component;
	};
}

// ---------------------------------------------------------------- pets + wiring
type PetName = "dino" | "mario" | "jogger" | "big" | "braille";
const PETS: Record<Exclude<PetName, "big">, WorkingIndicatorOptions | undefined> = {
	dino: { frames: dinoFrames(), intervalMs: 110 },
	mario: { frames: marioFrames(), intervalMs: 110 },
	jogger: { frames: joggerFrames(), intervalMs: 150 },
	braille: undefined, // pi default spinner
};
const CYCLE: PetName[] = ["dino", "mario", "jogger", "big", "braille"];
const STAGE_KEY = "working-pet-stage";

/** visible length (ANSI-safe) — mirrors status-align's width math. */
function visibleLen(s: string): number {
	return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

export default function (pi: ExtensionAPI) {
	let pet: PetName = "dino";
	let stageVisible = false;

	const showStage = (ctx: ExtensionContext) => {
		if (stageVisible) return;
		stageVisible = true;
		ctx.ui.setWidget(STAGE_KEY, stageFactory());
	};
	const hideStage = (ctx: ExtensionContext) => {
		if (!stageVisible) return;
		stageVisible = false;
		ctx.ui.setWidget(STAGE_KEY, undefined);
	};

	function apply(ctx: ExtensionContext) {
		if (pet === "big") {
			// border shows the plain working message; the stage above the prompt bar is the show
			ctx.ui.setWorkingIndicator({ frames: [] });
			return;
		}
		hideStage(ctx); // switching away from big mid-run
		const opts = PETS[pet];
		// sanity: every frame same visible width, or fall back to default spinner
		if (opts?.frames && new Set(opts.frames.map(visibleLen)).size > 1) {
			ctx.ui.notify("working-pet: inconsistent frame widths — using default spinner", "warning");
			ctx.ui.setWorkingIndicator(undefined);
			return;
		}
		ctx.ui.setWorkingIndicator(opts);
	}

	pi.on("session_start", async (_event, ctx) => {
		// pi resets indicator options + clears widgets on session switch — re-apply ours
		stageVisible = false; // pi already disposed/cleared the widget
		apply(ctx);
	});

	// big mode: the stage exists only while pi is working
	pi.on("agent_start", async (_event, ctx) => {
		if (pet === "big") showStage(ctx);
	});
	pi.on("agent_end", async (_event, ctx) => hideStage(ctx));
	pi.on("agent_settled", async (_event, ctx) => hideStage(ctx));

	pi.registerCommand("working-pet", {
		description: "Working indicator pet: dino, mario, jogger, big (stage), or braille (default)",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase() as PetName;
			if (arg && CYCLE.includes(arg)) {
				pet = arg;
			} else if (arg) {
				ctx.ui.notify(`working-pet: unknown pet '${args.trim()}' — use dino|mario|jogger|big|braille`, "error");
				return;
			} else {
				pet = CYCLE[(CYCLE.indexOf(pet) + 1) % CYCLE.length]!;
			}
			apply(ctx);
			ctx.ui.notify(
				pet === "big" ? "working-pet: big — stage above the prompt bar (next run)" : `working-pet: ${pet}`,
				"info",
			);
		},
	});
}
