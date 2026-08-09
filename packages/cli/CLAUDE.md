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
- `src/version-bump.ts` — bumps `packages/config/src/version.ts` + package versions, regenerates the OpenAPI spec (whose `info.version` is `APP_VERSION`), then prints the tag steps
- `src/check-release-version.ts` — refuses a release tag that disagrees with `package.json` / `APP_VERSION`
- `src/check-deployed.ts` — post-deploy smoke check: the live `/api/v1/health` must report the tagged version
- `src/release-notes.ts` — turns wrangler's structured deploy output into the release-note preamble

## Rules

- Scripts must stay idempotent and safe to re-run; destructive ones (`db-reset`) are local-only by design — never add `--remote` to them
- **Read wrangler's structured output, never its console text.** `release-notes`
  and `check-deployed` both parse the NDJSON at `WRANGLER_OUTPUT_FILE_PATH`
  (`{ type: "deploy", version_id, targets }`). The human-readable output is not
  a contract. Take the **last** deploy record: wrangler appends, and
  `deploy:web` runs the whole verify gate — which drives wrangler — first.
- **`version-bump.ts` must never create the tag.** It runs before the bump is
  committed, so any tag it made would point at the previous commit — and a
  pushed tag is what deploys (`.github/workflows/release.yml`), so that tag
  ships the old `APP_VERSION` under the new version's name. It prints the
  steps instead.

## Testing

- **No coverage target for `src/`** — these are thin wrappers around wrangler/drizzle CLIs, exercised constantly by dev usage and e2e global-setup
