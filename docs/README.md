# EdgeSeed — Documentation

## Overview

EdgeSeed is a Cloudflare-native monorepo starter for shipping SaaS products fast. It provides auth, database, API, UI, and MCP tooling out of the box — all running on Cloudflare Workers.

For the full V1 scope and design decisions, see [starter-v1-scope.md](./starter-v1-scope.md).

## Quick start

```bash
pnpm install

# Required, not optional. `authMiddleware` validates the env on every request
# and refuses when it is missing (docs/security-audit.md #3), so without this
# every page — the landing page included — answers 500.
cp apps/web/.dev.vars.example apps/web/.dev.vars
# Then fill in BETTER_AUTH_SECRET (32+ chars) and BETTER_AUTH_URL:
#   openssl rand -hex 32
#   BETTER_AUTH_URL=http://localhost:5173

pnpm db:migrate
pnpm db:seed
pnpm dev --filter @starter/web
```

Open http://localhost:5173. Register an account to access the dashboard.

Working on `apps/mcp` too? It is a separate Worker with its own env, so it
needs its own `cp apps/mcp/.dev.vars.example apps/mcp/.dev.vars`.

### Social login (optional)

To enable GitHub/Google OAuth, create OAuth apps and add credentials to `apps/web/.dev.vars`:

```
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

- GitHub callback URL: `http://localhost:5173/api/auth/callback/github`
- Google redirect URI: `http://localhost:5173/api/auth/callback/google`

## Project structure

```
apps/web          — React Router v7 + Hono (Cloudflare Workers)
apps/mcp          — MCP server for LLM tool access
packages/auth     — Better Auth (email/password, GitHub, Google, orgs)
packages/cli      — Dev workflow scripts
packages/config   — Zod-validated env schemas
packages/db       — Drizzle ORM + D1 schema and migrations
packages/email    — EmailSender port + Resend transport
packages/observability — structured logging, correlation ids, Sentry
packages/testing  — shared test helpers (dependency-free)
packages/ui       — shadcn/ui components + theme
docs/adr          — Architecture decision records
docs/api          — Generated OpenAPI specs
```

## Dev workflow

| Command                             | What it does                              |
| ----------------------------------- | ----------------------------------------- |
| `pnpm dev --filter @starter/web`    | Start web dev server on :5173             |
| `pnpm db:generate`                  | Generate migration from schema changes    |
| `pnpm db:migrate`                   | Apply migrations to local D1              |
| `pnpm db:seed`                      | Insert seed data                          |
| `pnpm db:reset`                     | Drop and re-apply all migrations          |
| `pnpm api:spec`                     | Regenerate `docs/api/openapi.json`        |
| `pnpm api:call <METHOD> <path>`     | Call `/api/v1` with an API token          |
| `pnpm check:boot`                   | Boot each built Worker, assert it serves  |
| `pnpm test`                         | Run Vitest                                |
| `pnpm test:e2e`                     | Run Playwright e2e tests                  |
| `pnpm test:coverage`                | Vitest with coverage (`coverage/`)        |
| `pnpm test:mutation`                | Stryker mutation tests                    |
| `pnpm lint` / `pnpm lint:fix`       | ESLint check / autofix                    |
| `pnpm format` / `pnpm format:check` | Prettier write / check                    |
| `pnpm build`                        | Build every Worker bundle                 |
| `pnpm typecheck`                    | TypeScript check across apps              |
| `pnpm verify`                       | Full pre-deploy gate                      |
| `pnpm deploy:web`                   | `verify` + deploy web app                 |
| `pnpm deploy:web:ungated`           | Deploy half only — CI use, skips `verify` |
| `pnpm version:bump [type]`          | Bump version + API spec, print the steps  |
| `pnpm check:release-version <tag>`  | Guard: tag vs package.json + APP_VERSION  |
| `pnpm check:not-downgrade <tag>`    | Guard: tag vs the live production version |
| `pnpm check:deployed <out> <ver>`   | Guard: live /health reports that version  |
| `pnpm release:notes <out>`          | Version ID preamble for release notes     |
| `pnpm init:product <name> [--repo]` | Stamp product identity (new repo)         |
| `pnpm check:docs-sync`              | Docs + .dev.vars.example drift check      |

## Adding a new page

1. Create the route file in `apps/web/app/routes/`
2. Register it in `apps/web/app/routes.ts`
3. If it's a dashboard page, nest it inside the `layout("routes/dashboard.tsx", [...])` block

Route types (`apps/web/.react-router/types/`) are generated and gitignored —
`pnpm typecheck` writes them, and `pnpm dev` keeps them current while it runs.

Check `apps/web/app/routes/_examples/` for reference implementations.

## Adding a new API route

1. Add the route to `apps/web/server/api.ts` with zod schema and OpenAPI metadata
2. Run `pnpm api:spec` to regenerate the spec
3. Add a matching MCP tool in `apps/mcp/src/tools/`

## UI and theming

The UI uses shadcn/ui components with a single oklch color theme (light/dark/system).

- Components live in `packages/ui/src/components/ui/`
- Theme CSS variables are in `apps/web/app/app.css`
- To generate new UI, use the V0 project and shadcn preset documented in `_examples/README.md`

## Deploying

Production deploys are tag-triggered: pushing a `v*` tag runs
`.github/workflows/release.yml`, which verifies, deploys, smoke-tests the live
origin, and only then cuts a GitHub Release naming the Cloudflare Version ID.

```bash
# Schema change? Apply the additive migration FIRST — old code keeps serving
# during the rollout, so it must tolerate the new schema.
pnpm db:migrate --remote

pnpm version:bump patch                # package.json + APP_VERSION + openapi.json
git commit -am "chore(release): v0.1.1"
git push origin HEAD
git tag -a v0.1.1 -m "v0.1.1"          # annotated: --follow-tags skips lightweight tags
git push origin v0.1.1                 # this is what deploys
```

Needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` on a **`production`
GitHub environment** — not repository secrets, so only the deploy job can read
them ([setup](./cloudflare-api-token.md)). Remote D1 migrations stay a separate
manual step — the workflow does not run them, and destructive ones belong in a
later release than the code that stops using the old shape (see AGENTS.md
§ Schema changes).

```bash
# Gated deploy: runs the full verify suite (lint, format check, unit tests,
# gitleaks history scan, build, typecheck, e2e), then deploys the web app.
# The workflow above calls this same script; running it by hand deploys without
# leaving a release behind, so it is the escape hatch, not the normal path.
pnpm deploy:web
```

Avoid raw `wrangler deploy` — it skips the verify gate.

### Production secrets

Secrets are set once per environment with `wrangler secret put <NAME>` (run from
`apps/web/`) and stored encrypted by Cloudflare — never in `wrangler.jsonc` or git.

**Required:**

```bash
# Session signing key — any random 32+ char string:
openssl rand -hex 32 | wrangler secret put BETTER_AUTH_SECRET

# Public URL of the deployed app, e.g. https://app.edgeseed.dev
wrangler secret put BETTER_AUTH_URL
```

**Also required if `routes` in `wrangler.jsonc` declares more than one
hostname** — the marketing origin, e.g. `https://edgeseed.dev`:

```bash
wrangler secret put MARKETING_URL
```

Without it the split never activates and both hostnames serve the app's auth
routes. Setting it also closes the set: any other hostname the Worker is
reachable on — a third route, a dashboard zone route, an enabled `workers.dev`
or preview URL — answers 404 instead of serving auth. Check that list before you
set it. See [Domain Topology](./domains.md).

**Optional — GitHub social login.** Create an OAuth app at
https://github.com/settings/developers with the callback URL
`{BETTER_AUTH_URL}/api/auth/callback/github`, then:

```bash
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
```

**Optional — Google social login.** Create OAuth credentials at
https://console.cloud.google.com/apis/credentials with the authorized redirect URI
`{BETTER_AUTH_URL}/api/auth/callback/google`, then:

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
```

Social login providers are auto-enabled only when their credentials are set
(conditional in `packages/auth/src/server.ts`) — leave them unset and
email/password auth still works. For production OAuth apps, use your real domain
in the callback URLs.

**Effectively required — transactional email.** Sign-up grants no session until
the address is verified, so without a working sender nobody can complete
registration or reset a password. Cloudflare cannot send this mail (Email
Routing is inbound only; the Email Workers `send_email` binding refuses any
recipient outside its allowlist), so the starter uses Resend. Verify a sending
domain at https://resend.com/domains, create an API key, then:

```bash
wrangler secret put RESEND_API_KEY
# Must be on the verified domain, e.g. "EdgeSeed <auth@mail.edgeseed.dev>"
wrangler secret put EMAIL_FROM
```

Both are needed together. With either missing, `@starter/email` logs the message
instead of sending it and warns once per attempt — which looks healthy in every
dashboard while no mail leaves the building. In local development that fallback
is the feature: the log line carries the verification link, so a fresh clone
works with no Resend account. Details in
[ADR 003](./adr/003-transactional-email.md).

### Local dev

Don't use `wrangler secret put` for local development. Put the same variables in
`apps/web/.dev.vars` (gitignored) — wrangler merges them automatically during
`pnpm dev`.

## Further reading

- [Extending the Tenancy Model](./tenancy.md) — adding org-scoped tables, pages, API routes and MCP tools on the starter's tenancy
- [Domain Topology](./domains.md) — single vs split origin, `MARKETING_URL`, custom domains, OAuth callbacks
- [MCP Server](./mcp.md) — connecting a client, the OAuth flow, tools, deploy checklist
- [Creating a New Package](./creating-packages.md) — scaffold checklist, wiring, per-package CLAUDE.md
- [Design Workflow](./design-workflow.md) — V0/shadcn generation and integration (product-owned; swap in your own)
- [Starter as Upstream](./starter-as-upstream.md) — ownership layers, init:product, pulling updates
- [Docs Housekeeping](./housekeeping.md) — what `check:docs-sync` enforces, and the quarterly sweep for the claims it cannot judge
- [Secret Scanning with Gitleaks](./secret-scanning.md) — pre-commit hook, CI scan, and how to handle findings
- [Cloudflare API Token](./cloudflare-api-token.md) — the CI deploy credential: which token type, scoping, rotation
- [Sentry Setup](./sentry-setup.md) — project topology, `.dev.vars` keys, `wrangler secret put`, verification
- [Security Audit](./security-audit.md) — findings from the 10-pass review
- [Security Fix & Test Plan](./security-plan.md) — remediation phases and the standing review pass
- [Cloudflare Costs and Guardrails](./costs-and-limits.md)
- [ADR 001: Monorepo Structure](./adr/001-monorepo-structure.md)
- [ADR 002: Observability](./adr/002-observability.md)
- [ADR 003: Transactional Email](./adr/003-transactional-email.md)
- [ADR 004: Time and Timezones](./adr/004-time-and-timezones.md)
- [OpenAPI Spec](./api/openapi.json)
- [V1 Scope](./starter-v1-scope.md)
