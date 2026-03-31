# Starter V1 Scope

Date: 2026-03-31
Revised: 2026-03-31

## Purpose

This document defines the first internal starter kit for Cloudflare-native product experiments.

The starter is not a universal framework.
It is the smallest reusable base that lets a new product ship in days, not weeks:

- consistent architecture
- strong TypeScript ergonomics
- Cloudflare-native deployment
- AI-friendly code structure
- low token and maintenance overhead

The starter should make the first week of a new product faster.
It should not lock products into unnecessary complexity.

## Time budget

Target: completable in a single focused session (~2 hours).
If it cannot be built in that window, it is too big.

## Goals

The starter must provide:

- one monorepo structure
- one default web app shell
- one MCP server that mirrors public APIs for LLM access
- one auth and tenancy model
- one data baseline with migration workflow
- one config baseline with versioning
- one design-system foundation
- one dev CLI for common workflows

The starter must not become:

- a generic platform framework
- a heavy SaaS boilerplate
- a highly abstract enterprise architecture

## Default repo layout

```txt
apps/
  web/
  mcp/
packages/
  auth/
  cli/
  config/
  db/
  ui/
docs/
  adr/
  api/          # generated OpenAPI specs
```

Everything else gets added when a real product demands it.

## App scope

### `apps/web`

Primary React Router application.

Responsibilities:

- public marketing pages if needed
- authenticated product UI
- forms and dashboards
- route loaders and actions

Must include:

- React Router
- Tailwind
- shared UI package integration
- auth/session integration
- typed env/config loading
- OpenAPI spec generation from route definitions (see conventions below)

### `apps/mcp`

MCP server that exposes public product APIs as tools for LLMs.

Responsibilities:

- one MCP tool per public API action
- reuses the same auth, db, and domain logic as the web app
- deployed as a Cloudflare Worker

Must include:

- MCP server scaffold (TypeScript SDK)
- tool registration pattern that mirrors web routes
- shared auth/session validation with `packages/auth`
- typed inputs and outputs via zod

Convention:
When you add a public API route in `apps/web`, add a matching MCP tool in `apps/mcp`.
This keeps every product action available to both humans and LLMs from day one.

Should not include:

- MCP resources or prompts in v1 (add when needed)
- separate data layer — reuse `packages/db`

## Package scope

### `packages/auth`

Purpose:
Centralize authentication, session handling, and basic tenancy.

Must include:

- Better Auth integration
- user model
- organization or workspace model
- membership model
- session helpers
- role helpers

Should not include:

- invitation flows (add when needed)
- app-specific business permissions
- billing logic

### `packages/db`

Purpose:
Database schema, migrations, and typed query utilities.

Must include:

- Drizzle setup for D1
- migration workflow
- base tables:
  - users
  - organizations
  - memberships
- helpers for transactions and timestamps

Should not include:

- generic repository abstractions
- tables for features that do not exist yet

### `packages/ui`

Purpose:
Minimal design-system foundation.

Must include:

- Tailwind setup
- CSS variable tokens
- shadcn-compatible component structure
- base primitives:
  - button
  - input
  - textarea
  - select
  - card
  - dialog
  - toast
  - form helpers
- layout primitives:
  - page shell
  - stack
  - empty state
  - loading state

Theme support must include:

- neutral default theme
- per-project token overrides
- semantic tokens for color, radius, spacing, and typography

V1 should not include:

- marketing site block library
- many branded templates
- dozens of optional components

### `packages/cli`

Purpose:
Dev workflow commands for the monorepo.

Must include:

- `db:generate` — generate a Drizzle migration from schema changes
- `db:migrate` — apply pending migrations (local D1 and remote)
- `db:seed` — seed dev data
- `db:reset` — drop and re-apply all migrations locally
- `api:spec` — regenerate OpenAPI spec to `docs/api/openapi.json`
- `version:bump` — bump semver in root `package.json` and create git tag
- `test` / `test:e2e` — run Vitest / Playwright

Convention:
Use a thin script runner (e.g. `tsx` scripts or a lightweight CLI like `citty`).
Do not build a plugin framework. Each command is a standalone script registered in `package.json`.

Should not include:

- codegen beyond migrations (add per product)
- deploy orchestration (use `wrangler` directly)

### `packages/config`

Purpose:
Centralize typed environment and runtime configuration.

Must include:

- zod-validated env parsing
- per-app config shape
- auth config
- versioning config (see conventions below)

## Starter conventions

### Authorization convention

- authenticate first
- resolve organization context
- check permission explicitly
- scope data access by organization

### Data access convention

- use typed query files
- keep queries close to the feature
- avoid generic repositories unless repeated patterns prove the need

### Error handling convention

- throw typed domain errors where useful
- translate to route-safe responses at the edge

### API versioning convention

- all public API routes are prefixed with a version: `/api/v1/...`
- MCP tool names include the version namespace when breaking changes occur
- bump the version only on breaking changes — do not pre-create v2
- old versions are kept alive until no active consumer depends on them

### DB migration convention

- use Drizzle Kit for all schema changes
- one migration per logical change
- migrations are checked into `packages/db/migrations/`
- each migration file is numbered sequentially (e.g. `0001_create_users.sql`)
- local dev: `cli db:migrate` applies against local D1
- production: `wrangler d1 migrations apply` in CI or manual deploy
- never edit a migration that has been applied to production

### OpenAPI convention

- public API routes produce an OpenAPI 3.1 JSON spec
- spec is auto-generated from zod schemas and route metadata (e.g. via `hono-zod-openapi` or equivalent)
- generated spec is written to `docs/api/openapi.json`
- `cli api:spec` regenerates the spec
- spec is checked into git so it can be reviewed in PRs
- internal-only routes (admin, internal RPCs) are excluded from the public spec
- internal APIs rely on typed zod contracts only — no separate OpenAPI spec in v1

### Documentation convention

In-code:

- JSDoc on every exported function, type, and class in `packages/`
- no JSDoc required on internal/private helpers
- keep comments short — explain *why*, not *what*

In `docs/`:

- `docs/adr/` — architecture decision records (one file per decision)
- `docs/api/` — generated OpenAPI specs
- `docs/README.md` — project overview, setup instructions, and dev workflow
- no other doc files in v1 — add guides only when onboarding a second contributor

### Testing convention

Strategy:

- TDD for domain and business logic (write the test first, then the implementation)
- scenario-style test names everywhere (BDD-flavored naming, no heavy BDD framework)
- e2e tests for critical user paths only (auth flow, core happy path)
- do not aim for high coverage numbers — test what matters

Test types in v1:

- **unit**: pure functions, domain logic, validators — fast, no I/O
- **integration**: db queries, auth flows — run against local D1
- **e2e**: critical user journeys — Playwright against local dev server

Tooling:

- Vitest for unit and integration tests
- Cloudflare Workers test pool for Worker-specific integration tests
- Playwright for e2e tests
- test files live next to the code they test (`*.test.ts`)
- shared test helpers (factories, fixtures, fake env) live in `packages/cli/test-helpers/` until there is enough to justify a separate package

Naming convention:

- describe blocks: the module or function under test
- test names: `should <expected behavior> when <condition>` or `<scenario description>`
- example: `should reject login when session is expired`

What to skip in v1:

- contract tests (add when there are cross-service boundaries)
- acceptance test suite (add when there is a QA process)
- snapshot tests (rarely useful, high maintenance)
- visual regression tests

### App release versioning convention

- single version for the whole monorepo (not per-package)
- use semver: `MAJOR.MINOR.PATCH`
- version lives in root `package.json`
- tag releases in git: `v1.0.0`
- `cli version:bump` helper for patch/minor/major (updates `package.json` and creates git tag)
- no changelog automation in v1 — write release notes manually when needed

## Deferred to V2

Only add these when a real product creates pressure:

- `apps/jobs` (queues, workflows, scheduled tasks)
- `packages/observability` (Sentry, structured logging, correlation IDs)
- `packages/contracts` (shared zod DTOs across boundaries)
- `packages/domain` (shared pure business logic)
- `packages/modules` (feature-module convention and starter modules)
- invitation flow in auth
- audit logging
- file storage
- billing and subscription system
- notification module
- internationalization
- advanced RBAC editor UI
- contract tests and acceptance test suite
- internal API OpenAPI spec
- MCP resources and prompts

## Implementation order

1. Monorepo skeleton and toolchain
2. `packages/config`
3. `packages/db` (schema, migrations, CLI commands)
4. `packages/auth`
5. `packages/cli` (db, api:spec, version:bump, test commands)
6. `apps/web` (shell with auth wired, OpenAPI generation)
7. `apps/mcp` (scaffold mirroring web routes)
8. `packages/ui` (base primitives)
9. Docs baseline (`docs/README.md`, first ADR, generated OpenAPI spec)
10. Test baseline (Vitest config, one integration test, one e2e test)

## Success criteria

The starter is successful when a new product can be created by:

- adding routes and queries to `apps/web`
- adding matching MCP tools in `apps/mcp`
- applying a product theme override to `packages/ui`
- running `cli test` and `cli test:e2e` against the new feature
- shipping without redesigning auth, data, config, or API tooling from scratch

If the starter makes simple products harder to build, it has become too heavy and should be reduced.
