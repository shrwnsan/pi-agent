/**
 * zai-search — registers the `zai_web_search` tool: live web search through
 * Z.AI's remote Web Search MCP server (web_search_prime), billed against the
 * GLM Coding Plan search quota. Zero MCP setup — the MCP JSON-RPC handshake
 * is spoken directly over fetch (see ./zai-client.ts, lifted from
 * @estebanforge/pi-glm-tweaks, MIT).
 *
 * Key resolution (same as the zai provider): /login auth storage, models.json
 * apiKey, or the ZAI_API_KEY env var. Works with ANY model — not just GLM —
 * and pairs with pi-subagents' researcher/evidence-auditor children (list
 * `zai_web_search` in their `tools:` frontmatter).
 *
 * Status: /zai-search
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { ZaiMcpSearchClient, ZAI_SEARCH_ENDPOINT, type ZaiSearchResult, type ZaiWebSearchArgs } from "./zai-client.ts";

const PROVIDER = "zai";

// Searches take a few seconds; 45s covers the slow tail (contentSize=high)
// while still failing visibly on a hung connection.
const SEARCH_TIMEOUT_MS = 45_000;

/** Combine the tool's cancellation signal with a hard timeout. */
function withSearchTimeout(signal: AbortSignal | undefined): AbortSignal {
	const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Resolve the Z.AI API key. Prefers pi's auth storage (same resolution as the
 * provider), then the raw env var. Throws visibly when nothing is configured
 * — a missing key must fail the call, not return an empty result set.
 */
async function resolveZaiApiKey(ctx: {
	modelRegistry: { getApiKeyForProvider: (provider: string) => Promise<string | undefined> };
}): Promise<string> {
	try {
		const key = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER);
		if (key) return key;
	} catch {
		// Provider not configured — fall through to the env var.
	}
	const envKey = process.env.ZAI_API_KEY;
	if (envKey) return envKey;
	throw new Error(
		"zai_web_search: no Z.AI API key found. Configure zai auth (/login, ZAI_API_KEY, or models.json apiKey).",
	);
}

function formatSearchResults(query: string, results: ZaiSearchResult[]): string {
	if (results.length === 0) return `No web results for "${query}".`;
	const lines = results.map(
		(r, i) => `${i + 1}. ${r.title}\n   ${r.link}\n   ${r.content.replace(/\s+/g, " ").trim()}`,
	);
	return `Web results for "${query}":\n\n${lines.join("\n\n")}`;
}

export default function (pi: ExtensionAPI) {
	// One client per factory load: the MCP session survives across calls
	// within it. /reload re-runs the factory in the same process; the old
	// session is intentionally not torn down — the server-side TTL reaps it.
	const searchClient = new ZaiMcpSearchClient();

	pi.registerTool({
		name: "zai_web_search",
		label: "Z.AI Web Search",
		description:
			"Search the live web via Z.AI (web_search_prime). Returns ~10 results: page title, URL, and a content summary. Params: query (keep under ~70 chars); recency (oneDay|oneWeek|oneMonth|oneYear|noLimit, default noLimit); domain (restrict to one domain, e.g. docs.z.ai); contentSize (medium ~400-600 words/result, high ~2500); location (cn|us result region). Uses the GLM Coding Plan search quota.",
		promptSnippet: "Search the live web via Z.AI (zai_web_search)",
		promptGuidelines: [
			"Use zai_web_search for live web lookups (current events, library docs, facts you cannot verify locally). One focused query per topic; refine only if the results miss.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Search query. Keep under ~70 characters for best results." }),
			recency: Type.Optional(
				StringEnum(["oneDay", "oneWeek", "oneMonth", "oneYear", "noLimit"] as const, {
					description: "Time range of results. noLimit is the default.",
				}),
			),
			domain: Type.Optional(
				Type.String({ description: "Restrict results to one domain, e.g. docs.z.ai or github.com." }),
			),
			contentSize: Type.Optional(
				StringEnum(["medium", "high"] as const, {
					description: "Summary length per result: medium (~400-600 words, default) or high (~2500 words, higher quota cost).",
				}),
			),
			location: Type.Optional(
				StringEnum(["cn", "us"] as const, {
					description: "Result region: cn (Chinese, server default) or us (non-Chinese).",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const apiKey = await resolveZaiApiKey(ctx);
			// Only defined optionals are sent — the server schema is
			// additionalProperties:false, and empty strings change behavior.
			const args: ZaiWebSearchArgs = { search_query: params.query };
			if (params.recency) args.search_recency_filter = params.recency;
			if (params.domain) args.search_domain_filter = params.domain;
			if (params.contentSize) args.content_size = params.contentSize;
			if (params.location) args.location = params.location;

			const results = await searchClient.search(args, {
				apiKey,
				signal: withSearchTimeout(signal),
			});
			return {
				content: [{ type: "text", text: formatSearchResults(params.query, results) }],
				details: { query: params.query, count: results.length, links: results.map((r) => r.link) },
			};
		},
	});

	pi.registerCommand("zai-search", {
		description: "Z.AI web search status",
		handler: async (_args, ctx) => {
			let key = false;
			try {
				key = !!(await resolveZaiApiKey(ctx));
			} catch {
				key = false;
			}
			ctx.ui.notify(
				`zai-search: ${key ? "API key resolved ✓" : "no Z.AI API key (ZAI_API_KEY, /login, or models.json)"} · zai_web_search registered · ${ZAI_SEARCH_ENDPOINT}`,
				"info",
			);
		},
	});
}
