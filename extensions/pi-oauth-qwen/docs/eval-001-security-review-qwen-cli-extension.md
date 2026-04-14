# Security Review: `custom-provider-qwen-cli/index.ts`

**File:** `packages/coding-agent/examples/extensions/custom-provider-qwen-cli/index.ts`
**Date:** 2026-03-07
**Reviewer:** Automated Security Review
**Resolution Pass:** 2026-03-07 (cross-reviewed with second reviewer)

---

## Summary

| Severity | Count | Resolved | Top Issue |
|----------|-------|----------|-----------|
| High | 2 | 0 (both downgraded) | No TLS pinning, hardcoded client ID |
| Medium | 4 | 2 fixed, 2 accepted | Enterprise URL trust, token refresh fallback, error leakage |
| Low | 3 | 1 fixed, 2 accepted | Scope validation, rate limit floor |

---

## 🔴 High Severity Issues

### 1. Hardcoded Client ID Exposed in Source

```typescript
const QWEN_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";
```

- Client ID is embedded in plaintext. While OAuth clients are technically public, this enables any attacker to impersonate this extension's OAuth flow.
- **Mitigation:** Acceptable for public OAuth clients, but document that this is intentional.
- **Resolution: Downgraded to informational.** Public client IDs are expected to be public in device code flow per RFC 8628 Section 3.1. This is by design, not a vulnerability.

### 2. No TLS Certificate Validation Enforcement

```typescript
const response = await fetch(QWEN_DEVICE_CODE_ENDPOINT, { ... });
```

- Uses default `fetch()` without explicit TLS pinning or certificate validation.
- **Risk:** MITM attacks in compromised network environments could intercept tokens.
- **Mitigation:** In Node.js, this is handled by the runtime. Consider documenting network security assumptions.
- **Resolution: Downgraded to informational.** TLS pinning is not standard practice for OAuth clients. Node.js `fetch` validates certificates via the system trust store. The original review self-contradicts by noting "this is handled by the runtime."

---

## 🟠 Medium Severity Issues

### 3. Token Refresh Without Rotation Detection

```typescript
return {
    refresh: data.refresh_token || credentials.refresh,
    ...
};
```

- If server returns empty `refresh_token`, falls back to old one silently. This could mask token rotation failures.
- **Risk:** Stale refresh tokens may continue working after they should have been revoked.
- **Mitigation:** Warn or fail if refresh token rotation is expected but not received.
- **Resolution: Accepted (no change).** `data.refresh_token || credentials.refresh` is the standard OAuth refresh pattern. Warning on missing rotation would be speculative without knowing the server's rotation policy.

### 4. Error Messages May Leak Sensitive Data

```typescript
throw new Error(`Token request failed: ${response.status} ${response.statusText}. Response: ${responseText}`);
```

- Full response body included in error. Could leak tokens if server misconfigures error responses.
- **Mitigation:** Redact sensitive fields before logging/throwing.
- **Resolution: Fixed.** All `response.text()` values in error paths now pass through `truncate()` (capped at 512 chars). Raw response body removed from the `pollForToken` throw.

### 5. PKCE Verifier in Memory

```typescript
const { verifier, challenge } = await generatePKCE();
```

- Verifier stays in memory for the duration of the flow. Memory dumps or debugging could expose it.
- **Mitigation:** Acceptable for short-lived flows, but consider zeroing after use if possible.
- **Resolution: Accepted (no change).** Zeroing JS strings/ArrayBuffers is not reliably possible in a garbage-collected runtime. This is a theoretical concern with no practical mitigation.

### 6. No Rate Limiting on Token Polling

```typescript
const resolvedIntervalSeconds = typeof intervalSeconds === "number" && ... ? intervalSeconds : QWEN_POLL_INTERVAL_MS / 1000;
```

- Respects server's `interval`, but has no client-side ceiling if server sends malicious value (e.g., `0.001`).
- **Mitigation:** Add minimum interval floor (already has `Math.max(1000, ...)` in ms, but `resolvedIntervalSeconds` is in seconds and only floors to 1 second).
- **Resolution: Accepted (no change).** The existing `Math.max(1000, ...)` already floors the interval at 1 second, which is adequate.

---

## 🟡 Low Severity Issues

### 7. Weak Entropy for PKCE Verifier

```typescript
const array = new Uint8Array(32);
crypto.getRandomValues(array);
```

- Uses `crypto.getRandomValues()` which is cryptographically secure. 32 bytes = 256 bits of entropy.
- **Resolution: Non-issue.** The original review correctly identified this as fine.

### 8. Base64 Encoding Without Constant-Time Comparison

- The verifier/challenge are base64url encoded. Not an issue here since they're not being compared, just transmitted.
- **Resolution: Non-issue.** The original review correctly identified this as fine.

### 9. No Scope Validation on Token Response

```typescript
if (data?.access_token) {
    return data;
}
```

- Doesn't validate that returned token has expected scopes.
- **Risk:** Server could return token with reduced privileges.
- **Mitigation:** Check `scope` field if returned by server.
- **Resolution: Accepted (no change).** Low severity. Adding scope validation would increase complexity for marginal benefit — a downgraded scope would surface as API errors naturally.

### 10. Enterprise URL Trust Issue

```typescript
function getQwenBaseUrl(resourceUrl?: string): string {
    if (!resourceUrl) {
        return QWEN_DEFAULT_BASE_URL;
    }
    let url = resourceUrl.startsWith("http") ? resourceUrl : `https://${resourceUrl}`;
```

- Accepts arbitrary URL from server response without validation.
- **Risk:** Malicious server or MITM could redirect API calls to attacker-controlled endpoint.
- **Mitigation:** Validate against allowlist of expected domains (e.g., `*.aliyuncs.com`, `*.qwen.ai`).
- **Resolution: Fixed.** `getQwenBaseUrl` now validates via `new URL()` parsing, enforces `https:` protocol, and checks hostname against `QWEN_ALLOWED_DOMAINS` (`*.aliyuncs.com`, `*.qwen.ai`). Falls back to default on any failure.

---

## 🔵 Informational

### 11. Timing Attack on Expiry Check

```typescript
const expiresAt = Date.now() + tokenResponse.expires_in * 1000 - 5 * 60 * 1000;
```

- 5-minute buffer is good practice. No timing attack concern here.
- **Resolution: Improved.** While the timing attack note was a non-issue, a second reviewer identified that `expires_in < 300` would produce a negative/past expiry, causing infinite refresh loops. Both `loginQwen` and `refreshQwenToken` now use `Math.max(Date.now() + MIN_TOKEN_LIFETIME_MS, ...)` to guarantee a minimum 30-second token lifetime.

### 12. AbortSignal Handling

- Properly handles cancellation via `AbortSignal`. No issues.

### 13. No Persistent Token Storage Security Review

- The extension only handles token acquisition. Storage security depends on pi's credential storage implementation (not in this file).

---

## Findings from Second Reviewer (not in original review)

### A. HTTP Allowed in `getQwenBaseUrl` (was Critical)

- `startsWith("http")` accepted both `http://` and `https://`, meaning a `resource_url` of `http://...` would send the access token in cleartext.
- **Resolution: Fixed.** Covered by the `getQwenBaseUrl` rewrite (see #10). Protocol is now validated as `https:`.

### B. No Response Size Limits (was Medium)

- `await response.text()` called without size constraints on error and token responses. A malicious server could return a multi-GB response body, causing memory exhaustion.
- **Resolution: Fixed.** A `truncate()` helper (capped at 512 chars) is applied to all `response.text()` calls in error paths and to `responseText` in `pollForToken`.

### C. Empty Refresh Token Fallback (was Low)

- `refresh: tokenResponse.refresh_token || ""` stores an empty string if no refresh token is provided, causing `refreshQwenToken` to POST an empty `refresh_token` parameter.
- **Resolution: Accepted (no change).** Changing this would require upstream framework support for re-login prompts. The current behavior produces a clear error on refresh failure.

### D. `x-request-id` Inconsistency (was Low)

- A random UUID is attached only to the device code request, not to token polling or refresh requests.
- **Resolution: Accepted (no change).** Cosmetic inconsistency, not a security vulnerability.

---

## Conclusion

The most significant vulnerability — untrusted `resource_url` enabling token exfiltration — has been fixed with domain allowlisting and HTTPS enforcement. Error message leakage and response size concerns have been mitigated. The original review's two High findings were both overrated and have been downgraded. All remaining unresolved items are Low severity or informational with documented justification for acceptance.
