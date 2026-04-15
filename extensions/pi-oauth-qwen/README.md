# pi-oauth-qwen

Hardened Qwen OAuth provider extension for [pi](https://github.com/badlogic/pi-mono).

Based on the upstream `custom-provider-qwen-cli` example with security fixes applied.

## Usage

```bash
pi -e ~/.pi/agent/extensions/pi-oauth-qwen
```

Then authenticate with `/login qwen-cli`, or set `QWEN_CLI_API_KEY` in your environment.

## Models

| Model ID | Name | Context Window | Max Output | Capabilities |
|---|---|---|---|---|
| `coder-model` | Qwen 3.6 Plus | 1M tokens | 65,536 | Text + Image |

## Authentication

Uses the OAuth 2.0 Device Authorization Grant (RFC 8628) with PKCE (RFC 7636) against `chat.qwen.ai`. On `/login qwen-cli`, a browser URL and user code are displayed. After authorizing in the browser, the extension polls for and stores the token automatically.

Tokens are refreshed transparently via the `refresh_token` grant.

## Security Hardening (vs upstream)

This fork applies the following fixes over the upstream example:

1. **Domain allowlisting** -- `resource_url` from token responses is validated against `*.aliyuncs.com` and `*.qwen.ai`. Unrecognized domains fall back to the default DashScope URL, preventing token exfiltration via a malicious `resource_url`.
2. **HTTPS enforcement** -- `http://` base URLs are rejected; only `https:` is accepted.
3. **Error response sanitization** -- Server response bodies in error paths are truncated to 512 characters to prevent information leakage and memory exhaustion.
4. **Token expiry floor** -- A minimum 30-second lifetime is enforced so that short `expires_in` values (< 300s) don't produce already-expired timestamps that cause infinite refresh loops.

See `eval-001-security-review-qwen-cli-extension.md` for the full security review with resolution status.
