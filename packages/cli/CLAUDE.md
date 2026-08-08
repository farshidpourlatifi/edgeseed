# @starter/cli

## Why this exists

Dev workflow scripts run via `tsx` from the root `package.json` (`db:*`,
`api:spec`, `version:bump`). Not shipped anywhere — tooling only. Scripts
shell out via `pnpm --filter` rather than importing workspace packages, so
this package declares no workspace dependencies (shared test helpers live in
`@starter/testing`).

The one external devDependency is `better-auth`, for `hashPassword` in
`db-seed.ts`. Seeding a login-able user means writing a password hash, and the
hash must be produced by the same code sign-in verifies with — reimplementing
its scrypt parameters here would silently rot the moment Better Auth changes
them.

## Layout

- `src/db-*.ts` — wrap `wrangler d1` / `drizzle-kit` for the local database lifecycle
- `src/api-spec.ts` — renders the OpenAPI spec from `apps/web/server/api.ts` into `docs/api/openapi.json`
- `src/version-bump.ts` — bumps `packages/config/src/version.ts` + package versions, creates git tag

## Rules

- Scripts must stay idempotent and safe to re-run; destructive ones (`db-reset`) are local-only by design — never add `--remote` to them

## Testing

- **No coverage target for `src/`** — these are thin wrappers around wrangler/drizzle CLIs, exercised constantly by dev usage and e2e global-setup
