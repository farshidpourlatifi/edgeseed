# Cloudflare Starter — Documentation

## Overview

This is a Cloudflare-native monorepo starter for shipping SaaS products fast. It provides auth, database, API, UI, and MCP tooling out of the box — all running on Cloudflare Workers.

For the full V1 scope and design decisions, see [starter-v1-scope.md](./starter-v1-scope.md).

## Quick start

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev --filter @starter/web
```

Open http://localhost:5173. Register an account to access the dashboard.

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
packages/ui       — shadcn/ui components + theme
docs/adr          — Architecture decision records
docs/api          — Generated OpenAPI specs
```

## Dev workflow

| Command                          | What it does                           |
| -------------------------------- | -------------------------------------- |
| `pnpm dev --filter @starter/web` | Start web dev server on :5173          |
| `pnpm db:generate`               | Generate migration from schema changes |
| `pnpm db:migrate`                | Apply migrations to local D1           |
| `pnpm db:seed`                   | Insert seed data                       |
| `pnpm db:reset`                  | Drop and re-apply all migrations       |
| `pnpm api:spec`                  | Regenerate `docs/api/openapi.json`     |
| `pnpm test`                      | Run Vitest                             |
| `pnpm test:e2e`                  | Run Playwright e2e tests               |
| `pnpm version:bump [type]`       | Bump version + git tag                 |

## Adding a new page

1. Create the route file in `apps/web/app/routes/`
2. Register it in `apps/web/app/routes.ts`
3. Run `cd apps/web && npx react-router typegen`
4. If it's a dashboard page, nest it inside the `layout("routes/dashboard.tsx", [...])` block

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

```bash
# Build the web app
pnpm --filter @starter/web build

# Deploy to Cloudflare
cd apps/web && wrangler deploy
```

### Production secrets

Secrets are set once per environment with `wrangler secret put <NAME>` (run from
`apps/web/`) and stored encrypted by Cloudflare — never in `wrangler.jsonc` or git.

**Required:**

```bash
# Session signing key — any random 32+ char string:
openssl rand -hex 32 | wrangler secret put BETTER_AUTH_SECRET

# Public URL of the deployed app, e.g. https://starter-web.<subdomain>.workers.dev
wrangler secret put BETTER_AUTH_URL
```

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

### Local dev

Don't use `wrangler secret put` for local development. Put the same variables in
`apps/web/.dev.vars` (gitignored) — wrangler merges them automatically during
`pnpm dev`.

## Further reading

- [Secret Scanning with Gitleaks](./secret-scanning.md) — pre-commit hook, CI scan, and how to handle findings
- [Security Audit](./security-audit.md) — findings from the 10-pass review
- [Security Fix & Test Plan](./security-plan.md) — remediation phases and the standing review pass
- [Cloudflare Costs and Guardrails](./costs-and-limits.md)
- [ADR 001: Monorepo Structure](./adr/001-monorepo-structure.md)
- [OpenAPI Spec](./api/openapi.json)
- [V1 Scope](./starter-v1-scope.md)
