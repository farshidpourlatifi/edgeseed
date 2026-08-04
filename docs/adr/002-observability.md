# ADR 002: Observability (structured logging + Sentry)

**Status:** Accepted
**Date:** 2026-08-04

## Context

The starter had no logging layer: one `console.error` in `entry.server.tsx` and
`console.log` in CLI scripts. A failure in production left no request context,
no correlation id, and no error report. `docs/starter-v1-scope.md` had already
reserved `packages/observability` for this.

Constraints specific to this stack:

- Cloudflare Workers give you `console.*` and Workers Logs — there is no file
  sink and no long-lived process to buffer in.
- Two Workers (`apps/web`, `apps/mcp`) plus shared packages need the same layer,
  so an app-local util would force a cross-app relative import.
- The web Worker serves both a Hono API and React Router SSR from one handler.

## Decision

**A package, `@starter/observability`**, not a util.

- **Structured logging** via `createLogger()`, emitting the entry _object_ to
  `console.*`. Workers Logs indexes object properties as queryable fields; a
  pre-stringified JSON line arrives as one opaque message.
- **Redaction is not optional** — every field passes through `redact()`, which
  blanks sensitive keys, expands `Error`s, breaks cycles, and caps depth/width.
- **Correlation ids**: reuse inbound `x-request-id`, else `cf-ray`, else mint a
  uuid. Inbound values are attacker-controlled, so anything outside a
  conservative token charset is _replaced_, not sanitised. Echoed back as
  `x-request-id` on API and HTML responses alike.
- **Sentry via `@sentry/cloudflare`'s `withSentry()`** at the Worker entry, not
  the Hono middleware. It wraps the whole `fetch` handler, so it covers Hono
  routes _and_ React Router SSR, and auto-instruments the D1 binding.
- **Sentry is opt-in**: no `SENTRY_DSN` ⇒ `sentryOptions()` returns `undefined`
  ⇒ `withSentry()` is a pass-through. A fresh clone runs with no Sentry account.
- **Logs become Sentry breadcrumbs**, so an error report carries the request's
  log trail instead of a bare stack.

### Why both Cloudflare Workers Logs _and_ Sentry

They are complementary, not competing, and the split is deliberate:

- **Workers Logs** (`observability.enabled = true` in each wrangler config —
  without that flag nothing is retained) ingests the structured entries and makes
  them filterable. Free tier: 200k events/day, **3-day retention**. Paid: 20M/month
  included, then $0.60/million, **7-day retention**.
- **Sentry** supplies what Workers Logs does not: error _grouping_ (10k occurrences
  of one bug become one issue, not 10k lines), alerting on new and regressed
  issues, release tracking, breadcrumbs, and user-impact counts.

The 3–7 day retention ceiling is the deciding factor: a bug a customer reports two
weeks later has already aged out of Workers Logs entirely.

Because Sentry is opt-in, a Cloudflare-only setup is the _default_ — leave
`SENTRY_DSN` unset and you get full structured logging in Workers Logs for free,
with no Sentry account and no behaviour change.

A third path exists and is worth revisiting: Cloudflare can export OTel logs and
traces straight to Sentry, which would drop the SDK from the bundle. Not taken
here because the SDK gives richer context (scope tags, breadcrumbs, per-tool MCP
spans) that a log drain cannot reconstruct.

### Rejected alternatives

- **`@sentry/hono`'s `sentry()` middleware** — it initialises the SDK itself, so
  using it _and_ `withSentry` would double-init. It also only covers what flows
  through Hono, missing SSR render errors.
- **`honoIntegration()` / `instrumentD1WithSentry()`** — both deprecated in
  `@sentry/cloudflare` 10.x. `withSentry` instruments D1 automatically, and an
  explicit `app.onError` handler replaces the Hono integration with less magic.
- **`AsyncLocalStorage` for ambient request context** — would have required
  adding `"node"` to the `types` array of both apps, risking `@types/node` vs
  `workers-types`/DOM global conflicts. React Router's `handleError` receives the
  load context instead, so the logger is threaded explicitly.

## Consequences

- Every request emits `request.start` (debug) and `request.complete`
  (info/warn/error by status) with `requestId`, `env`, `version`, `method`,
  `path`, `status`, `durationMs`.
- `observabilityMiddleware` records the _outcome_; `observabilityErrorHandler`
  (registered via `app.onError`) records _why_. Hono's compose() resolves throws
  through the error handler before they unwind, so a `catch` in the middleware
  would be unreachable — the middleware deliberately has none.
- Error responses carry `{ error, requestId }`; the internal message is never
  leaked to the client.
- Expected 4xx (`HTTPException`) are logged at `warn` and never reach Sentry.
- Durable Objects need separate instrumentation — `apps/mcp` wraps its Agent
  with `instrumentAgentWithSentry`, because `withSentry` on the outer handler
  does not initialise Sentry inside the DO context.
- `packages/cli` still uses plain `console.*`. Those are developer-facing
  terminal scripts, not request paths; structured JSON there would be a
  regression in readability.
