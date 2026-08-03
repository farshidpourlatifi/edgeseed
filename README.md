# Cloudflare Starter

A minimal, reusable base for Cloudflare-native product experiments.

## Prerequisites

- Node.js 22+
- pnpm 9+

## Getting Started

```bash
# Install dependencies
pnpm install

# Apply database migrations (local D1)
pnpm db:migrate

# Seed development data
pnpm db:seed

# Start development server
pnpm dev --filter @starter/web
```

The web app runs at `http://localhost:5173`.

## Project Structure

```
apps/
  web/          React Router v7 + Hono web app (Cloudflare Worker)
  mcp/          MCP server for LLM tool access (Cloudflare Worker)
packages/
  auth/         Better Auth integration (session, org, roles)
  cli/          Dev workflow scripts (db, api:spec, version:bump)
  config/       Zod-validated env and runtime config
  db/           Drizzle ORM + D1 schema and migrations
  ui/           shadcn/ui + Tailwind v4 design system
docs/
  adr/          Architecture decision records
  api/          Generated OpenAPI specs
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `pnpm dev --filter @starter/web` | Start web dev server |
| `pnpm dev --filter @starter/mcp` | Start MCP server |
| `pnpm build` | Build all workspaces |
| `pnpm typecheck` | Type check all workspaces |
| `pnpm test` | Run unit/integration tests |
| `pnpm test:e2e` | Run end-to-end tests |
| `pnpm db:generate` | Generate Drizzle migration from schema changes |
| `pnpm db:migrate` | Apply pending migrations (local D1) |
| `pnpm db:seed` | Seed development data |
| `pnpm db:reset` | Drop and re-apply all migrations locally |
| `pnpm api:spec` | Regenerate OpenAPI spec to `docs/api/openapi.json` |
| `pnpm version:bump [major\|minor\|patch]` | Bump version and create git tag |

## Key Conventions

- **Auth flow**: authenticate → resolve org context → check permission → scope data by org
- **API versioning**: public routes at `/api/v1/...`, bump only on breaking changes
- **MCP parity**: every public API route gets a matching MCP tool
- **DB migrations**: sequential Drizzle Kit migrations in `packages/db/migrations/`
- **Testing**: TDD for domain logic, e2e for critical paths (Vitest + Playwright)
- **OpenAPI**: auto-generated from zod schemas, checked into git

## Cost planning

See [Cloudflare costs and guardrails](./docs/costs-and-limits.md) for the audited resource
inventory, current Workers/D1 pricing, monthly estimates, deployment caveats, and cost-control
checklist.

## Deploying

See [Deploying in docs/README.md](./docs/README.md#deploying) for build/deploy
commands and how to obtain and set the production secrets (`BETTER_AUTH_SECRET`,
GitHub/Google OAuth credentials).

## Architecture

The web app uses **Hono** as the server middleware layer, bridged to **React Router v7** via `hono-react-router-adapter`. This gives:

- Typed API routes with OpenAPI generation (`@hono/zod-openapi`)
- Auth middleware creating db + auth context per request
- React Router loaders/actions with full access to db and auth via `AppLoadContext`

Both `apps/web` and `apps/mcp` share the same `packages/auth` and `packages/db` for consistent auth and data access.
