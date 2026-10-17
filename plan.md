# GentX2 — authoritative implementation plan

## Product direction

GentX2 is an authenticated security workbench for explicitly authorized application targets. It offers three intake paths—folder/ZIP, public GitHub repository, and deployed website URL—normalized into one Zod-validated target contract. BlackHat, WhiteHat, Sentinel, Auditor, and Orchestrator perform bounded, separately prompted roles through a server-owned workflow. All untrusted target code, generated tests, builds, scanners, exploit replays, and verification commands run inside disposable CreateOS sandboxes. A URL-only engagement is black-box testing and remediation guidance only; source patches require source access, and nothing is deployed automatically.

The accepted architecture is Next.js App Router, TypeScript, Tailwind, shadcn/ui, Supabase Postgres/Auth/Realtime/Storage, the official CreateOS TypeScript SDK, and a server-side model provider adapter configured through protected runtime settings. Stripe Projects is part of the service-provisioning workflow; Stripe Payments is explicitly out of scope unless a later requirement makes payments necessary.

## Implementation approach

- **Application and authentication:** keep Next.js App Router and TypeScript. Use `@supabase/supabase-js` with `@supabase/ssr`, request-scoped server clients, the Supabase Auth cookie refresh proxy, and server-side authorization checks for every target, project, scan, event, artifact, and patch operation. For hosted HTTPS preview, auth cookies must use `SameSite=None; Secure`. Use the publishable key in browser-safe contexts only; privileged Supabase keys and all model/CreateOS credentials stay in server runtime configuration. Do not trust cookies without verified claims.
- **Stripe Projects:** follow the current official CreateOS × Stripe event workflow inside the existing project: install/verify the Projects CLI/plugin, run `stripe projects init gentx2`, inspect project/catalog/status, and use Stripe Projects for the requested CreateOS and Supabase resources. Prefer linking existing provider accounts/resources to avoid duplicates. Before any service creation or upgrade, inspect its plan and spend; do not make a payment, start a paid tier, or add Stripe Payments. If a requested provider setup requires a charge or payment-method authorization, stop and obtain the required approval through the prescribed payment workflow. Pull credentials only to a local ignored `.env` for development, never commit or print it, and copy only required values into protected WebDev runtime secret inputs.
- **Supabase data and policies:** use reproducible SQL migrations under `supabase/migrations/` and define `profiles`, `projects`, `project_members`, `scans`, `agent_runs`, `findings`, `evidence`/artifact metadata, `patches`, `verification_runs`, and `audit_events`. Every user-owned or exposed table gets RLS, least-privilege grants, per-operation policies, and pgTAP policy tests covering allowed and denied operations and cross-user isolation. Add server-side ownership checks in addition to RLS. User-facing reads and writes use the authenticated request client. If a server-only service key is required for a trusted runner, it never enters browser or sandbox contexts; the runner verifies project/scan ownership before each privileged operation. Keep audit rows append-only from application/agent perspectives. Store large evidence and approved patch artifacts in private Storage buckets with owner/project-scoped authorization and bounded retention; retain only metadata/hashes where full payload retention is unnecessary.
- **Target intake and safety:** support folder/ZIP upload, GitHub repository, and deployed URL. Normalize all three to a shared `Target` shape with explicit scope and authorization. Source is handled as a transient copy and transferred only to CreateOS. Source-backed runs default to no source-content sharing; explicit per-run consent allows up to three bounded, redacted source excerpts to be sent to the configured analysis service, without storing the raw excerpts. URL-only targets never receive source-edit claims. Validate URLs, every DNS resolution, redirect destination, IP class, and scope; block localhost/private/link-local/metadata destinations by default, and prevent DNS rebinding. Require an explicit authorization confirmation bound to the immutable audit record. Exclude credentials from prompts, target archives, child processes, and sandboxes.
- **CreateOS execution:** use only the official `@nodeops-createos/sandbox` TypeScript SDK from server code and only methods/types verified against the installed package and official docs. Configure a non-empty, target-scoped egress allowlist before any untrusted process starts, then read it back and fail closed if it differs. Bound commands, processes, files, extraction, CPU, memory, wall time, output, requests, model calls/cost, retries, round count, and total session duration. Use an immutable host-owned verifier bundle separate from the mutable target sandbox; BlackHat, WhiteHat, Sentinel, Auditor, and Orchestrator cannot change verifier criteria, orchestration code, permissions, or budgets. Use `finally` cleanup and explicit lifecycle events; emergency stop cancels work and destroys only the session-owned sandbox.
- **Provider and named roles:** expose a typed `AgentProvider` interface with a server-side model-generation adapter. Configure `AGENT_API_KEY` and `AGENT_MODEL` only in protected server runtime settings. Send structured JSON output schemas and validate responses with Zod. Review the selected provider's data handling policy before sending target evidence. BlackHat, WhiteHat, Sentinel, Auditor, and Orchestrator may share a model, but each has a distinct system prompt, context, structured-output schema, permissions, and explicit token/cost/time budget. BlackHat discovers authorized candidates; WhiteHat may propose source-only fixes for evidence-backed candidates while leaving findings unverified; Sentinel reports model assessment but cannot independently verify without a trusted verifier; Auditor reviews supplied diffs and results; Orchestrator coordinates server-owned transitions and stop conditions. Retrying uses bounded backoff and idempotency; record provider usage/cost when returned and explicit unknowns when not.
- **Trusted workflow:** implement `INTAKE → BASELINE → ATTACK → VERIFY → PATCH → REGRESSION → RETEST → RECORD → CONTINUE_OR_STOP`. Only the trusted server-side orchestrator can advance states. In every round, BlackHat uses approved safe checks (OWASP ZAP Automation Framework and optional Nuclei only after actual installation, license, and safe configuration are verified), creates bounded non-destructive proofs, and records structured evidence. WhiteHat proposals require an evidence-backed, explicitly unverified candidate, opt-in source sharing, strict single-file validation, and review of both diff and regression script. Human approval applies the proposal and script only to a disposable CreateOS copy bound to the exact source hash; no original source is changed or exported. The recorded regression result describes the script exit only and is not a verifier result. Failed, skipped, or inconclusive checks never count as clean. A separate trusted verifier remains necessary before claiming a finding verified or a round clean. Provide idempotent transitions, cancellation, emergency stop, and no automatic deployment.
- **Evidence, realtime, and final records:** persist projects, scans, distinct agent runs, findings with severity/confidence/evidence, verification records, patch metadata, and audit events in Supabase. Evidence includes timestamps, actor, action, input/output hashes where practical, bounded/redacted tool results, source/version identifiers, and explicit state transitions. Use Supabase Realtime or SSE for actual stored run events; events must be reconnectable and never simulated. Private Storage contains only access-controlled artifacts with retention limits. Final reports distinguish verified, unverified, failed, inconclusive, skipped, and URL-only advisory outcomes.
- **Dashboard:** follow the latest user visual direction: premium near-black cyber-operations terminal, neon-green terminal accents, cyan highlights, subtle scanlines, monospace typography, restrained red warnings, high contrast, and responsive non-game-like composition. BlackHat and WhiteHat remain the dominant side-by-side pair; Sentinel, Auditor, and Orchestrator have distinct panels. Show each named role's real-time state and logs, target intake and authorization, findings/evidence, patch diffs, build/regression results, sandbox health, round progression/metrics, persistent session history, stop/rollback controls, and final report. Empty, loading, error, cancellation, and partial-failure states are explicit. Every visual indicator reflects actual persisted backend events; no mocked live activity or fabricated pass state.
- **Documentation and tests:** include `.env.example` with placeholders only, `README.md` setup/migration instructions, architecture notes, threat model, and deployment guidance. Do not seed user, project, or target records. Add unit coverage for orchestration/authorization, PostgreSQL policy tests, provider adapter tests, and CreateOS smoke tests. Do not describe unverified integration as working.

## Project structure

```text
app/
  page.tsx                              Cyber-operations dashboard
  login/                                Supabase Auth sign-in
  auth/callback/                        Auth code exchange
  api/targets/                          Target intake/normalization
  api/projects/                         Project and membership APIs
  api/scans/                            Scan start/history/stop/report APIs
  api/scans/[id]/events/                SSE or Realtime handoff
  api/artifacts/                        Authorized patch/evidence downloads
components/
  dashboard/                            BlackHat, WhiteHat, Sentinel, Auditor, Orchestrator panels; timeline, logs, health
  intake/                               Folder/GitHub/URL forms and authorization
  findings/                             Evidence, findings, patch diff, report
  auth/                                 Sign-in and user state
  ui/                                   shadcn/ui primitives
lib/
  schemas/                              Zod contracts
  supabase/                             Browser, server, service-only clients
  security/                             Scope, DNS/IP/redirect, redaction, limits
  state-machine/                        Server-owned transitions and clean rounds
  agents/                               Provider abstraction and named role contracts
  createos/                             SDK adapter, egress, lifecycle, runner
  scanners/                             ZAP/Nuclei policies and output parsers
  verification/                         Immutable deterministic verifier bundle
  audit/                                Append-only event helpers and hashing
  storage/                              Private artifact access and retention
  intake/                               ZIP/GitHub/URL normalization
supabase/
  migrations/                           Schema, grants, RLS, storage policies
  tests/                                 pgTAP user-isolation and table-policy tests
scripts/                                 Stripe Projects and migration helpers
 tests/                                  Unit, provider, integration and E2E tests
public/manus-routes.json                Complete user-facing route manifest
README.md
THREAT_MODEL.md
.env.example
```

## Verified integration facts and constraints

- Official CreateOS × Stripe hackathon guidance says to set up the service stack with Stripe Projects, then run agent-written code in CreateOS sandboxes; the example uses `stripe projects init`, `stripe projects add createos/project`, and CreateOS sandbox commands. It explicitly emphasizes locking down sandbox network access.
- Official Stripe Projects documentation supports initializing an existing codebase, provisioning providers with `stripe projects add`, syncing credentials using `stripe projects env --pull`, and inspecting project/spend status. A service add provisions a provider resource; no new paid tier, payment, or Stripe Payments integration will be selected without the required approval.
- Official Supabase docs prescribe request-scoped `@supabase/ssr` clients for Next.js and verified claims rather than trusting session cookies. Exposed tables need both least-privilege grants and RLS, plus allow/deny policy tests. Any service-role key bypasses RLS and must remain server-only with explicit ownership checks.
- The configured model API key and plain-text plus structured-output requests have been verified; all five named role contracts remain pending.
- CreateOS SDK inspection from the earlier implementation verified installed SDK exports and types and a live authenticated identity/catalog response. A real sandbox creation was rejected with `sandbox concurrent quota reached (1 / 1)`. No GentX2 sandbox run or destruction has been verified yet. Do not reuse, pause, or destroy the pre-existing sandbox; retry CreateOS only after capacity is available.
- Supabase and model-provider credentials are not yet verified for this revised stack. Use Stripe Projects when available, otherwise request them through protected project secret input; never paste, log, commit, or expose them to browser/sandbox processes.

## Official sources

- CreateOS × Stripe hackathon: https://createos.sh/hackathon
- Stripe Projects hackathon guide: https://projects.dev/hackathon
- Stripe Projects CLI: https://docs.stripe.com/projects
- Supabase Next.js quickstart: https://supabase.com/docs/guides/getting-started/quickstarts/nextjs
- Supabase SSR client: https://supabase.com/docs/guides/auth/server-side/creating-a-client
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Realtime authorization: https://supabase.com/docs/guides/realtime/authorization
- CreateOS Sandbox SDK quickstart: https://createos.sh/docs/Sandbox/SDK/Quickstart/
- CreateOS Sandbox overview: https://createos.sh/docs/Sandbox/Overview/
- CreateOS Sandbox concepts: https://createos.sh/docs/Sandbox/Concepts/
- CreateOS SDK source: https://github.com/NodeOps-app/createos-sandbox-sdk
- OWASP ZAP Automation Framework: https://www.zaproxy.org/docs/desktop/addons/automation-framework/
- ProjectDiscovery Nuclei rate controls: https://docs.projectdiscovery.io/opensource/nuclei/mass-scanning-cli
