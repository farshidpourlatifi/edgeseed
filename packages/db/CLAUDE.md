# @starter/db

## Why this exists

Drizzle ORM schema + D1 client shared by the web and MCP workers. The schema
mirrors what Better Auth expects (user/session/account/verification) plus the
organization plugin tables (organization/member/invitation) — column names are
load-bearing for Better Auth, do not rename them casually.

## Layout

- `src/schema/*.ts` — one table per file, re-exported from `schema/index.ts`
- `src/helpers/timestamps.ts` — shared `createdAt`/`updatedAt` column pair
- `src/client.ts` — `createDb(d1)` returns the typed Drizzle instance (`Database` type)
- `migrations/` — generated SQL, never hand-edited (run `pnpm db:generate`). The
  generator **rewrites** what drizzle-kit produces: SQLite turns any foreign-key
  change into a table rebuild wrapped in `PRAGMA foreign_keys=OFF`/`ON`, which
  D1 rejects, and miniflare accepts — so the failure is invisible until the
  remote migration. `packages/cli/src/lib/d1-sql.ts` strips it and explains why
  that is safe. Do not restore a stripped pragma.

## Rules

- Schema change flow: edit `src/schema/` → `pnpm db:generate` → `pnpm db:migrate` (local) → update `src/__tests__/schema.test.ts` to match
- New tables with created/updated pairs use the `timestamps` helper, not hand-rolled columns
- Every foreign key declares an `onDelete`, and `schema.test.ts` asserts the complete set — adding one without deciding its delete behavior fails there (security audit #13, closed 2026-08-12)
- Index rule: **every foreign-key child column** (an unindexed child scans on every cascade delete) **plus named non-key lookups**. The index set is asserted exactly, so a new index needs a stated consumer and a missing one fails — see the `why` field in `schema.test.ts`

## Testing

- `schema.test.ts` asserts table names, exact column sets, NOT NULL flags, FKs (including cascade behavior), unique constraints, and defaults — it exists to catch accidental drift between schema and what Better Auth needs
- **Coverage target: 100% of `src/` (excluding `migrations/`)** — everything here is declarative
- Query-level behavior is NOT tested here (no D1 in unit tests); that lives in e2e
