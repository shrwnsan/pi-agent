/**
 * Headless verification probe for session-summary.
 *
 * This is the reference implementation of the package's pre-push ritual
 * (see AGENTS.md: "verify before pushing ... the jiti + shimmed-component
 * pattern"). It loads the extension through jiti with stubbed host modules,
 * so it exercises real extension logic against a simulated pi session:
 * no network, no real API keys, no conversation content.
 *
 * Run from anywhere:
 *
 *   node extensions/session-summary/probe.mjs
 *
 * Exits 0 when every check passes, 1 otherwise.
 *
 * If jiti cannot be found in a pi installation, set PI_CODING_AGENT_DIR to
 * the pi-coding-agent package directory and rerun.
 *
 * Scope note: this is a logic-regression probe. It validates extension
 * behavior against stubbed host behavior. Changes that only appear in real
 * terminal rendering still need a TUI eyeball pass.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import * as piAi from "./probe/stubs/stub-pi-ai.mjs";
import * as piAgent from "./probe/stubs/stub-pi-agent.mjs";

/** Locate jiti inside an installed pi-coding-agent package. */
function findJiti() {
	const override = process.env.PI_CODING_AGENT_DIR;
	if (override) {
		const p = join(override, "node_modules", "jiti", "lib", "jiti.mjs");
		if (existsSync(p)) return p;
		throw new Error(`PI_CODING_AGENT_DIR=${override} has no node_modules/jiti/lib/jiti.mjs`);
	}
	const roots = [
		[homedir(), ".local/share/fnm/node-versions"],
		[homedir(), ".nvm/versions/node"],
		["", "usr/local/lib/node_modules"],
		["", "opt/homebrew/lib/node_modules"],
	];
	const layouts = ["installation/lib/node_modules", "lib/node_modules"];
	for (const [base, dir] of roots) {
		const root = base ? join(homedir(), dir) : "/" + dir;
		if (!existsSync(root)) continue;
		let versions;
		try {
			versions = require("node:fs").readdirSync(root);
		} catch {
			continue;
		}
		for (const v of versions) {
			for (const layout of layouts) {
				const p = join(root, v, layout, "@earendil-works", "pi-coding-agent", "node_modules", "jiti", "lib", "jiti.mjs");
				if (existsSync(p)) return p;
			}
		}
	}
	throw new Error("Could not find jiti in any pi-coding-agent install. Set PI_CODING_AGENT_DIR to the pi-coding-agent package directory.");
}

const require = createRequire(import.meta.url);
const { createJiti } = await import("file://" + findJiti());

const HERE = new URL(".", import.meta.url).pathname;
const ROOT = mkdtempSync(join(tmpdir(), "session-summary-probe-"));
const AGENT_DIR = join(ROOT, "agent");
const PROJ = join(ROOT, "proj");
mkdirSync(join(AGENT_DIR, "session-summary"), { recursive: true });
mkdirSync(join(PROJ, ".pi"), { recursive: true });
piAgent.__setAgentDir(AGENT_DIR);
// Gate keys must not leak in from the operator shell. Gate availability is per test.
for (const k of ["LIQUID_API_KEY", "TYPESAFE_API_KEY", "AI_GATEWAY_API_KEY"]) delete process.env[k];

const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": new URL("./probe/stubs/stub-pi-agent.mjs", import.meta.url).pathname,
		"@earendil-works/pi-ai": new URL("./probe/stubs/stub-pi-ai.mjs", import.meta.url).pathname,
	},
});
const mod = await jiti.import(new URL("./index.ts", import.meta.url).pathname);
const extension = mod.default ?? mod;

// -- Harness ---------------------------------------------------------------

let pass = 0, fail = 0;
function ok(cond, name, extra = "") {
	if (cond) { pass++; console.log(`  ✓ ${name}`); }
	else { fail++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`); }
}
const tick = () => new Promise((r) => setTimeout(r, 30));

function makeHarness({ mode = "tui", branch = [] } = {}) {
	const handlers = {};
	const commands = {};
	const notifications = [];
	const widgets = [];
	const h = {
		modelMeta: null,   // optional thinkingLevelMap merged into registry.find results
		handlers, commands, notifications, widgets,
		llmCalls: () => piAi.__calls.length,
		pi: {
			_sessionName: "",
			getSessionName() { return this._sessionName; },
			setSessionName(name) {
				this._sessionName = name;
				// Mimic host: setSessionName emits session_info_changed synchronously.
				for (const fn of handlers["session_info_changed"] ?? []) fn({ type: "session_info_changed", name }, h.ctx);
			},
			on(event, fn) { (handlers[event] ??= []).push(fn); },
			registerCommand(name, opts) { commands[name] = opts; },
		},
	};
	h.ctx = {
		cwd: PROJ,
		mode,
		hasUI: true,
		ui: {
			notify: (msg, lvl) => notifications.push({ msg, lvl }),
			setWidget: (id, lines) => widgets.push({ id, lines }),
		},
		sessionManager: {
			getBranch: () => branch,
			getSessionId: () => "sess-probe-001",
			getSessionName: () => h.pi._sessionName,
		},
		modelRegistry: {
			getAvailable: () => [{ provider: "openai", id: "gpt-5.4-nano" }],
			find: (provider, id) => ({ provider, id, ...(h.modelMeta ?? {}) }),
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "probe-key", headers: {} }),
		},
		model: { provider: "testprov", id: "testmodel" },
	};
	extension(h.pi);
	return h;
}

const CFG = join(AGENT_DIR, "session-summary.json");
const writeConfig = (cfg) => writeFileSync(CFG, JSON.stringify(cfg));
const msgEntry = (role, text) => ({ type: "message", message: { role, content: [{ type: "text", text }] } });
async function fire(h, event) {
	for (const fn of h.handlers[event] ?? []) await fn({ type: event }, h.ctx);
	await tick();
}
const agentEnd = (h) => fire(h, "agent_end");
const startSession = (h) => fire(h, "session_start");

const GLOBAL_LOG = join(AGENT_DIR, "session-summary", "usage.jsonl");

// == 1. Config layering ======================================================
console.log("\n[1] config layering");
{
	piAi.__reset();
	writeConfig({
		debounceSeconds: 0,
		decisionGate: {
			providers: ["liquid", "custom"],
			specs: { custom: { type: "chat", url: "https://custom.example/v1/chat", model: "c1", apiKeyEnv: "CUSTOM_API_KEY" } },
		},
	});
	writeFileSync(join(PROJ, ".pi", "session-summary.json"), JSON.stringify({ debugWidget: false }));
	const h = makeHarness({ branch: [msgEntry("user", "hello world")] });
	await startSession(h);
	await h.commands["summary:gate"].handler("", h.ctx);
	const joined = h.notifications.map((n) => n.msg).join("\n");
	ok(joined.includes("custom: no key (CUSTOM_API_KEY)"), "global custom spec survives project file without gate key");
	ok(joined.includes("liquid:"), "preset provider still listed");
	ok(h.notifications.filter((n) => n.msg.includes("[gate]")).length === 1, "gate status is ONE notify");
	rmSync(join(PROJ, ".pi", "session-summary.json"));
}

// == 2. Sanitizer parity =====================================================
console.log("\n[2] sanitizer parity");
{
	piAi.__reset();
	writeConfig({ debounceSeconds: 0 });
	const branch = [msgEntry("user", "fix the auth flows")];
	const h = makeHarness({ branch });
	await startSession(h);
	piAi.__setResponder(() => ({ stopReason: "stop", content: [{ type: "text", text: "Fix auth\r\nflows today" }], usage: { input: 1, output: 1 } }));
	await agentEnd(h);
	ok(h.pi._sessionName === "Fix auth  flows today", "name matches pi sanitizer output exactly (incl. \r handling)", JSON.stringify(h.pi._sessionName));
	branch.push(msgEntry("user", "follow-up after summary"));
	const callsAfterFirst = h.llmCalls();
	await agentEnd(h);
	ok(h.llmCalls() > callsAfterFirst, "auto-naming not frozen by own sanitized write");
}

// == 3. Compaction-aware full rebuild ========================================
console.log("\n[3] compaction-aware rebuild");
{
	piAi.__reset();
	writeConfig({ debounceSeconds: 0 });
	const branch = [
		msgEntry("user", "early work on parser"),
		{ type: "compaction", summary: "EARLIER WORK: built the parser and tokenizer", firstKeptEntryId: "x", tokensBefore: 5000 },
		msgEntry("user", "now add tests for it"),
	];
	const h = makeHarness({ branch });
	await startSession(h);
	await agentEnd(h);
	const prompt = piAi.__calls[0]?.params?.messages?.[0]?.content?.[0]?.text ?? "";
	ok(prompt.includes("[Earlier session context, compacted away]: EARLIER WORK: built the parser and tokenizer"), "full-rebuild prompt embeds compaction summary");
}

// == 4. /summary:update on a locked summary ==================================
console.log("\n[4] locked update notify");
{
	piAi.__reset();
	writeConfig({ debounceSeconds: 0 });
	const h = makeHarness({ branch: [msgEntry("user", "hello")] });
	await startSession(h);
	h.pi.setSessionName("my own manual name"); // foreign name → guard trips
	const before = h.llmCalls();
	await h.commands["summary:update"].handler("", h.ctx);
	ok(h.notifications.some((n) => n.msg.toLowerCase().includes("locked")), "locked summary reported");
	ok(h.llmCalls() === before, "no LLM call burned on locked update");
}

// == 5. Gate skip resets the widget staleness counter ========================
console.log("\n[5] gate skip resets stale counter");
{
	piAi.__reset();
	writeConfig({ debounceSeconds: 0 });
	process.env.LIQUID_API_KEY = "probe";
	const realFetch = globalThis.fetch;
	globalThis.fetch = async () => ({
		ok: true,
		json: async () => ({ answers: { material_change: { noul: 0.1 }, topic: { choice: "same_topic", confidence: 0.95 } } }),
	});
	try {
		const branch = [msgEntry("user", "topic one")];
		const h = makeHarness({ branch });
		await startSession(h);
		await agentEnd(h); // first summary (full)
		branch.push(msgEntry("user", "small follow-up, nothing new"));
		await agentEnd(h); // gate skip expected
		const skipWidget = h.widgets.at(-1)?.lines?.[0] ?? "";
		ok(!skipWidget.includes("turns ago") && !skipWidget.includes("turn ago"), "no stale label after deliberate skip", JSON.stringify(skipWidget));
	} finally {
		globalThis.fetch = realFetch;
		delete process.env.LIQUID_API_KEY;
	}
}

// == 6. Empty delta consumed, not escalated ==================================
console.log("\n[6] empty-delta hardening");
{
	piAi.__reset();
	writeConfig({ debounceSeconds: 0 });
	const branch = [msgEntry("user", "hello")];
	const h = makeHarness({ branch });
	await startSession(h);
	await agentEnd(h); // first full summary
	const before = h.llmCalls();
	await agentEnd(h); // no branch growth, gate unavailable → must be a no-op
	ok(h.llmCalls() === before, "empty delta does not trigger full rebuild");
}

// == 7. Headless default off; runHeadless opts in ============================
console.log("\n[7] headless mode gate");
{
	writeConfig({ debounceSeconds: 0 });
	{
		piAi.__reset();
		const realFetch = globalThis.fetch;
		let fetches = 0;
		globalThis.fetch = async () => { fetches++; throw new Error("no network expected"); };
		try {
			const h = makeHarness({ mode: "print", branch: [msgEntry("user", "scripted work")] });
			await startSession(h);
			await agentEnd(h);
			ok(h.llmCalls() === 0 && fetches === 0, "print mode: no summarizer, no gate");
		} finally { globalThis.fetch = realFetch; }
	}
	writeConfig({ debounceSeconds: 0, runHeadless: true });
	{
		piAi.__reset();
		const h = makeHarness({ mode: "print", branch: [msgEntry("user", "scripted work")] });
		await startSession(h);
		await agentEnd(h);
		ok(h.llmCalls() === 1, "runHeadless: true spends the call in print mode");
	}
}

// == 8. Telemetry ============================================================
console.log("\n[8] telemetry");
{
	piAi.__reset();
	writeConfig({ debounceSeconds: 0, telemetry: { enabled: true, path: GLOBAL_LOG } });
	process.env.LIQUID_API_KEY = "probe";
	const realFetch = globalThis.fetch;
	let failFetch = false;
	globalThis.fetch = async () => {
		if (failFetch) throw new Error("The operation was aborted due to timeout");
		return { ok: true, json: async () => ({ answers: { material_change: { noul: 0.9 }, topic: { choice: "same_topic", confidence: 0.9 } } }) };
	};
	try {
		const branch = [msgEntry("user", "hello telemetry")];
		const h = makeHarness({ branch });
		await startSession(h);
		await agentEnd(h); // ok summary + gate summarize
		branch.push(msgEntry("user", "more work"));
		failFetch = true;
		await agentEnd(h); // gate fall-through error + incremental summary ok
		failFetch = false;
		piAi.__setResponder(() => { throw Object.assign(new Error("HTTP 500"), { code: "EPIPE" }); });
		branch.push(msgEntry("user", "break it"));
		try { await agentEnd(h); } catch {}
		await tick();

		ok(existsSync(GLOBAL_LOG), "log file created");
		const fileMode = statSync(GLOBAL_LOG).mode & 0o777;
		ok(fileMode === 0o600, `file perms 0600 (got ${fileMode.toString(8)})`);
		const content = readFileSync(GLOBAL_LOG, "utf-8");
		const lines = content.trim().split("\n").map((l) => JSON.parse(l));
		ok(lines.every((l) => l.v === 1 && l.ts && l.session === "sess-probe-001" && l.project === PROJ), "lines carry v/ts/session/project");
		ok(lines.some((l) => l.kind === "summary" && l.outcome === "ok" && l.cost > 0), "ok summary line with cost");
		ok(lines.some((l) => l.kind === "gate" && l.outcome === "error" && l.error === "TIMEOUT"), "gate fall-through logged as error");
		ok(lines.some((l) => l.kind === "summary" && l.outcome === "error" && l.error === "EPIPE"), "summary error logged");
		ok(!content.includes("hello telemetry") && !content.includes("generic summary"), "no conversation/summary text in log");

		h.notifications.length = 0;
		await h.commands["summary:cost"].handler("project", h.ctx);
		const proj = h.notifications.map((n) => n.msg).join(" | ");
		ok(/project .*: \d+ summarizer calls?, \d+ gate calls?/.test(proj), "project rollup line", proj);
		ok(h.notifications.length === 1, "project rollup is ONE notify (TUI collapses consecutive info notifies)");
		ok(proj.includes("  Decision models:") && proj.includes("  LLMs:"), "rollup has both group headers");
		ok(proj.indexOf("  Decision models:") < proj.indexOf("  LLMs:"), "Decision models section renders first");
		ok(proj.includes("    openai/gpt-5.4-nano:minimal:") && proj.includes("    liquid:"), "provider rows group by provider:effort under their ledger");
		h.notifications.length = 0;
		await h.commands["summary:cost"].handler("lifetime", h.ctx);
		ok(h.notifications.some((n) => n.msg.startsWith("lifetime:")), "lifetime rollup line");
		h.notifications.length = 0;
		await h.commands["summary:cost"].handler("", h.ctx);
		ok(h.notifications.some((n) => n.msg.includes("llm call")), "plain /summary:cost still session view");
		h.notifications.length = 0;
		await h.commands["summary:cost"].handler("bogus", h.ctx);
		ok(h.notifications.some((n) => n.msg.includes("Usage:")), "bad scope shows usage");
	} finally {
		globalThis.fetch = realFetch;
		delete process.env.LIQUID_API_KEY;
	}
}

// == 9. Effort clamping ======================================================
console.log("\n[9] effort clamping");
{
	// glm-5.3-flash metadata: minimal/medium unsupported, floor is low.
	const GLM_MAP = { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" };
	writeConfig({ debounceSeconds: 0 });

	// Bare pin + unsupported default → floor
	piAi.__reset();
	rmSync(GLOBAL_LOG, { force: true });
	writeConfig({ debounceSeconds: 0, telemetry: { enabled: true, path: GLOBAL_LOG } });
	writeFileSync(join(PROJ, ".pi", "session-summary.json"), JSON.stringify({ provider: "zai", model: "glm-5.3-flash" }));
	{
		const h = makeHarness({ branch: [msgEntry("user", "clamp default")] });
		h.modelMeta = { thinkingLevelMap: GLM_MAP };
		await startSession(h);
		await agentEnd(h);
		ok(piAi.__calls[0]?.options?.reasoning === "low", "bare glm pin: minimal clamps to floor (low)", String(piAi.__calls[0]?.options?.reasoning));
		await tick();
		const logLines = readFileSync(GLOBAL_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l));
		const lastSummaryEvt = logLines.filter((e) => e.kind === "summary").at(-1);
		ok(lastSummaryEvt?.effort === "low", "summary event records clamped effort", JSON.stringify(lastSummaryEvt?.effort));
	}
	// Explicit unsupported :medium → nearest supported below (low)
	piAi.__reset();
	writeFileSync(join(PROJ, ".pi", "session-summary.json"), JSON.stringify({ provider: "zai", model: "glm-5.3-flash:medium" }));
	{
		const h = makeHarness({ branch: [msgEntry("user", "clamp medium")] });
		h.modelMeta = { thinkingLevelMap: GLM_MAP };
		await startSession(h);
		await agentEnd(h);
		ok(piAi.__calls[0]?.options?.reasoning === "low", ":medium unsupported → clamps down to low", String(piAi.__calls[0]?.options?.reasoning));
	}
	// Explicit supported :high → untouched
	piAi.__reset();
	writeFileSync(join(PROJ, ".pi", "session-summary.json"), JSON.stringify({ provider: "zai", model: "glm-5.3-flash:high" }));
	{
		const h = makeHarness({ branch: [msgEntry("user", "clamp high")] });
		h.modelMeta = { thinkingLevelMap: GLM_MAP };
		await startSession(h);
		await agentEnd(h);
		ok(piAi.__calls[0]?.options?.reasoning === "high", ":high supported → passes through", String(piAi.__calls[0]?.options?.reasoning));
	}
	// Model without metadata → pass-through
	piAi.__reset();
	writeFileSync(join(PROJ, ".pi", "session-summary.json"), JSON.stringify({ provider: "openai", model: "gpt-5.4-nano" }));
	{
		const h = makeHarness({ branch: [msgEntry("user", "no map")] });
		await startSession(h);
		await agentEnd(h);
		ok(piAi.__calls[0]?.options?.reasoning === "minimal", "no thinkingLevelMap → minimal passes through", String(piAi.__calls[0]?.options?.reasoning));
	}
	// Verbose clamp notification
	piAi.__reset();
	writeFileSync(join(PROJ, ".pi", "session-summary.json"), JSON.stringify({ provider: "zai", model: "glm-5.3-flash:medium", verbose: true }));
	{
		const h = makeHarness({ branch: [msgEntry("user", "verbose clamp")] });
		h.modelMeta = { thinkingLevelMap: GLM_MAP };
		await startSession(h);
		await agentEnd(h);
		ok(h.notifications.some((n) => n.msg.includes("effort medium unsupported") && n.msg.includes("using low")), "verbose notifies on clamp");
	}
	rmSync(join(PROJ, ".pi", "session-summary.json"));
}

// == 10. Tildify =============================================================
console.log("\n[10] tildify");
{
	const telemetryMod = await jiti.import(new URL("./telemetry.ts", import.meta.url).pathname);
	const t = telemetryMod.tildify ?? telemetryMod.default?.tildify;
	const home = homedir();
	ok(t(join(home, "Developer/personal/pi-agent")) === "~/Developer/personal/pi-agent", "home-prefixed path tildified");
	ok(t(home) === "~", "bare home tildified");
	ok(t("/tmp/elsewhere") === "/tmp/elsewhere", "non-home path untouched");
	ok(t(home + "x/y") === home + "x/y", "prefix-adjacent dir NOT tildified");
}

// == 11. Telemetry default off ===============================================
console.log("\n[11] telemetry default off");
{
	piAi.__reset();
	rmSync(GLOBAL_LOG, { force: true });
	writeConfig({ debounceSeconds: 0 });
	const h = makeHarness({ branch: [msgEntry("user", "quiet")] });
	await startSession(h);
	await agentEnd(h);
	ok(h.llmCalls() === 1 && !existsSync(GLOBAL_LOG), "no log file when disabled; summarizing unaffected");
}

// == 12. /summary:gate diagnostics surface in one notify =====================
console.log("\n[12] gate diagnostics single notify");
{
	piAi.__reset();
	writeConfig({ debounceSeconds: 0 });
	const branch = [msgEntry("user", "hello diag")];
	const h = makeHarness({ branch });
	await startSession(h);
	await agentEnd(h); // first summary lands, delta consumed
	await tick();
	h.notifications.length = 0;
	await h.commands["summary:gate"].handler("", h.ctx);
	ok(h.notifications.length === 1, "gate diagnostics render as ONE notify (status + outcome survive collapse)");
	const diag = h.notifications.at(-1)?.msg ?? "";
	ok(diag.includes("[gate]") && diag.includes("No uncovered activity"), "provider status AND coverage message both visible");
	ok(diag.includes("covered by the summary") && diag.includes("reopen the dry run"), "coverage message explains steady state");
}

// == 13. Gate attempt trail ==================================================
console.log("\n[13] gate attempt trail");
{
	piAi.__reset();
	rmSync(GLOBAL_LOG, { force: true });
	writeConfig({ debounceSeconds: 0, telemetry: { enabled: true, path: GLOBAL_LOG } });
	// liquid is first in the cycle and fails with 401; typesafe answers.
	process.env.LIQUID_API_KEY = "probe";
	process.env.TYPESAFE_API_KEY = "probe";
	const realFetch = globalThis.fetch;
	globalThis.fetch = async (url) => {
		if (String(url).includes("liquid")) {
			return { ok: false, status: 401, json: async () => ({}) };
		}
		return { ok: true, json: async () => ({ answers: { material_change: { noul: 0.85 }, topic: { choice: "same_topic", confidence: 0.9 } } }) };
	};
	try {
		const branch = [msgEntry("user", "trail test")];
		const h = makeHarness({ branch });
		await startSession(h);
		await agentEnd(h); // first summary (full, ungated)
		branch.push(msgEntry("user", "material change"));
		await agentEnd(h); // gate: liquid 401 → typesafe summarize
		await tick();
		const events = readFileSync(GLOBAL_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l));
		const gateEvt = events.filter((e) => e.kind === "gate").at(-1);
		ok(gateEvt?.provider === "typesafe" && gateEvt?.outcome === "ok", "decision event names the answering provider");
		ok(Array.isArray(gateEvt?.attempts) && gateEvt.attempts.includes("liquid: HTTP 401"), "attempts trail records the failed provider", JSON.stringify(gateEvt?.attempts));
	} finally {
		globalThis.fetch = realFetch;
		delete process.env.LIQUID_API_KEY;
		delete process.env.TYPESAFE_API_KEY;
	}
}

rmSync(ROOT, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
