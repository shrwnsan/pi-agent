/**
 * status-align — moves pi's embedded "Working" spinner/status from the LEFT
 * of the editor's top border to the RIGHT. VERSION-LOCKED to pi 0.85.x.
 *
 * WHY A SEPARATE EXTENSION: the working indicator lives on CustomEditor
 * (editor border), not on AssistantMessageComponent (thought-label's seam).
 * Different component, different version surface, own kill switch.
 *
 * MECHANISM: wrap CustomEditor.prototype.renderTopBorder with a mirrored
 * composition — `── ` cap, dash fill, the status right-aligned before a
 * ` ──` cap. Overflow label ("↑ N more") renders after the left cap when
 * space allows; falls back to pi's spinner-only branch when narrow. All
 * composition mirrors pi 0.85.1 custom-editor.js renderTopBorder math.
 *
 * SELF-DISABLING: capability-probes (renderTopBorder + setWorkingStatusIndicator
 * on CustomEditor.prototype); any mismatch → one-time notice, stock border.
 *
 * Config: none. Toggle in-session: /status-align
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";

function visibleLen(s: string): number {
	return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").length;
}

export default function (pi: ExtensionAPI) {
	let enabled = true;
	let installed = false;
	let installNote = "";

	function install(): boolean {
		try {
			const proto = CustomEditor.prototype as any;
			if (typeof proto.renderTopBorder !== "function" || typeof proto.setWorkingStatusIndicator !== "function") {
				installNote = "status-align: CustomEditor seam missing — disabled";
				return false;
			}
			if ((proto.renderTopBorder as any).__statusAlignPatch) return true; // idempotent reload
			const orig = proto.renderTopBorder as (this: any, width: number, hiddenLineCount: number) => string;

			const wrapped = function (this: any, width: number, hiddenLineCount: number): string {
				if (!enabled) return orig.call(this, width, hiddenLineCount);
				try {
					if (!this.embedWorkingStatus || !this.workingStatusIndicator || width <= 0) {
						return orig.call(this, width, hiddenLineCount);
					}
					const rightCap = " ──";
					const leftCap = "── ";
					let status = this.workingStatusIndicator.renderInBorder(Math.max(1, width - 5));
					let statusWidth = visibleLen(status);
					if (statusWidth === 0) return orig.call(this, width, hiddenLineCount);

					const overflowLabel = hiddenLineCount > 0 ? ` ↑ ${hiddenLineCount} more ` : undefined;
					const overflowW = overflowLabel ? visibleLen(overflowLabel) : 0;
					// fixed = leftCap(3) + gap(1) + status + rightCap(3)
					const fixed = leftCap.length + 1 + statusWidth + rightCap.length;

					if (overflowLabel && fixed + overflowW <= width) {
						const fill = width - fixed - overflowW;
						return (
							this.borderColor(leftCap) +
							this.borderColor(overflowLabel) +
							this.borderColor("─".repeat(fill)) +
							status +
							this.borderColor(rightCap)
						);
					}
					if (fixed <= width) {
						const fill = width - fixed;
						return (
							this.borderColor(leftCap) +
							this.borderColor("─".repeat(fill)) +
							status +
							this.borderColor(rightCap)
						);
					}
					// Too narrow for the full label: pi's spinner-only branch, right-aligned.
					status = this.workingStatusIndicator.renderSpinnerInBorder(Math.max(1, width - rightCap.length - 1));
					statusWidth = visibleLen(status);
					const prefixW = Math.min(3, Math.max(0, width - statusWidth - rightCap.length));
					return (
						this.borderColor("─".repeat(prefixW)) +
						status +
						this.borderColor("─".repeat(Math.max(0, width - prefixW - statusWidth)) + rightCap)
					);
				} catch {
					return orig.call(this, width, hiddenLineCount);
				}
			} as any;
			wrapped.__statusAlignPatch = true; // reload idempotency marker
			proto.renderTopBorder = wrapped;
			return true;
		} catch (error) {
			installNote = `status-align: install failed (${error instanceof Error ? error.message : String(error)}) — disabled`;
			return false;
		}
	}

	// Install at extension-load time — the editor exists before session events.
	installed = install();

	pi.on("session_start", async (_event, ctx) => {
		if (!installed) installed = install();
		if (!installed && ctx.hasUI && installNote) ctx.ui.notify(installNote, "warning");
	});

	pi.registerCommand("status-align", {
		description: "Toggle right-aligned working status",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			if (!installed) installed = install();
			ctx.ui.notify(`status-align ${enabled ? "enabled" : "disabled"} · patched:${installed}`, "info");
		},
	});
}
