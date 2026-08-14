# @starter/config

## Why this exists

Single source of truth for Worker environment validation and the app version.
Apps never read `env` raw — they parse it through these Zod schemas so a
missing or malformed binding refuses the request instead of quietly degrading.

Validation is **per request**, in `authMiddleware` and the MCP Worker's
`authFor`: Workers hand `env` to the request handler, so there is no module-init
env to validate. A rejected env throws, `observabilityErrorHandler` turns that
into a 500 with a correlation id, and nothing is served — which is the intended
outcome, not a bug to soften (`docs/security-audit.md` #3).

## Layout

- `src/env.ts` — `webEnvSchema` / `mcpEnvSchema` (both extend a shared schema) and `parseEnv()`
- `src/version.ts` — `APP_VERSION`, rewritten by `pnpm version:bump`; imported by the API health route and the MCP health tool, so those stay in sync automatically
- `src/product.ts` — product identity, rewritten by `pnpm init:product`. Anything user-visible that names the product or points at its source reads from here rather than hardcoding a string, so a clone renames itself in one place

## Rules

- Any new Worker binding MUST be added to the schema here, not just typed ad hoc in an app
- Secrets are validated for shape only (e.g. `min(32)` for `BETTER_AUTH_SECRET`) — never log or echo values
- Social login credentials stay `.optional()` — providers auto-enable on presence
- **`PRODUCT_REPO_URL` may be empty, and empty must stay renderable.** It is the
  one identity nothing derives from the slug, so `init:product` clears it unless
  `--repo` is passed. Every consumer goes through `canonicalRepoUrl`
  (`src/repo-url.ts`), never the raw constant — a direct read reintroduces both
  the wrong-link bug and a `javascript:` href (issue #32)
- **`canonicalRepoUrl` returns `parsed.href`, never its argument, and that is
  the point.** Validating with `new URL()` and keeping the input accepts
  `https:example.com/a` (renders broken) and a trailing newline (which
  `JSON.stringify` escapes, so `init:product`'s read-back check fails _after_ it
  has rewritten other files). It also refuses what normalisation cannot fix:
  userinfo, because `https://u:token@host/r` is already its own `href` and would
  publish the token; and any character with shell meaning, because the value is
  interpolated unquoted into a `git clone` line a visitor is invited to copy.
  `href` encodes spaces, backticks and braces but leaves `$ & ( ) ; * | ~ ! [ ]`
  alone, so the allowlist is not redundant with the normalisation — both halves
  are load-bearing. `@starter/cli` imports this rather than copying it; that is
  the one workspace dependency the CLI is allowed

## Testing

- Tests in `src/__tests__/`, using `createFakeEnv` from `@starter/testing/fake-env`
- **Coverage target: 100%** — this package is tiny and pure; there is no excuse
- Every schema rule (min length, url, enum, default, optionality) gets a rejecting AND an accepting case
