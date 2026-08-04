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
- `src/helpers/api-token.ts` — pure crypto: mint, hash, parse `Authorization`, usability check
- `src/helpers/api-token-store.ts` — `listApiTokens` / `createApiToken` / `revokeApiToken`; keeps drizzle out of `apps/web`
- `src/helpers/principal.ts` — `principalMiddleware` + `requirePrincipal` / `requireInteractivePrincipal` / `requireOrganization`

## API tokens

- **Store the hash, never the plaintext.** `generateApiToken()` returns the secret
  once; the row keeps only its SHA-256 and a short display prefix. SHA-256 (not a
  password KDF) is correct here — these are 256-bit CSPRNG values, so there is
  nothing to brute force and a slow KDF would tax every request.
- **Lookups match on the hash** through a unique index, so no secret comparison
  happens in application code and there is no timing side channel.
- **A present-but-invalid bearer token 401s** — it never falls through to session
  auth. Silent downgrade hides revoked-token bugs.
- **Token management is session-only** (`requireInteractivePrincipal`). A token that
  can mint tokens survives revocation of the one that leaked.
- **Revocation sets `revokedAt`**, it does not delete — the audit trail outlives the
  credential. Revoke/list queries are always scoped by `userId`, never id alone.
- Reject with `HTTPException`, not a bare `throw new Response(...)`: Hono's
  compose() only routes `Error` instances to the error handler.

## Rules

- Route guards use `requireSession`/`hasRole` — never re-implement role comparison inline
- `hasRole` treats unknown roles as no permission (fails closed); keep it that way
- Auth flow convention: authenticate → resolve org context → check permission → scope data by org
- better-auth version is pinned by the security audit findings — check `docs/security-audit.md` #1 before touching it

## Testing

- Helpers are pure or mockable — tested in `src/__tests__/` with a stubbed Hono context
- **Coverage target: 100% for `src/helpers/`**; `server.ts`/`middleware.ts`/`client.ts` are thin config wrappers exercised by the e2e auth suite (`tests/e2e/auth.spec.ts`), no unit target
- Every new helper ships with tests for its deny path, not just its allow path
- Token tests must cover the lifecycle deny paths explicitly: revoked, expired,
  unknown, malformed, and "invalid token does not fall through to the session"
