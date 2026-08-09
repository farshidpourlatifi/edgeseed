# EdgeSeed

A minimal, reusable base for Cloudflare-native product experiments.

## Prerequisites

- Node.js 22+
- pnpm 9+

## Getting Started

```bash
# Install dependencies
pnpm install

# Local env — required. Without it every request answers 500, because the env
# is validated on each one and fails closed. Fill in BETTER_AUTH_SECRET
# (`openssl rand -hex 32`) and BETTER_AUTH_URL=http://localhost:5173
cp apps/web/.dev.vars.example apps/web/.dev.vars

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
  email/        Transactional email — EmailSender port + Resend transport
  observability/ Structured logging, correlation ids, Sentry wiring
  testing/      Shared test helpers (factories, fake env) — dependency-free
  ui/           shadcn/ui + Tailwind v4 design system
docs/
  adr/          Architecture decision records
  api/          Generated OpenAPI specs
```

## CLI Commands

| Command                                   | Description                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm dev --filter @starter/web`          | Start web dev server                                                             |
| `pnpm dev --filter @starter/mcp`          | Start MCP server                                                                 |
| `pnpm build`                              | Build all workspaces                                                             |
| `pnpm typecheck`                          | Type check all workspaces                                                        |
| `pnpm test`                               | Run unit/integration tests                                                       |
| `pnpm test:e2e`                           | Run end-to-end tests                                                             |
| `pnpm test:coverage`                      | Unit tests with coverage report (`coverage/`)                                    |
| `pnpm test:mutation`                      | Stryker mutation tests (`reports/mutation/`)                                     |
| `pnpm lint` / `pnpm lint:fix`             | ESLint check / autofix                                                           |
| `pnpm format` / `pnpm format:check`       | Prettier write / check                                                           |
| `pnpm verify`                             | Full gate: lint, format, tests, gitleaks, build, typecheck, e2e                  |
| `pnpm deploy:web`                         | Run `verify`, then deploy the web app to Cloudflare                              |
| `pnpm deploy:web:ungated`                 | The deploy half alone — CI uses it to scope credentials; never run by hand       |
| `pnpm db:generate`                        | Generate Drizzle migration from schema changes                                   |
| `pnpm db:migrate`                         | Apply pending migrations (local D1)                                              |
| `pnpm db:seed`                            | Seed development data                                                            |
| `pnpm db:reset`                           | Drop and re-apply all migrations locally                                         |
| `pnpm api:spec`                           | Regenerate OpenAPI spec to `docs/api/openapi.json`                               |
| `pnpm api:call <METHOD> <path> [body]`    | Call `/api/v1` with `STARTER_API_TOKEN` (see [API tokens](#api-tokens))          |
| `pnpm version:bump [major\|minor\|patch]` | Bump version, then print the tag steps that cut a release                        |
| `pnpm check:release-version <tag>`        | Refuse a release tag that disagrees with `package.json` / `APP_VERSION`          |
| `pnpm check:deployed <output> <version>`  | Assert the deployed origin's `/api/v1/health` reports that version               |
| `pnpm release:notes <output>`             | Release-note preamble from wrangler's structured deploy output                   |
| `pnpm init:product <name>`                | Stamp product identity on a fresh clone ([guide](./docs/starter-as-upstream.md)) |
| `pnpm check:docs-sync`                    | Fail on drift: undocumented scripts, stale `.dev.vars.example`                   |
| `pnpm check:boot`                         | Start each **built** Worker and prove it serves a request (run after `build`)    |

## Key Conventions

- **Auth flow**: authenticate → resolve org context → check permission → scope data by org
- **API versioning**: public routes at `/api/v1/...`, bump only on breaking changes
- **MCP parity**: every public API route gets a matching MCP tool, behind OAuth 2.1;
  tools read identity from the grant (`ctx.user`), never from tool arguments
- **DB migrations**: sequential Drizzle Kit migrations in `packages/db/migrations/`
- **Testing**: TDD for domain logic, e2e for critical paths (Vitest + Playwright)
- **OpenAPI**: auto-generated from zod schemas, checked into git
- **Observability**: structured logs and an `x-request-id` on every request; never
  `console.log` in a request path — use `c.get("logger")` / `context.logger`

## Code quality

- **ESLint + Prettier** — flat config in `eslint.config.mjs`, settings in `.prettierrc`
- **Pre-commit hook** (`.githooks/`, wired automatically by `pnpm install`) — runs
  lint-staged (ESLint + Prettier on staged files) and a [gitleaks](./docs/secret-scanning.md)
  secret scan before every commit
- **CI** — every PR and push to `main` runs lint, format, tests, build, typecheck, e2e,
  a full-history gitleaks scan, and drift checks (OpenAPI spec, docs-vs-scripts); a weekly
  cron rerun catches rot between commits
- **Deploys are gated** — `pnpm deploy:web` refuses to ship unless `pnpm verify` passes
- **Releases are the deploy** — pushing a `v*` tag runs the same gate, deploys, and
  then cuts a GitHub Release naming the live Cloudflare Version ID (see
  [Deploying](#deploying))

## API tokens

`/api/v1` accepts either an interactive session cookie or a bearer token, resolved
into a single `principal` by `principalMiddleware`.

Mint a token in **Dashboard → Settings → API tokens**; it is shown once. Then:

```bash
STARTER_API_TOKEN='sk_...' pnpm api:call GET /me
```

Note the token _cannot_ mint further tokens — `pnpm api:call POST /tokens` always
authenticates as a token principal and is rejected with 403 by design. Creating and
revoking tokens is a session-only operation, so it happens in the dashboard.

- **Only the SHA-256 hash is stored.** The plaintext is returned exactly once at
  creation and is unrecoverable afterwards.
- **Token management is session-only.** You cannot mint or revoke tokens _using_ a
  token — otherwise one leaked CI credential becomes permanent self-renewing access
  that revoking the original would not stop.
- **A present-but-invalid bearer token is rejected, never downgraded** to whatever
  cookie happens to be attached.
- Revocation is a `revokedAt` stamp, not a delete, so the audit trail survives.

`STARTER_API_URL` overrides the target host (default `http://localhost:5173`).

## MCP server

`apps/mcp` exposes the same surface to LLM clients over the Model Context
Protocol, behind OAuth 2.1 with dynamic client registration — so you point a
client at the URL and it discovers, registers and authorizes itself:

```bash
claude mcp add --transport http starter https://<your-mcp-worker>.workers.dev/mcp
```

For clients without native remote-MCP support, bridge with `mcp-remote`. Tools
today are `health_check` and `whoami`, mirroring `/api/v1/health` and
`/api/v1/me`; identity always comes from the OAuth grant, never a tool argument.

It is a separate Worker sharing the **same** D1 as the web app, so accounts carry
over — which means both `wrangler.jsonc` files must name the same `database_id`.
It ships undeployed on purpose (the Agent is a Durable Object, billed by
duration). Client config, the full OAuth flow, the deploy checklist and
troubleshooting: **[docs/mcp.md](./docs/mcp.md)**.

```bash
pnpm dev --filter @starter/mcp   # :8788, shares apps/web's local D1
curl -i http://localhost:8788/mcp # expect 401 + WWW-Authenticate — that's the entry point
```

## Observability

Structured logging and error reporting live in `@starter/observability` and are wired
into both Workers. See [ADR 002](./docs/adr/002-observability.md) for the design.

Every request emits JSON that Cloudflare Workers Logs indexes as queryable fields:

```json
{
  "requestId": "trace-me-123",
  "env": "production",
  "version": "0.1.0",
  "method": "GET",
  "path": "/api/v1/health",
  "status": 200,
  "durationMs": 3,
  "level": "info",
  "msg": "request.complete"
}
```

- **Correlation ids** — reuses an inbound `x-request-id`, else `cf-ray`, else mints one.
  Returned on every response (API and HTML), so a user can quote it in a bug report.
- **Redaction is automatic** — passwords, tokens, cookies, API keys and DSNs are blanked
  before anything is written. Errors are expanded, cycles broken, depth capped.
- **Error responses** carry `{ error, requestId }` — the internal message is never leaked.

Logging works with no configuration. Sentry is **opt-in**: leave `SENTRY_DSN` unset and
`withSentry()` is a pass-through, so a fresh clone needs no Sentry account. To turn it
on, follow [Sentry setup](./docs/sentry-setup.md) — one project per Worker, keys into
`.dev.vars` locally and `wrangler secret put` in production.

| Variable                    | Default                             | Purpose                                |
| --------------------------- | ----------------------------------- | -------------------------------------- |
| `LOG_LEVEL`                 | `debug` in development, else `info` | `debug` \| `info` \| `warn` \| `error` |
| `SENTRY_DSN`                | unset — Sentry disabled             | Enables error reporting                |
| `SENTRY_TRACES_SAMPLE_RATE` | `0` (errors only)                   | `0`..`1` fraction of requests traced   |
| `SENTRY_ENVIRONMENT`        | falls back to `ENVIRONMENT`         | Sentry `environment` tag               |
| `SENTRY_RELEASE`            | falls back to `APP_VERSION`         | Sentry `release` tag                   |

`SENTRY_DSN` is set with `wrangler secret put`, never in `wrangler.jsonc`.

**Cloudflare vs Sentry** — they are complementary. Workers Logs retains 3 days (free) or
7 days (paid); Sentry adds error grouping, alerting, and release tracking beyond that
window. Retention only works with `observability.enabled` set in each `wrangler.jsonc` —
without it, logs appear in `wrangler tail` but are never stored.

## Cost planning

See [Cloudflare costs and guardrails](./docs/costs-and-limits.md) for the audited resource
inventory, current Workers/D1 pricing, monthly estimates, deployment caveats, and cost-control
checklist.

## Deploying

Production deploys are **tag-triggered**. Pushing a `v*` tag runs
`.github/workflows/release.yml`, which verifies the tag against `APP_VERSION`,
runs the full `pnpm verify` gate, deploys, requests the live `/api/v1/health`
until it reports the tagged version, and only then creates the GitHub Release —
so a release records a deploy that actually happened _and works_.

```bash
# Schema change? Apply the additive migration first (see AGENTS.md).
pnpm version:bump patch                # writes package.json + APP_VERSION
git commit -am "chore(release): v0.1.1"
git push origin HEAD
git tag -a v0.1.1 -m "v0.1.1"          # annotated: --follow-tags skips lightweight tags
git push origin v0.1.1                 # this is what deploys
```

Needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub Actions
secrets — step-by-step in
[Cloudflare API token](./docs/cloudflare-api-token.md). `pnpm deploy:web` still deploys from a laptop, but leaves no release
behind — it is the escape hatch for when CI is the broken thing.

See [Deploying in docs/README.md](./docs/README.md#deploying) for build/deploy
commands and how to obtain and set the production secrets (`BETTER_AUTH_SECRET`,
GitHub/Google OAuth credentials), and
[AGENTS.md § Cutting a release](./AGENTS.md#cutting-a-release) for what each
guard in the workflow is protecting against.

## Architecture

The web app uses **Hono** as the server middleware layer, bridged to **React Router v7** via `hono-react-router-adapter`. This gives:

- Typed API routes with OpenAPI generation (`@hono/zod-openapi`)
- Auth middleware creating db + auth context per request
- React Router loaders/actions with full access to db and auth via `AppLoadContext`

Both `apps/web` and `apps/mcp` share the same `packages/auth` and `packages/db` for consistent auth and data access.

## License

[MIT](./LICENSE) — use it, fork it, ship proprietary products on top of it.

The UI components in `packages/ui/src/components/ui/` are adapted from
[shadcn/ui](https://ui.shadcn.com), also MIT.
