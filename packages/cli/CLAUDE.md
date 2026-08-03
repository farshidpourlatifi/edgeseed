# @starter/cli

## Why this exists

Dev workflow scripts run via `tsx` from the root `package.json` (`db:*`,
`api:spec`, `version:bump`) plus shared test helpers. Not shipped anywhere —
tooling only.

## Layout

- `src/db-*.ts` — wrap `wrangler d1` / `drizzle-kit` for the local database lifecycle
- `src/api-spec.ts` — renders the OpenAPI spec from `apps/web/server/api.ts` into `docs/api/openapi.json`
- `src/version-bump.ts` — bumps `packages/config/src/version.ts` + package versions, creates git tag
- `test-helpers/factory.ts` — `buildUser` / `buildOrganization` / `buildMember` row factories
- `test-helpers/fake-env.ts` — `createFakeEnv()` for Worker env in unit tests

## Rules

- Scripts must stay idempotent and safe to re-run; destructive ones (`db-reset`) are local-only by design — never add `--remote` to them
- Test helpers are exported as `@starter/cli/test-helpers/*` — packages consuming them declare a `devDependency` on `@starter/cli`
- Factories generate unique ids per call; add a factory here rather than inlining row literals in tests

## Testing

- **No coverage target for `src/`** — these are thin wrappers around wrangler/drizzle CLIs, exercised constantly by dev usage and e2e global-setup
- `test-helpers/` are validated by the suites that consume them
