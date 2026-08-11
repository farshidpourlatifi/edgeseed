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
- `migrations/` — generated SQL, never hand-edited (run `pnpm db:generate`)

## Rules

- Schema change flow: edit `src/schema/` → `pnpm db:generate` → `pnpm db:migrate` (local) → update `src/__tests__/schema.test.ts` to match
- New tables with created/updated pairs use the `timestamps` helper, not hand-rolled columns
- Known gap (security audit #13): `member`/`invitation` FKs do not cascade on delete — if you fix it, update the relational-integrity tests

## Testing

- `schema.test.ts` asserts table names, exact column sets, NOT NULL flags, FKs (including cascade behavior), unique constraints, and defaults — it exists to catch accidental drift between schema and what Better Auth needs
- **Coverage target: 100% of `src/` (excluding `migrations/`)** — everything here is declarative
- Query-level behavior is NOT tested here (no D1 in unit tests); that lives in e2e
