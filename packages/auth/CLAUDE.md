# @starter/auth

## Why this exists

Everything Better Auth: server config, Hono middleware, browser client, and the
role/session helpers. Both workers get identical auth behavior by importing
from here instead of configuring Better Auth themselves.

## Layout

- `src/server.ts` — `createAuth()`; social providers are enabled conditionally when their credentials are present
- `src/organization.ts` — the organization plugin's options, extracted so the invitation sender can be asserted on (`organization()` captures its argument and exposes only `id`/`endpoints`/`schema`)
- `src/invitation.ts` — the accept path, the id parameter, the expiry, and `invitationAcceptUrl`. A **leaf with no imports**, because `apps/web/app/lib/auth-redirects.ts` re-exports it into the browser bundle
- `src/rate-limit.ts` — the rate-limit policy table plus the adapter from Workers `[[ratelimits]]` bindings to Better Auth's storage contract (audit #4)
- `src/session-hooks.ts` — the one `databaseHooks` entry: gives a new session an active organization, because Better Auth gives it none
- `src/middleware.ts` — `authMiddleware` creates `db` + `auth` per request and stores them on the Hono context (`c.get("db")` / `c.get("auth")`)
- `src/client.ts` — Better Auth browser client (used by `apps/web/app/lib/auth-client.ts`)
- `src/helpers/roles.ts` — `ROLES` + `hasRole()` hierarchy (owner > admin > member)
- `src/helpers/session.ts` — `getSession()` / `requireSession()` (throws `HTTPException(401)`)
- `src/helpers/api-token.ts` — pure crypto: mint, hash, parse `Authorization`, usability check
- `src/helpers/api-token-store.ts` — `listApiTokens` / `createApiToken` / `revokeApiToken`; keeps drizzle out of `apps/web`
- `src/helpers/org-store.ts` — `resolveMembership` / `listPendingInvitations`; the org-scoped reads Better Auth either does not paginate or does not filter
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

## Rate limiting

Audit #4. `rate-limit.ts` holds the whole policy; `docs/security-audit.md` #4
holds the reasoning, including why KV and `secondaryStorage` were both rejected.

- **`enabled` is a literal `true`, never derived.** Better Auth defaults it to
  `isProduction`, which reads `NODE_ENV` — never set on Workers. That one line
  is why this repo had no rate limiting at all.
- **A path's class is `CLASSIFIERS`, and mail is the strict one.** Anything an
  unauthenticated caller can use to make the app send a message belongs there,
  `/sign-up/email` included — and so does `/organization/invite-member`, which
  is authenticated but is still the app sending mail on someone's say-so. That
  one prefix covers **resend too**: `resend: true` is a body flag on the same
  endpoint, not a second path, so there is nothing else to classify. At 3/60s
  it will bite the invite form in #37 — surface the 429 as "too quickly" there,
  rather than loosening the class.
- **Changing a number means changing it in three places** — the table here and
  `simple` in both `wrangler.jsonc` files. The table is canonical; the bindings
  are what enforce.
- **`get`/`set` on the storage throw on purpose.** They are Better Auth's
  non-atomic fallback; returning "no record" from them would silently disable
  rate limiting if a future version stopped calling `consume`.
- **`auth.api.*` does not go through the limiter** — it lives in the HTTP
  router's `onRequest` hook. An endpoint that signs users in that way limits
  itself with `rateLimitKey`, as `apps/mcp`'s `/authorize` does.

## Organizations

- **A new session starts in an organization because `session-hooks.ts` puts it
  there.** Better Auth writes `session.activeOrganizationId` in
  create-organization, accept-invitation and set-active, and **nowhere at
  sign-in** — the only callers of `adapter.setActiveOrganization` are those
  three routes. Left alone, a returning member signs in with no active
  organization at all, and every org-scoped read has nothing to key on. The
  hook picks the oldest membership — the row `listOrganizations` returns first.
  It returns **nothing** for an account with no memberships rather than an
  explicit `undefined`: `createWithHooks` spreads whatever `data` it is handed
  over the row, so a returned key is a key written.
- **Nothing may paper over a `null` active organization by guessing.** The
  switcher in `dashboard.tsx` used to fall back to `organizations[0]`, which
  put a checkmark — "this is where your writes go" — on a row chosen by list
  order. It now renders "Select organization". The one deliberate asymmetry is
  `resolveMembership(db, { organizationId: null })`, which _does_ fall back to
  the oldest membership: choosing what to read is not the same claim as
  asserting what the session selected, and telling an account with three
  organizations that it has none would be the worse lie. Do not "fix" either
  one to match the other.
- **The session field is a default view, never proof of membership.**
  `removeMember` clears the session of the person doing the removing, and only
  when they remove _themselves_ — so a removed member keeps a session naming an
  organization they can no longer read. `resolveMembership` is what turns that
  id into an answer, and every read scopes itself besides.
- **`listPendingInvitations` exists because Better Auth's list endpoint is
  unbounded.** `/organization/list-invitations` runs a bare `findMany` on
  `organizationId` — no limit, no offset, no status filter — so it reads every
  spent invitation an organization has ever had, and D1 bills rows scanned.
  `/organization/list-members` paginates properly and is used as-is; the split
  is per-endpoint, not a preference.

## Rules

- Route guards use `requireSession`/`hasRole` — never re-implement role comparison inline
- `hasRole` treats unknown roles as no permission (fails closed); keep it that way
- Auth flow convention: authenticate → resolve org context → check permission → scope data by org
- better-auth version is pinned by the security audit findings — check `docs/security-audit.md` #1 before touching it

## Testing

- Helpers are pure or mockable — tested in `src/__tests__/` with a stubbed Hono context
- **Coverage target: 100% for `src/helpers/`, `src/rate-limit.ts` and `src/invitation.ts`**; `server.ts`/`middleware.ts`/`client.ts` are thin config wrappers exercised by the e2e auth suite (`tests/e2e/auth.spec.ts`), no unit target
- **The drizzle stores have no unit tests, and that is the standing precedent** — there is no D1 in unit tests, so `api-token-store.ts` and `org-store.ts` are mocked at their consumers and proven by e2e (`api-tokens.spec.ts`, `members.spec.ts`). Their deny paths are e2e cases, not vitest ones: cross-tenant reads and the admin-only invitations list live in `members.spec.ts`. Read the "100% for `src/helpers/`" target with that exception in mind rather than as a claim these files are covered
- **`session-hooks.ts` is tested twice on purpose** — `session-hooks.test.ts` proves it picks the right organization, `auth-config.test.ts` proves it is _installed_. An uninstalled hook is the silent failure: every request still succeeds and sessions simply carry no active organization
- **`organization.ts` is configuration, so it is tested like `auth-config.test.ts` tests configuration** — nothing in it fails loudly when wrong. A missing `requireEmailVerificationOnInvitation` still serves every request; it just lets an unproven address into an organization. `invitationAcceptUrl` carries the one leg no e2e can reach, since the emailed link only ever reaches the dev server's log
- **`rate-limit.ts` sits at 88% mutation score, and the remaining survivors were checked by hand — do not chase the number.** Four are the message text inside `unreachable()`; one is `AUTH_RATE_LIMIT_CUSTOM_RULES` being module-level, which per-test coverage cannot attribute; the other six are equivalent mutants in `normalizeIp`, where the redundancy is real but harmless (the IPv4 guard is also reachable through the IPv4-mapped branch, `fill("")` is indistinguishable after `padStart`, and the destructuring defaults only fire on a path that ignores the value). Killing them would mean asserting on error strings or deleting guards that make the code readable
- **Rate-limit tests drive `auth.handler()`, not `auth.options`.** Every part of audit #4 was configuration that looked present and did nothing, so an assertion on the options object would have passed throughout. A POST with an empty JSON body answers 400 from validation without touching D1, which is what makes a real-handler test possible with no database
- Every new helper ships with tests for its deny path, not just its allow path
- Token tests must cover the lifecycle deny paths explicitly: revoked, expired,
  unknown, malformed, and "invalid token does not fall through to the session"
