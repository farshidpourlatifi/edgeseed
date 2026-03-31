# ADR 001: Monorepo Structure and Tech Stack

**Status:** Accepted
**Date:** 2026-03-31

## Context

We need a reusable starter for Cloudflare-native product experiments. It should be buildable in a single focused session, support multiple apps sharing auth and data, and provide strong TypeScript ergonomics.

## Decision

- **Monorepo**: pnpm workspaces + Turborepo
- **Web framework**: React Router v7 + Hono via `hono-react-router-adapter`
- **API spec**: `@hono/zod-openapi` for auto-generated OpenAPI 3.1
- **Database**: Drizzle ORM + Cloudflare D1
- **Auth**: Better Auth with Drizzle adapter and organization plugin
- **MCP**: `@modelcontextprotocol/sdk` on Cloudflare Workers
- **UI**: shadcn/ui + Tailwind v4 + Radix primitives
- **Testing**: Vitest + Playwright
- **CLI**: Plain tsx scripts, no framework

## Consequences

- Single deploy unit per app (each a Cloudflare Worker)
- Shared packages for auth, db, config avoid duplication across apps
- Hono middleware layer provides API routes + context bridging to React Router
- OpenAPI spec is auto-generated and checked into git for PR review
- Better Auth's organization plugin provides multi-tenancy without custom code
- MCP server mirrors web API, keeping every action available to LLMs
