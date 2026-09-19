# pi-five

**Reserved name.** Lightweight background-worker fleet experiment for the
[pi coding agent](https://github.com/earendil-works/pi) — 4 subagents + you as
the fifth.

**Status: dormant, trigger-gated.** Nothing is implemented here yet, by
design — a production-ready delegation harness already exists:
[`pi-subagents`](https://www.npmjs.com/package/pi-subagents). Use that.

This package reserves the name and publishes the design doc:
[shrwnsan/pi-agent → docs/package-research-2026-09.md](https://github.com/shrwnsan/pi-agent/blob/main/docs/package-research-2026-09.md)
(§5 design sketch, §9 security audit, §10.2 exhumation triggers).

## Build conditions (2 of 4 required)

1. pi-subagents abandoned, broken, or compromised upstream
2. An unfixable security finding relevant to its users
3. Sustained daily friction that per-project loading doesn't mitigate
4. A repeated real capability gap

## License

MIT
