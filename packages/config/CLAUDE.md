# @starter/config

## Why this exists

Single source of truth for Worker environment validation and the app version.
Apps never read `env` raw — they parse it through these Zod schemas so a
missing/malformed binding fails loudly at startup, not silently at request time.

## Layout

- `src/env.ts` — `webEnvSchema` / `mcpEnvSchema` (both extend a shared schema) and `parseEnv()`
- `src/version.ts` — `APP_VERSION`, rewritten by `pnpm version:bump`; imported by the API health route and the MCP health tool, so those stay in sync automatically

## Rules

- Any new Worker binding MUST be added to the schema here, not just typed ad hoc in an app
- Secrets are validated for shape only (e.g. `min(32)` for `BETTER_AUTH_SECRET`) — never log or echo values
- Social login credentials stay `.optional()` — providers auto-enable on presence

## Testing

- Tests in `src/__tests__/`, using `createFakeEnv` from `@starter/testing/fake-env`
- **Coverage target: 100%** — this package is tiny and pure; there is no excuse
- Every schema rule (min length, url, enum, default, optionality) gets a rejecting AND an accepting case
