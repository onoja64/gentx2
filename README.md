# GentX2

**An authorized-security workbench for bounded application testing.**

GentX2 combines scoped target intake, a coordinated set of security agents, disposable sandboxes, and human-reviewed remediation proposals. It is a hackathon prototype built with Next.js, Supabase, CreateOS Sandboxes, and a configurable server-side model provider.

> **Project status:** Experimental hackathon prototype. The automated tests, typecheck, and production build pass locally; live integrations still depend on provider credentials, service capacity, and an authorized target. This repository does not include a hosted deployment. Do not treat scan results as a certification that a system is secure.

## What it does

- Accepts authorized targets through source archives, public GitHub repositories, or website URLs.
- Requires an explicit authorization and scope declaration before a scan.
- Coordinates BlackHat, WhiteHat, Sentinel, Auditor, and Orchestrator within a trusted server-side workflow.
- Runs target code and generated checks in disposable, restricted sandboxes.
- Records findings and evidence in Supabase with row-level security.
- Offers optional source-backed remediation proposals with per-run consent and human review.
- Supports one-time Stripe **test-mode** checkout; live payment keys and live checkout sessions are rejected.

## Workflow

1. **Authorize:** sign in, identify the target, and define the allowed scope.
2. **Inspect:** the Orchestrator coordinates bounded checks by BlackHat and records their evidence.
3. **Verify:** Sentinel independently checks relevant findings; uncertain results remain unverified or inconclusive.
4. **Review remediation:** with per-run source consent, WhiteHat can propose a one-file patch. A person reviews the diff and regression script before either is run in a disposable sandbox.
5. **Report:** the app records findings, evidence, and check outcomes. It does not deploy proposed changes to the target.

## Safety model

Use GentX2 only on systems for which you have written authorization.

- URL-only targets are limited to black-box testing and remediation guidance; they do not receive source-code patch proposals.
- Source analysis is off by default. If enabled for a run, up to three bounded, redacted source excerpts may be sent to the configured analysis provider. Redaction can miss secrets, so review the target and provider data-handling terms before opting in.
- WhiteHat proposals are limited to one existing source file and remain unverified. Review the proposed diff and regression script before approving a sandbox run.
- Approved proposals are applied only to a disposable, unprivileged copy of the exact source snapshot. The original source is not modified, exported, or deployed.
- A passing regression script records only that the script exited successfully; it does not independently verify a finding.
- Failed, skipped, or inconclusive checks do not count as a clean round.

See [THREAT_MODEL.md](./THREAT_MODEL.md) for the detailed security boundaries.

## Requirements

- Node.js and pnpm
- Docker, for the local Supabase stack
- Supabase credentials
- CreateOS and model-provider credentials for live agent and sandbox checks
- Stripe test credentials and the Stripe CLI for local checkout testing

## Quick start

1. Install dependencies and create a local environment file:

   ```bash
   pnpm install
   cp .env.example .env
   ```

2. Start Supabase locally:

   ```bash
   pnpm run db:start
   pnpm exec supabase status
   ```

3. Copy the local Supabase URL, publishable key, and secret key into the matching variables in `.env`. Keep secret values server-side; never place them in a `NEXT_PUBLIC_*` variable.

4. Configure the optional agent, sandbox, and Stripe values in `.env` if you plan to use those integrations. The required variable names are listed in [.env.example](./.env.example).

5. Apply the schema to the local database and start the app:

   ```bash
   pnpm run db:reset
   pnpm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

Email/password authentication is supported. Immediate sign-up requires email confirmation to be disabled in the Supabase Auth settings. Enable email confirmation before using the app beyond the hackathon environment.

## Configuration

All provider keys are server-only. Never commit `.env`, paste credentials into prompts, or include secrets in source archives.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL used by the browser client |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |
| `SUPABASE_URL` | Supabase URL used by server-side code |
| `SUPABASE_SECRET_KEY` | Server-only Supabase secret key |
| `CREATEOS_SANDBOX_API_KEY` | CreateOS sandbox access |
| `AGENT_API_KEY` | Server-side analysis provider credential |
| `AGENT_MODEL` | Model identifier used by the agent adapter |
| `STRIPE_TEST_SECRET_KEY` | Stripe test-mode API key |
| `STRIPE_TEST_PRICE_ID` | One-time Price ID in the Stripe test account |
| `STRIPE_TEST_WEBHOOK_SECRET` | Signing secret for the test webhook endpoint |
| `APP_URL` | Application origin used for checkout redirects |

Optional integrations may remain unconfigured during local UI development.

## Database migrations

The SQL files in `supabase/migrations/` are the schema source of truth.

For local development, use `pnpm run db:reset` to recreate the local database and apply migrations. This is destructive to the **local** database; never point a reset command at production.

To apply migrations to a hosted Supabase project:

1. Link the Supabase CLI to the intended project.
2. Review the pending migration list.
3. Run `pnpm run db:push`.
4. Verify the schema and configure the deployed application origin in Supabase Auth.

The migrations do not seed demo users, projects, or targets. Run database policy tests with `pnpm run db:test`.

## Stripe test checkout

Billing uses a one-time Price configured in a Stripe test account. Clients cannot select the amount, and live keys are rejected. Test-mode payments do not move real money.

Set the Stripe variables from the table above, then start the local webhook listener:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Set the listener's signing secret as `STRIPE_TEST_WEBHOOK_SECRET`, restart the app, sign in, and use the Billing page with a Stripe test card. See the [Stripe CLI documentation](https://docs.stripe.com/stripe-cli) for installation and login instructions.

## Checks

Run the local test suite, typecheck, and production build:

```bash
pnpm test
pnpm run typecheck
pnpm run build
```

Optional live checks require valid credentials and may use external API capacity:

```bash
pnpm run verify:createos
pnpm run verify:agents
```

The CreateOS check may create and clean up a real sandbox. The agent check sends contract probes to the configured provider. Do not run either against a production target or with credentials you are not authorized to use.

## Deployment

GentX2 is a standard Next.js application, but this repository has no hosting-provider configuration or deployed production URL. To deploy it:

1. Choose a host that supports the Next.js Node runtime.
2. Add the required environment variables through the host's protected secret settings.
3. Apply and verify Supabase migrations for the intended project.
4. Configure Supabase Auth site and redirect URLs for the deployed HTTPS origin.
5. Set `APP_URL` to that origin.
6. Keep Stripe in test mode until live payments are explicitly designed and reviewed.

Never commit production credentials or deploy patches generated for a target automatically.

## Contributing

Issues and pull requests are welcome. Keep changes scoped, add tests for security-sensitive behavior, and do not include credentials, private target code, customer data, or fabricated scan evidence in examples.

## License

No license file is included yet. Until the project owner adds one, the source remains under its default copyright terms; public availability alone does not grant permission to reuse or redistribute it.

