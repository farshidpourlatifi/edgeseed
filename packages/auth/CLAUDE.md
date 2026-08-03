# @starter/auth

## Why this exists

Everything Better Auth: server config, Hono middleware, browser client, and the
role/session helpers. Both workers get identical auth behavior by importing
from here instead of configuring Better Auth themselves.

## Layout

- `src/server.ts` — `createAuth()`; social providers are enabled conditionally when their credentials are present
- `src/middleware.ts` — `authMiddleware` creates `db` + `auth` per request and stores them on the Hono context (`c.get("db")` / `c.get("auth")`)
- `src/client.ts` — Better Auth browser client (used by `apps/web/app/lib/auth-client.ts`)
- `src/helpers/roles.ts` — `ROLES` + `hasRole()` hierarchy (owner > admin > member)
- `src/helpers/session.ts` — `getSession()` / `requireSession()` (throws 401 `Response`)

## Rules

- Route guards use `requireSession`/`hasRole` — never re-implement role comparison inline
- `hasRole` treats unknown roles as no permission (fails closed); keep it that way
- Auth flow convention: authenticate → resolve org context → check permission → scope data by org
- better-auth version is pinned by the security audit findings — check `docs/security-audit.md` #1 before touching it

## Testing

- Helpers are pure or mockable — tested in `src/__tests__/` with a stubbed Hono context
- **Coverage target: 100% for `src/helpers/`**; `server.ts`/`middleware.ts`/`client.ts` are thin config wrappers exercised by the e2e auth suite (`tests/e2e/auth.spec.ts`), no unit target
- Every new helper ships with tests for its deny path, not just its allow path
