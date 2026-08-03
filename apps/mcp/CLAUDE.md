# @starter/mcp

## Why this exists

MCP server exposing the same capabilities as the public API to LLM clients —
the "MCP parity" convention: every `/api/v1` route gets a matching tool here.

## Architecture

- `src/index.ts` — `StarterMcpAgent` (extends `McpAgent` from the Cloudflare `agents` SDK) served on `/sse` and `/mcp`
- `src/tools/index.ts` — `registerTools(server, ctx)`; `ToolContext` carries `db` + `auth`
- `src/tools/health.ts` — mirrors `GET /api/v1/health`; version comes from `@starter/config/version` (never hardcode it — parity drift is a bug)

## Status / known gaps — read before deploying

- **NOT deployable as-is**: `McpAgent` is a Durable Object, but `wrangler.jsonc` declares no `durable_objects` binding or migration — `/sse` and `/mcp` fail at runtime
- **No authentication** on the MCP surface (security audit #8)
- `wrangler.jsonc` still carries the dev placeholder secret in `vars` — real deployment needs `wrangler secret put`, mirroring the web app

## Rules

- New tool = new file in `src/tools/`, registered in `registerTools`, mirroring an existing API route's zod schema and response shape
- Tool responses are `content: [{ type: "text", text: JSON.stringify(...) }]` matching the API JSON body

## Testing

- Tools are tested in `src/__tests__/` with a stubbed `McpServer` (capture the `server.tool()` registration, invoke the handler)
- **Coverage target: `src/tools/` 90%+**; `src/index.ts` (Durable Object wiring) is exercised only once actually deployable
- Every tool test asserts parity with its API twin (same fields, same version source)
