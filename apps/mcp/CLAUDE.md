# @starter/mcp

## Why this exists

MCP server exposing the same capabilities as the public API to LLM clients —
the "MCP parity" convention: every `/api/v1` route gets a matching tool here.

## Architecture

- `src/index.ts` — `OAuthProvider` wrapping everything: `/mcp` + `/sse` are `apiRoute`s (bearer token required), everything else falls through to `authApp`
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
- **`database_id` must match `apps/web`.** A different id is a different database,
  locally too — wrangler keys its sqlite state by id.
- **Locally, `pnpm dev` uses `--persist-to ../web/.wrangler/state`** so both Workers
  share one local D1. Without it the MCP Worker sees an empty database, because
  `db:migrate` only applies migrations inside `apps/web`.
- **Identity comes from `ctx.user`, never from tool arguments.** `OAuthProvider`
  passes the grant's props to the Agent; a tool that trusts its own input is a bug.
- Scope every query by `ctx.user.userId`.

## Status / known gaps — read before deploying

- `OAUTH_KV` is `id: "local"` — run `wrangler kv namespace create OAUTH_KV` and paste
  the real id before deploying
- `BETTER_AUTH_SECRET` is no longer in `wrangler.jsonc` `vars` (audit #9 resolved) —
  set it locally in `.dev.vars` (start from `.dev.vars.example`) and in production
  via `wrangler secret put`, mirroring the web app
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

## Testing

- Tools are tested in `src/__tests__/` with a stubbed `McpServer` (capture the `server.tool()` registration, invoke the handler)
- **Coverage target: `src/tools/` 90%+**; `src/index.ts` and `src/auth-app.ts` are wiring, covered by the manual OAuth flow walk above
- Every tool test asserts parity with its API twin (same fields, same version source)
- Auth-bearing tools get a test proving caller-supplied identity is ignored
