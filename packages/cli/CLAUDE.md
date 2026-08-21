# @starter/cli

## Why this exists

Dev workflow scripts run via `tsx` from the root `package.json` (`db:*`,
`api:spec`, `version:bump`). Not shipped anywhere — tooling only. Scripts
shell out via `pnpm --filter` rather than importing workspace packages, so
this package declares almost no workspace dependencies (shared test helpers
live in `@starter/testing`).

**`@starter/config` is the one exception, and only for
`canonicalRepoUrl`.** `init:product` decides what may be stamped into
`PRODUCT_REPO_URL`; the landing page decides what it will render from it. The
guarantee worth having is that those two answers are the _same_ answer — a
second copy of the rule here would drift, and the drift is precisely how a
value that passes the CLI reaches a page that cannot safely render it (a
credential in the userinfo, a `&` in a copy-paste `git clone` line). Shelling
out cannot express a shared predicate, so this one is imported. Do not grow the
exception: anything that can be a subprocess still should be.

The one external devDependency is `better-auth`, for `hashPassword` in
`db-seed.ts`. Seeding a login-able user means writing a password hash, and the
hash must be produced by the same code sign-in verifies with — reimplementing
its scrypt parameters here would silently rot the moment Better Auth changes
them.

## Layout

- `src/db-*.ts` — wrap `wrangler d1` / `drizzle-kit` for the local database lifecycle. `db-generate.ts` also rewrites the migrations it creates through `lib/d1-sql.ts`, which strips the `PRAGMA foreign_keys` that drizzle-kit emits around a foreign-key table rebuild and D1 rejects — miniflare accepts it, so nothing local catches the failure. It only touches files that run created; an applied migration is immutable.
- `src/api-spec.ts` — renders the OpenAPI spec from `apps/web/server/api.ts` into `docs/api/openapi.json`
- `src/version-bump.ts` — bumps `packages/config/src/version.ts` + package versions, regenerates the OpenAPI spec (whose `info.version` is `APP_VERSION`), then prints the tag steps
- `src/check-release-version.ts` — refuses a release tag that disagrees with `package.json` / `APP_VERSION`
- `src/check-deployed.ts` — post-deploy smoke check: the live `/api/v1/health` must report the tagged version
- `src/release-notes.ts` — turns wrangler's structured deploy output into the release-note preamble
- `src/check-boot.ts` + `src/lib/boot-check.ts` — start each **built** Worker and prove it serves. Two things here are load-bearing and easy to undo by accident. `BOOT_VARS` is the Worker's **whole** env, not an override list, and it is only whole because `BOOT_ENV_FILE` is passed to `wrangler dev --env-file`: `--var` overrides a key but does not stop wrangler loading `.dev.vars` / `.env` underneath, so without that file the check runs against whatever the developer has configured — which is how an inherited `SENTRY_DSN` once made one probe take 76 s of an 83 s run. And the check refuses a port that is already occupied rather than adopting the listener, because the readiness poll cannot tell a stale Worker from the one it just spawned and would print `boot ok` for a bundle that never started.
- `src/check-docs-sync.ts` — fails on mechanical doc drift: an undocumented root script, a stale `.dev.vars.example`, a dead relative link, an MCP tool or API path missing from the README
- `src/init-product.ts` — stamps product identity on a fresh clone. Addresses D1 through the `DB` binding rather than by database name, since a clone renames the database; `__tests__/init-product.test.ts` fails if a `db:*` script reverts to a name literal

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
