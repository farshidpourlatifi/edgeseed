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

| Command | What it does |
|---------|-------------|
| `pnpm dev --filter @starter/web` | Start web dev server on :5173 |
| `pnpm db:generate` | Generate migration from schema changes |
| `pnpm db:migrate` | Apply migrations to local D1 |
| `pnpm db:seed` | Insert seed data |
| `pnpm db:reset` | Drop and re-apply all migrations |
| `pnpm api:spec` | Regenerate `docs/api/openapi.json` |
| `pnpm test` | Run Vitest |
| `pnpm test:e2e` | Run Playwright e2e tests |
| `pnpm version:bump [type]` | Bump version + git tag |

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

# Set production secrets
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
```

For production OAuth apps, use your real domain for callback URLs.

## Further reading

- [ADR 001: Monorepo Structure](./adr/001-monorepo-structure.md)
- [OpenAPI Spec](./api/openapi.json)
- [V1 Scope](./starter-v1-scope.md)
