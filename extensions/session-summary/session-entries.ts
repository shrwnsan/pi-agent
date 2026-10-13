/**
 * session-entries — minimal structural types for pi session branch entries,
 * shared by session-summary's summarizer and decision gate. Structural on
 * purpose: pi's real types drift across releases, and both consumers only
 * read a few known fields defensively.
 *
 * Part of the session-summary pi-agent fork (origin: pasky/pi-session-summary, MIT).
 */

export interface ContentBlock {
	type?: string;
	text?: string;
	name?: string;
	arguments?: Record<string, unknown>;
}

export interface SessionEntry {
	type: string;
	message?: {
		role?: string;
		content?: unknown;
		toolName?: string;
		toolCallId?: string;
		isError?: boolean;
	};
}
