# @starter/mcp

## Why this exists

MCP server exposing the same capabilities as the public API to LLM clients —
the "MCP parity" convention: every `/api/v1` route gets a matching tool here.

## Architecture

- `src/index.ts` — `OAuthProvider` wrapping everything: `/mcp` is the only `apiRoute` (bearer token required; the `/sse` special-case never actually served SSE and was removed — see the comment in `index.ts`), everything else falls through to `authApp`
- `src/agent.ts` — `StarterMcpAgentBase` (extends `McpAgent`), exported as `StarterMcpAgent` wrapped in `instrumentAgentWithSentry`; bound as the `MCP_OBJECT` Durable Object
- `src/auth-app.ts` — Hono app: Better Auth on this origin, plus the `/authorize` login + consent screens
- `src/env.ts` — `Env` bindings, including the `OAUTH_PROVIDER` helpers that the provider injects at runtime (not a wrangler binding)
- `src/tools/index.ts` — `registerTools(server, ctx)`; `ToolContext` carries `db` + `user`
- `src/tools/health.ts` — mirrors `GET /api/v1/health`; version comes from `@starter/config/version` (never hardcode it — parity drift is a bug)
- `src/tools/whoami.ts` — reports the principal behind the access token

## Auth

OAuth 2.1 via `@cloudflare/workers-oauth-provider`. Verified end to end 2026-08-04:
unauthenticated `/mcp` → 401 + `WWW-Authenticate`; discovery → dynamic registration
→ login → consent → PKCE code exchange → authenticated `tools/call`; bogus token → 401.

- **`apps/mcp` runs its OWN Better Auth instance.** It is a separate Worker from
  `apps/web` and cannot read that origin's session cookie, so users sign in again
  here. Same D1, same `BETTER_AUTH_SECRET`, same user rows — separate cookie.
  `baseURL` is derived from the request origin, so no extra binding is needed.
- **`authFor` validates the env before constructing anything, and must keep
  doing so.** Sharing the secret means sharing the failure mode: a session forged
  against a lenient MCP Worker is honoured by the web app too, so this side
  cannot be the permissive one (`docs/security-audit.md` #3).
  **`pnpm check:boot` covers this as of 2026-08-09, through a second request.**
  Readiness is still polled on `/`, which answers from static metadata and must
  stay env-independent — the boot check depends on that, and the tests in
  `src/__tests__/auth-app.test.ts` pin it. The coverage comes from `envProbe`
  on the MCP boot target (`packages/cli/src/lib/boot-check.ts`), which then
  requests `/api/auth/ok` and requires a 2xx. That is the request that reaches
  `authFor`, so a **binding renamed in `wrangler.jsonc`** now fails the gate
  instead of passing it. Verified by renaming `RATE_LIMIT_MAIL` and watching
  the check report HTTP 500.
  The unit deny-path tests still earn their place: they inject a fake env, so
  they cover schema rules the wrangler config cannot express.
- **`database_id` must match `apps/web`.** A different id is a different database,
  locally too — wrangler keys its sqlite state by id.
- **Locally, `pnpm dev` uses `--persist-to ../web/.wrangler/state`** so both Workers
  share one local D1. Without it the MCP Worker sees an empty database, because
  `db:migrate` only applies migrations inside `apps/web`.
- **`/authorize`'s login form rate limits itself, and must keep doing so.** It
  signs users in through `auth.api.signInEmail`, and Better Auth applies its
  limiter in the HTTP router's `onRequest` hook — which `auth.api.*` never
  reaches. Limiting `/api/auth/**` alone would leave an unlimited
  password-guessing oracle one path over, against the same users and the same
  secret as apps/web (`docs/security-audit.md` #4).
- **Identity comes from `ctx.user`, never from tool arguments.** `OAuthProvider`
  passes the grant's props to the Agent; a tool that trusts its own input is a bug.
- Scope every query by `ctx.user.userId`.

## Status / known gaps — read before deploying

- `OAUTH_KV` is `id: "local"` — run `wrangler kv namespace create OAUTH_KV` and paste
  the real id before deploying. **`mcpEnvSchema` validates the binding's _name_,
  not its id**, so a renamed binding now fails `pnpm check:boot` while a
  placeholder id still deploys quietly and loses every grant. The id remains a
  release-checklist item, not something the gate can catch
- `BETTER_AUTH_SECRET` is no longer in `wrangler.jsonc` `vars` (audit #9 resolved) —
  set it locally in `.dev.vars` (start from `.dev.vars.example`) and in production
  via `wrangler secret put`, mirroring the web app
- **No `Origin` allowlist, and no explicit `corsOptions`** — so `McpAgent.serve`
  inherits the SDK default of `Access-Control-Allow-Origin: *`. Requiring a bearer
  token blocks the practical DNS-rebinding attack, which is why this is not
  urgent, but the MCP spec asks for the header check on HTTP transports
  regardless. This is the **one remaining gap** in `docs/security-audit.md` #8
  (`security-plan.md` Phase 4 item 3); the foreign-`Origin` deny test ships with
  the fix
- The consent POST relies on Better Auth's `SameSite=Lax` session cookie rather than
  an explicit CSRF token; add one if the consent screen ever grants more than `mcp`
- Tool surface is `health_check` + `whoami`, which is parity with `/api/v1` today
  only because that API has one route

## Observability

- The Agent is instrumented separately from the fetch handler
  (`instrumentAgentWithSentry` + `sentryOptionsOrDisabled`): a Durable Object runs
  in its own context, so `withSentry` on the outer handler does **not** initialise
  Sentry inside it and tool errors would go unreported
- `wrapMcpServerWithSentry` turns each tool call into a span
- Import from `@starter/observability` (the barrel), never `/middleware` — the
  barrel is deliberately Hono-free

## Rules

- New tool = new file in `src/tools/`, registered in `registerTools`, mirroring an existing API route's zod schema and response shape
- Tool responses are `content: [{ type: "text", text: JSON.stringify(...) }]` matching the API JSON body
- **This app's `build` declares `"outputs": []` in `turbo.json`.** The build is
  a dry-run deploy: it validates and bundles without writing anything, so the
  repo-wide `build/**`/`dist/**` globs match nothing and turbo warns on every
  run. Empty is the accurate answer, not a workaround — give it real outputs
  only if the script grows an `--outdir`.

## Testing

- Tools are tested in `src/__tests__/` with a stubbed `McpServer` (capture the `server.tool()` registration, invoke the handler)
- **Coverage target: `src/tools/` 90%+**; `src/index.ts` and `src/auth-app.ts` are wiring, covered by the manual OAuth flow walk above
- Every tool test asserts parity with its API twin (same fields, same version source)
- Auth-bearing tools get a test proving caller-supplied identity is ignored
