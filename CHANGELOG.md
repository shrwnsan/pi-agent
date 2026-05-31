# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-05-31

### Added
- **answer** — Interactive Q&A extraction extension (`/answer`). Extracts questions from the last assistant message via LLM, then presents them as a navigable list for answering one-by-one. Inspired by [sids/pi-extensions/answer](https://github.com/sids/pi-extensions/tree/main/answer), reimplemented from scratch due to an unresolvable `workspace:^` dependency on `@siddr/pi-shared-qna` that made the upstream package installable via neither npm nor git source.
- **tps** — `/tps` toggle command to enable/disable TPS notifications without reload.

### Changed
- Modernized all imports from `@mariozechner/*` to `@earendil-works/*` for v0.78.0 compatibility.
- **minimal-mode** — Uses v0.78.0 `ToolRenderContext` (`context.lastComponent`) for DOM reuse instead of creating new `Text` components on every render.
- **minimal-mode** — Removed read tool override. v0.78.0 built-in compact read cards (smart file classification, OSC 8 hyperlinks) are superior.
- **minimal-mode** — Removed stale tool cache; tools are now created fresh via `ctx.cwd`.
- **tps** — Removed manual `isAssistantMessage` type guard; uses direct `message.role !== "assistant"` check.

## [0.1.0] - 2026-04-15

### Added
- **tilde-path** — Rewrites CWD in system prompt to use `~` notation.
- **minimal-mode** — Collapsed/expanded tool view toggle (Ctrl+O).
- **tps** — Tokens/sec and usage stats notification after each agent run.
- **pi-oauth-qwen** — OAuth provider for Qwen models via device code flow with PKCE.

### Suspended
- **pi-oauth-qwen** — [Qwen's free OAuth tier ended April 15, 2026](https://github.com/QwenLM/qwen-code). Code preserved for potential future reactivation.
