# Cloudflare Starter Kit

## What this is

Cloudflare-native monorepo starter for shipping SaaS products fast. See `docs/starter-v1-scope.md` for the full V1 spec.

## Stack

- **Runtime:** Cloudflare Workers (D1, KV, etc.)
- **Web:** React Router v7 + Hono + Tailwind v4
- **Auth:** Better Auth (email/password + org/tenancy)
- **DB:** Drizzle ORM on D1 (SQLite)
- **UI:** shadcn/ui components (unified `radix-ui` package, not individual `@radix-ui/*`)
- **Theme:** Single oklch preset from shadcn (light/dark/system), no multi-color switcher
- **Toasts:** Sonner (mounted at root layout)
- **MCP:** MCP server in `apps/mcp`, gated by OAuth 2.1 (`@cloudflare/workers-oauth-provider`)

## Monorepo layout

```
apps/web          — React Router app (Cloudflare Workers)
apps/mcp          — MCP server (Cloudflare Workers)
packages/auth     — Better Auth config, middleware, session/role helpers
packages/config   — Zod-validated env schemas, version
packages/db       — Drizzle schema, migrations, D1 client
packages/observability — structured logging, correlation IDs, Sentry
packages/testing  — shared test helpers (dependency-free by rule)
packages/ui       — shadcn/ui components, hooks, theme
packages/cli      — Dev workflow scripts (db:*, api:spec, version:bump)
docs/             — ADRs, API specs
tests/e2e         — Playwright e2e tests
```

## Key architecture decisions

### Web app server layer

`apps/web/server/index.ts` is a Hono app that:

- Runs `authMiddleware` to create db + auth per request
- Mounts Better Auth at `/api/auth/**`
- Mounts versioned API at `/api/v1`
- Passes `db` and `auth` to React Router loaders via `load-context.ts`

### Observability

`packages/observability` (see its CLAUDE.md and `docs/adr/002-observability.md`):

- `observabilityMiddleware` runs **first** in the Hono chain — request-scoped
  logger + correlation id on `c.get("logger")` / `c.get("requestId")`, also
  reachable in loaders via `context.logger` / `context.requestId`
- `app.onError(observabilityErrorHandler)` reports failures and answers with
  `{ error, requestId }` — never the internal message
- `withSentry()` wraps the Worker entry in `worker.ts` / `apps/mcp/src/index.ts`;
  no `SENTRY_DSN` means it is a pass-through
- Every log field goes through `redact()` — never `console.log` directly in
  request paths
- **Workers Logs needs `observability.enabled` in each `wrangler.jsonc`** — without
  it, logs show in `wrangler tail` but are never retained or queryable
- Cloudflare (retention 3d free / 7d paid) and Sentry (grouping, alerting,
  releases) are complementary; leaving `SENTRY_DSN` unset gives a working
  Cloudflare-only setup

### MCP authentication

`apps/mcp` is gated by OAuth 2.1 — see its CLAUDE.md and `docs/security-audit.md` #8:

- `/mcp` and `/sse` are `apiRoute`s on `OAuthProvider`; without a bearer token they
  return 401 with the `WWW-Authenticate` challenge clients follow to discovery
- It runs its **own** Better Auth instance (separate Worker, so it cannot read the
  web app's cookie) against the **same** D1 — so `database_id` must match `apps/web`
- Locally, `pnpm dev` for the MCP app uses `--persist-to ../web/.wrangler/state` so
  both Workers share one local database
- Tools read identity from `ctx.user` (the OAuth grant), **never** from tool arguments

### Routes

Defined in `apps/web/app/routes.ts` (explicit route config, not file-based routing):

- `/` — landing page
- `/login` — email/password + GitHub social login
- `/register` — with confirm password validation
- `/dashboard` — layout with sidebar, topbar, auth guard
- `/dashboard/settings` — profile (name/email)

When adding a new dashboard page: add the route in `routes.ts`, create the file in `app/routes/`, then run `npx react-router typegen` to generate types.

### UI components

All in `packages/ui/src/components/ui/`. Imported as `@starter/ui/components/ui/button` etc.

Components use the unified `radix-ui` package (e.g., `import { Dialog } from "radix-ui"`), NOT individual packages like `@radix-ui/react-dialog`.

Theme is CSS-variable-based (oklch colors) defined in `apps/web/app/app.css`. The `ThemeProvider` in `packages/ui/src/hooks/use-theme.tsx` manages light/dark/system via cookies.

### Dashboard layout

The dashboard has:

- **Sidebar** (desktop): collapsible, org switcher dropdown, nav links with active state, user dropdown, collapse button with tooltips
- **Topbar**: breadcrumbs (desktop), hamburger dropdown (mobile), theme toggle, notification bell, user menu (mobile)
- All sidebar/topbar code is inline in `dashboard.tsx` — not separate component files

### Auth in loaders

Dashboard layout loader fetches session and orgs:

```ts
const session = await context.auth.api.getSession({ headers: request.headers });
const orgs = await context.auth.api.listOrganizations({ headers: request.headers });
```

The loader returns `{ user, activeOrganizationId, organizations }` — child routes access user data through the parent layout.

### Social login (GitHub + Google)

Login/register pages have GitHub and Google social login buttons. To enable:

1. Set env vars in `wrangler.jsonc` (or Cloudflare dashboard for production):
   - `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` — get from https://github.com/settings/developers
   - `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — get from https://console.cloud.google.com/apis/credentials
2. Providers are auto-enabled when their credentials are set (conditional in `packages/auth/src/server.ts`)
3. For GitHub: set callback URL to `{BETTER_AUTH_URL}/api/auth/callback/github`
4. For Google: set authorized redirect URI to `{BETTER_AUTH_URL}/api/auth/callback/google`

## Dev commands

```bash
pnpm dev                    # Start web app dev server
pnpm db:generate            # Generate Drizzle migration
pnpm db:migrate             # Apply migrations (local)
pnpm db:seed                # Seed dev data
pnpm db:reset               # Drop and re-apply all migrations
pnpm api:spec               # Generate OpenAPI spec
pnpm api:call GET /me       # Call /api/v1 with STARTER_API_TOKEN (bearer)
pnpm version:bump [type]    # Bump version (patch/minor/major)
pnpm test                   # Run Vitest
pnpm test:e2e               # Run Playwright
pnpm test:coverage          # Vitest with coverage report (coverage/)
pnpm test:mutation          # Stryker mutation tests (reports/mutation/)
pnpm lint / lint:fix        # ESLint (flat config in eslint.config.mjs)
pnpm format / format:check  # Prettier
pnpm verify                 # Full gate: lint, format, test, gitleaks, build, typecheck, e2e
pnpm deploy:web             # verify + wrangler deploy (the gated deploy path)
pnpm init:product <name>    # Stamp product identity on a fresh clone (docs/starter-as-upstream.md)
pnpm check:docs-sync        # Fail if any root script is undocumented in READMEs
pnpm check:boot             # Boot each built Worker and prove it serves (after build)
```

## Quality gates

- Pre-commit hook (`.githooks/pre-commit`, wired by the root `prepare` script) runs
  lint-staged (eslint --fix + prettier on staged files) then a gitleaks secret scan.
  Never suggest `--no-verify`.
- CI runs gitleaks over full history on PRs and pushes to main (`.github/workflows/gitleaks.yml`).
- Deploys go through `pnpm deploy:web`, which refuses to ship unless `pnpm verify` passes.
- **`pnpm check:boot` runs inside `verify`** (after `build`/`typecheck`, before e2e).
  It starts each built Worker and asserts it serves one unauthenticated request.
  `build` proves compilation; only this proves the bundle _runs_. Without it a
  Worker that throws at module init passes the entire gate. That is not
  hypothetical — it caught exactly that on its first run: vite leaves `zod` an
  external import, wrangler resolved it to the app's zod 3, and bundled
  better-auth code called zod 4 APIs (`coerce.boolean(...).meta is not a
function`). Fixed by the zod 4 migration (`docs/security-audit.md` #1).
- **Keep zod on one major.** better-auth ≥1.6 requires zod 4 and peers on
  `drizzle-orm@^0.45.2`; `@hono/zod-openapi` must be v1.x to match. These four move
  together — pinning any one back reintroduces the boot failure above.
- **Sentry only initialises in the built Worker.** `withSentry()` is in `worker.ts`;
  `pnpm dev` mounts `server/index.ts` directly, so `captureError` no-ops on :5173.
- Secret-handling procedures are in `docs/secret-scanning.md`.

## TypeScript notes

- Web app tsconfig uses `@cloudflare/workers-types/experimental` + DOM lib
- `worker.ts` imports `./build/server` (generated by `pnpm build`, no type declarations) — the import carries a `@ts-expect-error`, so `pnpm typecheck` passes regardless of build state
- Route types are generated into `.react-router/types/` via `rootDirs`
- UI package is typechecked through the web app (not separately) since it needs DOM types

## Conventions

- **Adding a page:** Add route in `routes.ts` → create route file → run `npx react-router typegen`
- **Adding a UI component:** Place in `packages/ui/src/components/ui/` → import from `@starter/ui/components/ui/name`
- **Adding an API route:** Add to `apps/web/server/api.ts` with OpenAPI schema → add matching MCP tool in `apps/mcp`
- **Auth guard:** Use `redirect("/login")` in loader if no session (see `dashboard.tsx` loader pattern)
- **Toast notifications:** `import { toast } from "sonner"` — Toaster is already mounted at root

## Deployment

Production URL: `https://starter-web.farshid-pourlatifi-3fa.workers.dev`
D1 database ID: `510ae3cb-6a46-4409-a1db-b07b59cd504b`

### Deploy steps

```bash
# 1. Gated deploy — runs the full verify suite (lint, format, tests,
#    gitleaks, build, typecheck, e2e) and only then deploys
pnpm deploy:web

# 2. Run remote migrations (only when schema changes)
cd apps/web && npx wrangler d1 migrations apply starter-db --remote
```

Do not deploy with a raw `wrangler deploy` — that skips the verify gate.

### Secrets (set once via `wrangler secret put`)

All sensitive vars go through `wrangler secret put <NAME>` — not in `wrangler.jsonc`.

Required:

- `BETTER_AUTH_SECRET` — random 32+ char string
- `BETTER_AUTH_URL` — production URL (e.g. `https://starter-web.farshid-pourlatifi-3fa.workers.dev`)

Optional (for social login):

- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

Optional (for error reporting) — absent means Sentry is fully disabled.
Step-by-step: `docs/sentry-setup.md`. One Sentry project per Worker; environments
live inside a project, so do **not** create a project per environment.

- `SENTRY_DSN` — from your Sentry project settings
- `SENTRY_TRACES_SAMPLE_RATE` — `0`..`1`, defaults to `0` (errors only, no tracing)
- `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE` — override `ENVIRONMENT` / `APP_VERSION`
- `LOG_LEVEL` — `debug`|`info`|`warn`|`error`; defaults to `debug` in development, `info` elsewhere

### Local dev

All dev vars live in `apps/web/.dev.vars` (gitignored). Wrangler merges them automatically during `pnpm dev`.

## Route examples

`apps/web/app/routes/_examples/` contains reference implementations — rich UI pages that are NOT registered as routes. They exist as copy-paste starting points when building a product.

| File                         | What it shows                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `dashboard-with-widgets.tsx` | Stats cards, activity table with empty state, quick action cards                                  |
| `settings-full.tsx`          | Tabbed settings (General/Team/Billing), profile with avatar upload, danger zone, team member list |

To use an example: copy it to `app/routes/`, register the route in `routes.ts`, run `npx react-router typegen`, wire real data.

See `_examples/README.md` for full instructions.

## Generating new UI (design workflow)

UI is generated with V0/shadcn, not written from scratch. The workflow — V0
project URL, theme preset, prompt template, integration steps, and where
generated code goes — lives in `docs/design-workflow.md`. That file is
**product-owned**: repos extending this starter replace it with their own
design sources (see `docs/starter-as-upstream.md`); this pointer stays stable.
