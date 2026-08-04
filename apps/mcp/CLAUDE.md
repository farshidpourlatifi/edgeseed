# @starter/mcp

## Why this exists

MCP server exposing the same capabilities as the public API to LLM clients —
the "MCP parity" convention: every `/api/v1` route gets a matching tool here.

## Architecture

- `src/index.ts` — `StarterMcpAgentBase` (extends `McpAgent` from the Cloudflare `agents` SDK), exported as `StarterMcpAgent` wrapped in `instrumentAgentWithSentry`; served on `/sse` and `/mcp`
- `src/tools/index.ts` — `registerTools(server, ctx)`; `ToolContext` carries `db` + `auth`
- `src/tools/health.ts` — mirrors `GET /api/v1/health`; version comes from `@starter/config/version` (never hardcode it — parity drift is a bug)

## Status / known gaps — read before deploying

- **No authentication** on the MCP surface (security audit #8). Verified 2026-08-04:
  `initialize`, `tools/list` and `tools/call` all succeed with no credentials, and
  the Agents SDK answers with `Access-Control-Allow-Origin: *`. Only `health_check`
  is exposed today, so nothing sensitive leaks — but this **must** be closed before
  any tool touches `db`.
- `wrangler.jsonc` still carries the dev placeholder secret in `vars` — real deployment needs `wrangler secret put`, mirroring the web app
- Tool surface is one tool (`health_check`), which is full parity with `/api/v1`
  today only because that API has one route

## Observability

- The Agent is instrumented separately from the fetch handler
  (`instrumentAgentWithSentry` + `sentryOptionsOrDisabled`): a Durable Object runs
  in its own context, so `withSentry` on the outer handler does **not** initialise
  Sentry inside it and tool errors would go unreported
- `wrapMcpServerWithSentry` turns each tool call into a span
- Import from `@starter/observability` (the barrel), never `/middleware` — this app
  has no Hono dependency

## Rules

- New tool = new file in `src/tools/`, registered in `registerTools`, mirroring an existing API route's zod schema and response shape
- Tool responses are `content: [{ type: "text", text: JSON.stringify(...) }]` matching the API JSON body

## Testing

- Tools are tested in `src/__tests__/` with a stubbed `McpServer` (capture the `server.tool()` registration, invoke the handler)
- **Coverage target: `src/tools/` 90%+**; `src/index.ts` (Durable Object wiring) is exercised only once actually deployable
- Every tool test asserts parity with its API twin (same fields, same version source)
