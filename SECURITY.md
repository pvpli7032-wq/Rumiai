# Security Policy

## 🛡️ Supported Versions

We provide active security updates for the following releases:

| Version | Supported | Status |
| :--- | :--- | :--- |
| `1.0.x` / `master` | ✅ | Actively Maintained |
| `< 1.0.0` | ❌ | End of Life |

---

## 🚨 Reporting a Vulnerability

If you discover a security vulnerability or exploit within Khui AI, please disclose it responsibly:

1. **Do NOT open a public GitHub issue.**
2. Send a detailed report to **`security@khuiai.com`** or contact the repository maintainers directly.
3. Include:
   - Nature of the vulnerability (e.g., Auth Bypass, SQLi, Prompt Injection, Rate Limit Evasion)
   - Step-by-step reproduction instructions or Proof of Concept (PoC)
   - Impact assessment

---

## 🔒 Security Architecture Highlights

- **Token Version Invalidation:** Sessions carry a `token_version` claim that is verified against the database on every authenticated request, enabling instantaneous session revocation.
- **Strict Roleplay Content Sanitization:** Roleplay text is safely escaped prior to formatting to prevent stored XSS attacks.
- **In-Memory Rate Limiting:** Sliding-window rate limiters prevent API exhaustion and automated brute-force attempts.
- **Content Moderation & 18+ Protection:** 15-category UGC reporting system and adult content filters protect users from inappropriate material.
