# GentX2 threat model

## Assets

The primary assets are Supabase records, private evidence metadata and artifacts, provider credentials, CreateOS credentials, target source archives, immutable audit history, and the integrity of verification criteria. Target source and scanner output are untrusted data even when the operator authorized the target.

## Trust boundaries

The browser is untrusted and receives only publishable Supabase configuration. Request-scoped Supabase clients enforce user access through claims and RLS. The service-role key is server-only and is used only after explicit ownership checks. The CreateOS sandbox is disposable and must never receive Supabase, Stripe, or model credentials. The verifier and state machine are host-owned; agent output cannot alter their rules.

## Threats and controls

- **Unauthorized target testing:** require the exact authorization phrase, immutable authorization audit event, explicit path scope, and URL/DNS/redirect validation.
- **SSRF and rebinding:** accept HTTPS only, reject private/local/link-local/metadata destinations, resolve every hostname, compare redirect origin and path, and create an exact host:port egress allowlist.
- **Prompt injection through target content:** delimit target data as untrusted evidence and use role-specific prompts and Zod schemas. Never treat model prose as a permission.
- **Sandbox escape or resource abuse:** use the official SDK, non-empty egress policy, unprivileged workspace, fixed command argument limits, timeouts, output caps, and teardown in `finally`.
- **Forged clean result:** persist raw bounded evidence and hashes, require independent verification, prevent agents from changing criteria, and treat failed/skipped/inconclusive checks as non-clean.
- **Cross-user data access:** enforce server ownership checks plus Supabase RLS and test both allowed and denied paths.
- **Patch supply-chain risk:** source sharing is opt-in per run; excerpts are bounded and redacted before leaving CreateOS, and are not persisted. Patch proposals are limited to one existing source file and must pass strict path/diff validation. A human reviews both the patch and its regression script. Approval applies and runs them only in a fresh, unprivileged sandbox copy bound to the session's source hash, with no application credentials and restricted egress. The original source is not changed or exported. A successful script exit is not independent vulnerability verification.
- **Credential leakage:** use server-only environment names, redaction, private Storage, bounded retention, and no secret values in logs or prompts.

## Residual risk

A clean round is evidence about the bounded checks that ran; it is not proof that a target has no vulnerabilities. External provider availability, quotas, scanner installation, and credentials must be reported as blocked or inconclusive rather than silently skipped.
