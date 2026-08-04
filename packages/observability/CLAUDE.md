# @starter/observability

## Why this exists

Structured logging, correlation ids, and Sentry error reporting — shared by
every Worker. It is a package, not an app-local util, because `apps/web` and
`apps/mcp` both need it and cross-app relative imports are banned
(`docs/creating-packages.md`).

## Layout

- `src/logger.ts` — `createLogger()`, levels, `child()`, `resolveLogLevel()`. Pure: no Sentry import, `write`/`now` are injectable seams
- `src/redact.ts` — log-safe cloning: sensitive keys blanked, Errors expanded, cycles broken, depth/width capped
- `src/request-id.ts` — `resolveRequestId()`: reuse `x-request-id`, else `cf-ray`, else mint a uuid
- `src/sentry.ts` — `sentryOptions()` (returns `undefined` with no DSN), `sentryOptionsOrDisabled()`, breadcrumb writer, capture helpers
- `src/middleware.ts` — Hono `observabilityMiddleware` + `observabilityErrorHandler`
- `src/index.ts` — barrel

## Rules

- **The barrel must stay Hono-free.** `apps/mcp` imports `@starter/observability`
  and does not depend on Hono; the middleware is only reachable at
  `@starter/observability/middleware`.
- **Logs take the entry object, not a JSON string** — Cloudflare Workers Logs
  indexes object properties as queryable fields; a pre-stringified line arrives
  as one opaque message.
- **`level`/`msg`/`time` are applied last** so caller fields can never spoof them.
- **Never log a raw value without `redact()`** — `createLogger` does it for you;
  bypassing it is how secrets leak.
- **Sentry is opt-in.** No `SENTRY_DSN` ⇒ `sentryOptions()` returns `undefined`
  ⇒ `withSentry()` is a pass-through. A fresh clone must run with no Sentry account.
- `observabilityMiddleware` records the _outcome_; `observabilityErrorHandler`
  records _why_. Mount both — Hono's compose() resolves throws through the error
  handler before they unwind, so a `catch` in the middleware is unreachable.
- Durable Objects / Agents need their own `instrumentAgentWithSentry(sentryOptionsOrDisabled, …)`;
  `withSentry` on the outer fetch handler does not initialise Sentry inside them.

## Testing

- Tests in `src/__tests__/`, injecting `write`/`now` rather than spying on the clock
- **Coverage target: 95%+** — this is the layer everything else reports through
- Redaction gets an explicit rejecting case per sensitive key family; correlation
  ids get hostile-input cases (inbound ids are attacker-controlled)
