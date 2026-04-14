# Analysis: Qwen OAuth Client ID

**Date:** 2026-03-08

---

## What is it?

```typescript
const QWEN_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";
```

A hardcoded OAuth public client identifier used in the device code authorization flow against `chat.qwen.ai`.

## Origin

The client ID is **extracted from [Qwen Code](https://github.com/QwenLM/qwen-code)**, Alibaba's official AI coding CLI (forked from Google's Gemini CLI). It is not published in any Qwen developer documentation or API reference. There is no public OAuth app registration portal for `chat.qwen.ai`.

Every installation of Qwen Code -- whether via Homebrew, npm, or source -- ships the same client ID. It is not unique per machine or per user. It identifies the *application* ("Qwen Code CLI") to the OAuth server, not the individual user.

What is unique per machine is the **OAuth token** received after authentication, stored at `~/.qwen/oauth_creds.json`.

## Is this a security concern?

**No, by design.** In the OAuth 2.0 Device Authorization Grant (RFC 8628), the client ID is explicitly a public value. There is no client secret. The security of the flow rests on:

- The user code + verification URI (short-lived, shown to the user)
- The PKCE challenge/verifier (prevents interception)
- The access/refresh tokens (per-user, per-session)

A third party knowing the client ID cannot obtain tokens without a user actively authorizing via the browser.

## Risks of reusing the first-party client ID

| Risk | Severity | Notes |
|---|---|---|
| **Client ID rotation** | Medium | If Qwen rotates or revokes the client ID, both qwen-code and this extension break simultaneously. No advance notice is guaranteed for third-party consumers. |
| **Shared rate limits** | Low | If Qwen enforces per-app rate limits, this extension's usage counts against the same quota as the user's qwen-code CLI usage. Current limits: 60 req/min, 2,000 req/day. |
| **App fingerprinting / rejection** | Low | Qwen could add checks (User-Agent, origin) to reject non-official clients using their client ID. Not currently enforced. |
| **Terms of service** | Informational | Reusing a first-party client ID without explicit permission may violate Qwen's ToS. No public ToS clause currently addresses this. |

## Possible improvements

| Approach | Feasibility | Tradeoff |
|---|---|---|
| **Env var override** (`QWEN_CLIENT_ID` with current value as default) | Immediate | Users can swap in their own client ID if Qwen ever offers app registration. Zero breaking change. |
| **Register a dedicated OAuth app** with Alibaba/Qwen | Blocked | Qwen has no public OAuth app registration portal. Would require a partnership or API access agreement. |
| **Configurable via extension config** | Immediate | Pass as a config option so each deployment can use its own. Requires upstream `registerProvider` support for arbitrary config fields. |
| **Read from qwen-code's local credentials** | Immediate | Skip the OAuth flow entirely by reading `~/.qwen/oauth_creds.json` (what Roo Code does). Couples to qwen-code being installed and authenticated. |

## References

- [RFC 8628 - OAuth 2.0 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628)
- [RFC 7636 - PKCE](https://datatracker.ietf.org/doc/html/rfc7636)
- [Qwen Code Authentication Docs](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/)
- [Qwen Code GitHub](https://github.com/QwenLM/qwen-code)
- [Roo Code - Qwen Code CLI Provider](https://docs.roocode.com/providers/qwen-code) (example of reading local OAuth creds)
