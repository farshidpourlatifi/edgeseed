# Security Audit — 2026-08-04

Ten independent review passes over the repo at commit `46f04dc`, each with a
different lens: secrets, auth configuration, authorization/tenancy, injection,
XSS/client-side, headers/CSRF/CORS, API surface, MCP server, dependencies, and
infrastructure/data handling.

**Headline:** no live remote-code-execution, SQL-injection, or XSS defects exist
in the application code — the code itself is a thin, careful scaffold. Every
serious issue is either a **dependency with known account-takeover advisories**
or a **missing control that fails open as the starter grows**. Because this is a
starter kit, the fail-open defaults matter more than usual: every fork inherits
them.

| #   | Severity | Issue                                                                 | Status     |
| --- | -------- | --------------------------------------------------------------------- | ---------- |
| 1   | Critical | `better-auth@1.5.6` account-takeover advisories                       | Resolved   |
| 2   | High     | Account pre-hijacking via unverified signup + implicit OAuth linking  | Resolved   |
| 3   | High     | `BETTER_AUTH_SECRET` unvalidated; silent fallback to a public default | Resolved   |
| 4   | High     | No rate limiting on any auth endpoint                                 | Resolved   |
| 5   | High     | No security response headers anywhere                                 | Resolved   |
| 6   | High     | Vulnerable `hono`, `drizzle-orm`, `react-router` versions             | Resolved   |
| 7   | High     | Global `~/.npmrc` uses plaintext HTTP registry with TLS off           | Resolved   |
| 8   | Medium   | MCP server has no authentication                                      | Resolved\* |
| 9   | Medium   | `BETTER_AUTH_SECRET` committed in `apps/mcp/wrangler.jsonc`           | Resolved   |
| 10  | Medium   | Dashboard child loaders do not enforce auth themselves                | Resolved   |
| 11  | Medium   | IP-derived controls trust spoofable `x-forwarded-for`                 | Resolved   |
| 12  | Medium   | OAuth and verification tokens stored in plaintext, never purged       | Live       |
| 13  | Medium   | `member`/`invitation` foreign keys do not cascade on delete           | Resolved   |
| 14  | Medium   | No `Cache-Control` on authenticated responses                         | Resolved   |
| 15  | Medium   | No CSRF protection on the `/api/v1` mount                             | Resolved   |

Low and informational findings follow the detailed section.

---

## Critical

### 1. `better-auth@1.5.6` carries account-takeover advisories that apply to this configuration

`packages/auth/package.json` declares `"better-auth": "^1"`, locked at 1.5.6.
That version has ten advisories, and several are directly exploitable given that
this app enables email/password login, GitHub and Google social login, and the
organization plugin:

- **GHSA-pw9m-5jxm-xr6h** (Critical) — OAuth refresh-token replay via missing
  client authentication. Fixed in 1.6.11.
- **GHSA-g38m-r43w-p2q7** (High) — account takeover by auto-linking an OAuth
  identity to an unverified pre-existing account. Social login is enabled, so
  this applies as configured. Fixed in 1.6.11.
- **GHSA-fmh4-wcc4-5jm3** (High) — unauthorized organization-invitation
  acceptance via an unverified email address. The org plugin is in use. Fixed in
  1.6.11.
- **GHSA-qq9h-g4jm-xgf3** (High) — pre-account-hijacking. Fixed in 1.6.22.
- **GHSA-86j7-9j95-vpqj** (High) — stored XSS via a `javascript:` `redirect_uri`.
  Fixed in 1.6.13.
- Plus GHSA-9h47-pqcx-hjr4, GHSA-7w99-5wm4-3g79, GHSA-392p-2q2v-4372,
  GHSA-wxw3-q3m9-c3jr (OAuth state mismatch), GHSA-2vg6-77g8-24mp.

It also pulls vulnerable transitives `kysely@0.28.15` (GHSA-pv5w-4p9q-p3v2) and
`defu@6.1.4` (GHSA-737v-mqg7-c878).

**Fix:** upgrade to `better-auth >= 1.6.22`. This is the single highest-impact
change available. Note that finding 2 must be fixed alongside it — the upgrade
closes the library's half of the pre-hijacking problem, but not the
configuration's half.

**Resolved 2026-08-05** — upgraded to `better-auth@1.6.26`, past the 1.6.22 needed
for the last of the listed advisories.

This forced a coupled upgrade rather than a version bump: better-auth ≥1.6 requires
zod 4 and peers on `drizzle-orm@^0.45.2`, so `zod@4.4.3`, `@hono/zod-openapi@1.5.1`
and `drizzle-orm@0.45.2` moved in the same change. Staying on zod 3 would have made
this advisory unpatchable — which is why the split was never really a choice.

Verified by `pnpm check:boot`, added immediately beforehand for this purpose: the
built Worker now starts and serves, where the zod 3/4 split had it dying at module
init. No OpenAPI spec drift and no schema drift resulted.

**Transitives:** `kysely` is now `0.29.4` and no longer flagged. **`defu@6.1.4`
remains vulnerable** (needs ≥6.1.5) and is still reached through better-auth —
finding 2's remediation should carry it, or pin it with a pnpm override.

**Finding 2 is still open.** This upgrade closed the library's half of the
pre-hijacking problem; the configuration half (`requireEmailVerification`,
explicit `account.accountLinking`) is untouched.

---

## High

### 2. Account pre-hijacking: unverified signup combined with implicit social account linking

`packages/auth/src/server.ts:24-44` enables email/password signup with no
verification requirement, and enables social providers with no account-linking
policy:

```ts
emailAndPassword: {
  enabled: true,
},
socialProviders: {
  ...(opts.githubClientId && opts.githubClientSecret ? { github: {...} } : {}),
```

There is no `requireEmailVerification`, no `emailVerification.sendVerificationEmail`,
and no `account.accountLinking` block anywhere in the repo. Better Auth's linking
guard permits the link when the provider reports a verified email — which Google
and GitHub always do — so linking proceeds implicitly.

**Attack:** an attacker registers `victim@example.com` with a password of their
choosing. No verification email is sent, so the account exists with
`emailVerified: false`. When the real owner later signs in with Google, that
Google identity is linked into the attacker's existing row. The attacker's
password credential still works, and they now have access to the victim's
account and any organization the victim joins.

This also intersects with the invitation flow: acceptance is matched on the
session user's email, so a pre-registered unverified account can accept
organization invitations sent to that address, yielding cross-tenant membership.

**Fix:** set `emailAndPassword.requireEmailVerification: true` with a working
`emailVerification.sendVerificationEmail` sender, and configure
`account.accountLinking` explicitly (`disableImplicitLinking: true`, or an
explicit `trustedProviders` allowlist).

**Related gap:** no `sendResetPassword` is configured either, so password reset
is non-functional and the login page has no "forgot password" path
(`apps/web/app/routes/login.tsx:97-112`).

---

**RESOLVED 2026-08-06** — `docs/adr/003-transactional-email.md`.

`createAuth` now sets `requireEmailVerification: true` with `sendOnSignUp`, so a
pre-registered account is inert: it holds no session and cannot be signed into.
`account.accountLinking` is explicit, and the linking half is closed by
`requireLocalEmailVerified: true` — a social identity will not link into a local
account that has not proven its own address, which is precisely the attack above.

`trustedProviders` is deliberately **empty**, not an allowlist as the fix text
suggested. That recommendation was backwards: in
`better-auth/dist/oauth2/link-account.mjs` the refusal is
`!isTrustedProvider && !userInfo.emailVerified`, so naming a provider means
"link even when that provider says the address is unverified". Both Google and
GitHub report verification honestly, so an allowlist would only discard a signal
already being received.

Sending is `@starter/email` (Resend, or a logging fallback when unconfigured).
Deny paths are covered in `packages/auth/src/__tests__/auth-config.test.ts` and
`tests/e2e/auth.spec.ts` (sign-up grants no session; correct credentials are
refused while unverified).

**Related gap CLOSED 2026-08-13** (issue #20). `/login` links to
`/forgot-password`, and `/reset-password` completes the flow. Three properties
were built in deliberately and each has a test that fails if it is dropped:

- **Enumeration-safe.** Better Auth answers `/request-password-reset` 200 with
  the same body either way and simulates the token work to level the timing, so
  the UI was the only place left that could leak. The notice is worded "if an
  account exists for …" and never claims mail was sent.
- **Sessions are revoked on reset** (`revokeSessionsOnPasswordReset`, which
  better-auth defaults to `false`). Without it, someone resetting _because_
  another person is in their account changes the password and nothing else —
  the intruder's cookie lives out its full lifetime.
- **A reset is not proof of the address.** It does **not** set `emailVerified`,
  so the gate this finding is about keeps its meaning; an unverified user who
  resets is refused at sign-in and gets the verification notice. Widening this
  is a security decision, not a papercut to smooth over.

The token's failure modes — expired, forged, already spent, absent — all reach
the same dead-link screen, because better-auth cannot distinguish them either
once the row is consumed. Covered in `tests/e2e/password-reset.spec.ts` and
`apps/web/app/__tests__/reset-password-link.test.ts`.

**Still open:** the `verification` rows behind these links are still stored raw
and never purged — that is #12, not this finding.

### 3. A missing `BETTER_AUTH_SECRET` silently signs sessions with a publicly-known default

_Verified directly against the installed package during this audit._

`packages/auth/src/middleware.ts:23-33` passes the binding straight through with
no presence or length check:

```ts
const auth = createAuth({
  db,
  secret: c.env.BETTER_AUTH_SECRET,
  baseURL: c.env.BETTER_AUTH_URL,
```

The Zod schema written to catch exactly this — `packages/config/src/env.ts:6`,
`BETTER_AUTH_SECRET: z.string().min(32)` — is **dead code**. `parseEnv` has zero
callers anywhere in the repo.

Better Auth's own guard does not fire in this runtime. In
`better-auth/dist/context/create-context.mjs` the secret defaults to
`DEFAULT_SECRET` and the throw is gated on `isProduction`, which
`@better-auth/core` defines as `process.env.NODE_ENV === "production"`. Workers
never set `NODE_ENV`, and a repo-wide grep confirms it is set in no config file.

**Consequence:** forgetting `wrangler secret put BETTER_AUTH_SECRET` deploys a
live application that signs session cookies with the constant
`"better-auth-secret-12345678901234567890"` after only a console warning. Anyone
who reads the public source of `better-auth` can forge a valid session cookie
for any user. Short or low-entropy secrets likewise only warn.

The same applies to `BETTER_AUTH_URL`: when empty, Better Auth derives `baseURL`
from the request Host header, silently changing cookie-prefix and origin
validation behavior instead of erroring.

**Could not verify** whether the deployed production Worker currently has the
secret set — `wrangler secret list` requires interactive Cloudflare auth, which
is unavailable in this session. **Check this first** (see the fix plan); if the
secret is not set, treat it as an active compromise of session integrity and
rotate immediately.

**Fix:** fail closed. Call the existing `parseEnv(webEnvSchema, c.env)` at worker
init or in `authMiddleware`, and throw when the secret is absent or under 32
characters.

**Raised 2026-08-08 — this is now load-bearing for #2.** Email verification
tokens are JWTs signed with this same secret, not database rows:
`createEmailVerificationToken` calls `signJWT(payload, secret, expiresIn)`
(`better-auth/dist/api/routes/email-verification.mjs:13-19`). So with the secret
unset, an attacker does not merely forge session cookies — they mint a valid
verification token for any address and self-verify it, which unwinds the
pre-hijacking fix in #2 entirely. Before verification became the gate this was a
severe footgun; it is now the single point of failure for a High finding marked
Resolved. Fix it before treating #2 as closed in production.

**RESOLVED 2026-08-08.** `authMiddleware` now calls
`parseEnv(webEnvSchema, c.env)` before constructing anything
(`packages/auth/src/middleware.ts`), and `authFor` does the same with
`mcpEnvSchema` (`apps/mcp/src/auth-app.ts`) — both Workers, since they share the
secret and a lenient one would undo the other. A rejected env throws, which
`observabilityErrorHandler` answers as a 500 with a correlation id: no request is
served rather than every request served insecurely.

The schema gained an explicit `.refine()` rejecting Better Auth's
`DEFAULT_SECRET`. Length alone did not catch it — the constant is 38 characters
and passed `.min(32)`, which is precisely why it could reach production silently.
Deny-path tests in `packages/config/src/__tests__/env.test.ts` (missing, short,
and the default value), `packages/auth/src/__tests__/middleware.test.ts` (the
request is refused and the handler never runs), and
`apps/mcp/src/__tests__/auth-app.test.ts` for the MCP half. The MCP tests target
`/api/auth/**` deliberately: `pnpm check:boot` polls `/`, which answers from
static metadata and never reaches `authFor`, so without them deleting the MCP
check would leave the entire gate green.

**Updated 2026-08-09.** `check:boot` now makes a second request to
`/api/auth/ok` on that Worker (`envProbe` in `packages/cli/src/lib/boot-check.ts`),
so the runtime path through `authFor` is covered too. The unit tests remain the
deny-path coverage — they can withhold a binding, which a wrangler config
cannot — but a binding _renamed_ in `apps/mcp/wrangler.jsonc` is now caught by
the gate rather than by production.

**A blank binding counts as unset.** `.dev.vars` spells an unset optional key as
`KEY=`, which arrives as `""`, and `.optional()` admits only `undefined`. Every
optional key in `.dev.vars.example` ships that way — `MARKETING_URL=` included —
so validating on every request turned the documented setup path into a 500 on
every request, surfaced as a Zod URL error with nothing pointing at `.dev.vars`.
`optionalBinding` (`packages/config/src/env.ts`) now maps `""` to absent. The
trap was already known for enums: the example shipped `LOG_LEVEL` commented out
with a note that the schema rejects an empty string for it, which both example
files can now drop. Blank still means missing for `BETTER_AUTH_SECRET` and
`BETTER_AUTH_URL`, which are required.

**Environments that run the Worker need an env to run it with.** `check:boot`
passes throwaway values as `--var` (`BOOT_VARS` in
`packages/cli/src/lib/boot-check.ts`) and the CI e2e job writes a throwaway
`.dev.vars`. Its job is to prove the _bundle runs_; a correctly-failing Worker
with no secret serves nothing, which would make the check assert "is CI
configured" instead. Both were caught by CI, not locally — a developer machine
has a `.dev.vars`, so `pnpm verify` passed while the same commit failed the gate.
Worth recording that CI's auth e2e had until then been running against Better
Auth's public default secret, the fallback this finding removes.

**Operational note:** because this now fails closed, deploying it to a Worker
whose secret was never set takes that Worker down instead of leaving it
exploitable. Run `wrangler secret list` before the first deploy carrying this
change.

### 4. No rate limiting on any authentication endpoint

`packages/auth/src/server.ts:19-51` passes no `rateLimit` option — a repo-wide
grep for `rateLimit` returns nothing — and `apps/web/wrangler.jsonc` declares no
Cloudflare rate-limiting binding or WAF rule.

Three independent reasons this leaves sign-in and sign-up freely brute-forceable:

1. Better Auth's default is `enabled: isProduction`, and `isProduction` keys on
   `NODE_ENV`, which is never set on Workers (see finding 3). The limiter is off.
2. Even if enabled, the default `storage: "memory"` is a module-level `Map`
   scoped to one ephemeral Worker isolate.
3. `createAuth()` is re-instantiated on **every request** in
   `packages/auth/src/middleware.ts:23-36`, discarding any in-memory counters
   regardless.

`storage: "database"` would also fail — there is no `rateLimit` table in the
Drizzle schema.

**Correction 2026-08-09 — reason 3 above is wrong for the version now pinned.**
It was written against `better-auth@1.5.6`. In the pinned `1.6.26` the memory
store is a module-level `Map` (`api/rate-limiter/index.mjs:6`) that
`getRateLimitStorage` closes over, so rebuilding `createAuth()` per request does
**not** discard counters. Reason 2 is the whole of it: the counts are
per-isolate and ephemeral, never aggregating across the isolates serving one
caller and gone whenever one is evicted. Reasons 1 and 2 stand, so the finding
and its severity are unchanged — but do not repeat reason 3, which was carried
into the fix's own comments before this was caught in review.

**Fix:** add a KV binding as `secondaryStorage` and set
`rateLimit: { enabled: true, storage: "secondary-storage" }` with stricter
`customRules` on `/sign-in/email` and `/sign-up/email`; or add a Cloudflare Rate
Limiting rule scoped to `/api/auth/*`. Combine with finding 11 — an IP-keyed
limiter is worthless while the IP is spoofable.

**Widened 2026-08-08 — mandatory verification added unauthenticated mail
triggers.** Since #2 was closed, `/sign-up/email` sends a message and
`/send-verification-email` exists as a public resend endpoint (the button in
`apps/web/app/components/auth/verification-notice.tsx`), alongside
`/request-password-reset`. Better Auth ships default rules for exactly these —
3 per 60s for the mail senders, 3 per 10s for sign-in/sign-up
(`better-auth/dist/api/rate-limiter/index.mjs:370-383`) — but all three reasons
above still hold, so none of them run. The cost of leaving this open is no
longer just brute-forceable sign-in: an unauthenticated caller can drive
outbound mail, burning the Resend quota and delivering it to an address they do
not own. Rate-limit the mail endpoints in the same change.

**RESOLVED 2026-08-08.** Landed as `packages/auth/src/rate-limit.ts`, wired into
`createAuth` as `rateLimit.customStorage` with `enabled: true` pinned to a
literal. Three enforcement classes, one Workers `[[ratelimits]]` binding each,
declared in both wrangler files and required by `sharedEnvSchema` — so a Worker
missing one refuses every request rather than serving an unthrottled auth
surface. Per IP and path, per 60 seconds: **mail 3** (`/sign-up/email`,
`/send-verification-email`, `/request-password-reset`, `/forget-password`,
`/change-email`), **credentials 10** (`/sign-in/**`, `/reset-password`,
`/change-password`), and
**default 120** for everything else under `/api/auth`, so an endpoint a future
Better Auth version adds arrives limited rather than unlimited.

**Not KV, and not `secondaryStorage`** — both halves of the prescribed fix above
turned out to be wrong, which is why this took a different shape:

- Setting `secondaryStorage` **moves sessions out of D1**
  (`internal-adapter.mjs`: `databaseStoresSessions = !secondaryStorage || …`),
  so sign-out and revocation would have inherited KV's eventual consistency. A
  rate-limiting change must not relocate session storage.
  `rateLimit.customStorage` is consulted before `storage`, so the limiter can be
  backed independently and sessions stay put.
- KV allows **one write per second per key** (429 beyond that) and caches
  negative lookups. A counter is a hot key by definition, so a
  read-modify-write limiter on KV advances about one increment per second under
  attack — it converges to roughly a 6× reduction, not a limit. Cloudflare's own
  KV docs exclude workloads where values "must be read and written in a single
  transaction."

The `[[ratelimits]]` binding is atomic, costs no storage operations, and has no
hot-key ceiling. Its constraints are that a period must be 10 or 60 seconds —
hence every window here is 60 — and that counters are per Cloudflare location,
which for an IP-keyed limit is wherever that address's traffic already lands.

**Two things this does not do**, both deliberate:

1. It bounds one address, so it is not a defence against a distributed botnet. A
   Cloudflare WAF rate-limiting rule on `/api/auth/*` remains the complementary
   volumetric control, and is the thing to add first if abuse ever outgrows this.
2. `namespace_id`s are account-scoped and both Workers deliberately share them,
   so one bucket per IP+path spans web and MCP. A **second product** deployed
   into the same Cloudflare account must pick different ids or the two will
   share counters.

Covered by unit tests at the vector — requests driven through Better Auth's real
handler until a 429 comes back, since every part of this finding was a config
that looked present and did nothing — plus `tests/e2e/rate-limit.spec.ts`, which
is what proves the bindings are actually declared and reach `createAuth`.

**A bypass the finding did not name, closed in the same change.** The MCP
Worker's `/authorize` consent screen signs users in through
`auth.api.signInEmail`, and Better Auth applies its limiter in the HTTP router's
`onRequest` hook — which `auth.api.*` never passes through. Limiting
`/api/auth/**` alone would have left an unlimited password-guessing oracle one
path over, on a Worker that shares its users and its secret with apps/web.
`auth-app.ts` now calls the credentials limiter itself before reading the
submitted credentials.

### 5. No security response headers anywhere in the stack

A repo-wide grep for `secureHeaders|content-security|x-frame|nosniff|referrer-policy|strict-transport`
returns zero hits. The Hono app (`apps/web/server/index.ts:22-35`) registers only
`authMiddleware`, and the SSR entry sets exactly one header
(`apps/web/app/entry.server.tsx:28`):

```ts
responseHeaders.set("Content-Type", "text/html");
```

**Consequence:** the login page and the authenticated dashboard are frameable
(clickjacking), there is no MIME-sniffing protection, referrers leak in full, and
the production deployment sends no HSTS. There is also no defense-in-depth layer
should any injection bug ever land.

**Fix:** add `secureHeaders()` from `hono/secure-headers` as the first middleware
in `apps/web/server/index.ts`. The inline theme script at `apps/web/app/root.tsx:28`
will need a CSP nonce or hash.

**RESOLVED 2026-08-08** — `apps/web/server/security-headers.ts`, mounted directly
after `observabilityMiddleware` and above the origin redirect, so redirects carry
the headers too. Ships CSP, `X-Frame-Options: DENY`, `nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, a two-year preload-eligible
HSTS, and a deny-by-default `Permissions-Policy`.

The answer to "nonce or hash" turned out to be **both**, for different scripts:

- **Nonce** for React Router's inline scripts. `<Scripts>` and
  `<ScrollRestoration>` are only half of them — the stream-transfer chunks that
  push loader data are emitted _mid-stream_ and cannot be reached from
  `root.tsx` at all. Passing the nonce to `ServerRouter` in `entry.server.tsx`
  covers every one, since it is the documented default for all nonce-aware
  components; `renderToReadableStream({ nonce })` covers React's own bootstrap
  scripts, which are separate again.
- **Hash** for the theme script, which is static. This keeps it working
  independently of the nonce path — a missing nonce there would not throw, it
  would paint the wrong theme, which no status assertion would catch.
  `THEME_SCRIPT_CSP_HASH` lives beside the script in `app/lib/theme-script.ts`
  and is asserted against it in `app/__tests__/theme-script.test.ts`, so editing
  one without the other fails the suite.

Two traps worth recording. A hash source expression must be **quoted**
(`'sha256-…'`) — unquoted, browsers discard it as an invalid source and report
only that, while the script it was meant to admit is blocked separately. And
`<Links>` is passed an explicit empty nonce: left to inherit, it stamps one onto
`<link>` tags, and because browsers blank the `nonce` attribute after parsing,
hydration then reports a mismatch React will not patch up.

`script-src` carries no `unsafe-inline` or `unsafe-eval`; `style-src` keeps
`unsafe-inline` because Tailwind injects a runtime `<style>` and Radix writes
inline style attributes, neither of which is a script-execution primitive.
Covered by `apps/web/server/__tests__/security-headers.test.ts` and, because a
broken CSP is visually silent, an e2e test that drives a Radix menu to prove
hydration actually happened (`tests/e2e/security-headers.spec.ts`).

### 6. Vulnerable framework dependencies

- **`hono@4.12.9`** (declared `^4`) — 21 advisories. Most severe:
  GHSA-88fw-hqm2-52qc (High), CORS middleware reflecting any Origin with
  credentials when `origin` is defaulted; fixed 4.12.25. Also
  GHSA-2gcr-mfcq-wcc3, an `app.mount()` undecoded-path routing bug that is
  directly relevant because Better Auth is mounted under `/api/auth/**`. Plus
  cookie-name injection, JWT scheme laxity, and cache poisoning via ignored
  `Vary`. **Upgrade to >= 4.12.34.**
- **`drizzle-orm@0.41.0`** (declared `^0.41`) — GHSA-gpj5-g38j-94v9 (High), SQL
  injection via improperly escaped SQL identifiers; fixed 0.45.2. Note the
  declared range **can never reach the fix**: under semver, `^0.41` pins to
  `0.41.x`. The range itself must be bumped. **Change to `^0.45.2`.**
- **`react-router@7.13.2`** (declared `^7`) — GHSA-49rj-9fvp-4h2h (High),
  arbitrary constructor invocation in vendored turbo-stream, fixed 7.14.2; three
  unauthenticated DoS advisories fixed by 7.18.0; two open-redirect and one CSRF
  advisory. **Upgrade to >= 7.18.0**, then run `npx react-router typegen`.

**Resolved 2026-08-05.**

| Package        | Was      | Now          | Target       |
| -------------- | -------- | ------------ | ------------ |
| `drizzle-orm`  | `0.41.0` | **`0.45.2`** | `^0.45.2`    |
| `hono`         | `4.12.9` | **`4.13.0`** | `>= 4.12.34` |
| `react-router` | `7.13.2` | **`7.18.2`** | `>= 7.18.0`  |

`drizzle-orm` came along with finding #1 (better-auth ≥1.6 peers on `^0.45.2`) and
also fixed the declared range — `^0.41` could never reach the patch under semver.

For `hono` and `react-router` the **ranges were already correct**: both declared
`^4` / `^7`, which permitted the fixed versions all along. Only the lockfile was
stale. Worth carrying into the next audit — checking declared ranges is not the
same as checking resolved versions, and this review reported the resolved ones as
if the ranges were at fault.

`react-router` deliberately stays on 7.x. Latest is 8.x, but a major migration is
not a security fix.

All three are now covered by `pnpm check:boot`, so a bad upgrade fails the gate
rather than shipping. `react-router` additionally got two full e2e suites at
`--retries=0` (9/9 both), since it is the one with real behavioural risk.

### 7. Global `~/.npmrc` fetches packages over plaintext HTTP with TLS verification disabled

_Machine-level, outside the repo, but it governs every install into this repo._

`/Users/farshid/.npmrc` contains `strict-ssl=false` and
`registry=http://registry.npmjs.org/`. Every `pnpm install` on this machine
fetches packages over unencrypted HTTP with certificate validation turned off,
which allows trivial man-in-the-middle package substitution. This was observed
during the audit: `pnpm audit` failed with a `426` because the registry now
mandates HTTPS.

The committed `pnpm-lock.yaml` contains integrity hashes and no `http://` URLs,
so existing dependencies are still constrained — but a MITM'd fresh install of
any _new_ package would be poisoned at lockfile-creation time and the bad hash
would then be committed as truth.

**Fix:** set `registry=https://registry.npmjs.org/` and delete
`strict-ssl=false` from `~/.npmrc`. The repo's own `.npmrc` is clean.

**Resolved 2026-08-09** — `~/.npmrc` now carries
`registry=https://registry.npmjs.org/` and no `strict-ssl` line at all, so npm
falls back to its secure default rather than an explicit `true` that a later
edit could flip back unnoticed. Verified with `npm config get registry` (HTTPS)
and `npm config get strict-ssl` (`true`), then `pnpm install --frozen-lockfile`
and `npm ping` to prove installs and registry reachability survive the change.

Two things this does **not** do. It does not retroactively clear the existing
`pnpm-lock.yaml`: every hash in it was resolved under the old configuration, and
while nothing in the tree resolves over `http://`, the integrity hashes are only
as trustworthy as the fetches that produced them. Treat a lockfile-wide
regeneration as a separate decision, not a follow-on to this fix. And it is
machine-level state — nothing in the repo enforces it, so a fresh clone on
another machine inherits whatever that machine's `~/.npmrc` says. The repo's own
`.npmrc` remains the only part of this a commit can guarantee.

---

## Medium

### 8. MCP server exposes its endpoints with no authentication

`apps/mcp/src/index.ts:36-44` routes `/sse` and `/mcp` straight into
`StarterMcpAgent.serve()` with no bearer token, OAuth wrapper, session check, or
`Origin` validation (the MCP spec requires the latter on HTTP transports as
DNS-rebinding protection). `init()` hands every registered tool a live D1 `db`
handle and an `auth` instance with no per-request identity.

**Currently latent, not live:** the worker is unbuildable. `apps/mcp/src/index.ts:1`
imports `agents/mcp`, but `agents` is not declared in `apps/mcp/package.json` and
is not installed in the workspace; `wrangler.jsonc` has no Durable Object binding
or migration that `McpAgent` requires; and `database_id: "local"` is not a valid
remote D1 id. The docs are consistent about this — `docs/costs-and-limits.md:27`
says to leave the MCP worker undeployed, and line 63 already notes the endpoints
have no request authentication.

The risk is that **the broken build is the only thing preventing public exposure,
and that is an accidental control, not a deliberate one.** Whoever fixes the
build removes it. Meanwhile `apps/mcp/src/tools/index.ts:11` instructs developers
to add one tool per public API route, so DB-touching tools will accumulate.

**Fix:** land the auth gate in the same change that makes the worker buildable —
`workers-oauth-provider`, a bearer-token check in `fetch`, or Cloudflare Access —
and thread the authenticated principal into `ToolContext` so tools can scope
queries.

**Resolved 2026-08-04** — and the worker is buildable, so the accidental control
is gone and a deliberate one replaces it. `apps/mcp/src/index.ts` now wraps
everything in `OAuthProvider` with `/mcp` and `/sse` as `apiRoute`s, so they
require a bearer token; `agents` is declared; the `MCP_OBJECT` Durable Object
binding and migration exist; and `database_id` matches `apps/web`. The
authenticated principal reaches tools as `ToolContext.user`, sourced from the
OAuth grant rather than tool arguments (`src/__tests__/whoami.test.ts` asserts
caller-supplied identity is ignored).

Verified end to end: unauthenticated `/mcp` → `401` with
`WWW-Authenticate: Bearer …resource_metadata=…`; discovery → dynamic registration
→ login → consent → PKCE code exchange → authenticated `tools/call`; bogus token
→ `401`.

**\* The resolution is narrower than "authentication added".** Review of the
original fix (2026-08-05) found three auth defects in it, all since fixed — the
first two verified against a running Worker, the third pinned by deny-path
tests — plus one item still open:

- **Login CSRF (fixed).** The consent flow called `auth.api.signInEmail` without
  `request`, and better-auth's `formCsrfMiddleware` opens with
  `if (!ctx.request) return;` — so the check that blocks cross-site form logins
  was silently disarmed. An attacker page could plant its own session in the
  victim's browser, and the victim's "Approve" would then bind their MCP client
  to the attacker's account. Verified: a cross-site POST with valid credentials
  now returns 401 and sets no cookie, while the same-origin POST still succeeds.
- **Session id not bound to the principal (fixed).** The Durable Object is named
  from the client-supplied `mcp-session-id`, and the Agent's `props` are written
  to DO storage at `onStart` — never refreshed per request. Anyone who learned a
  session id could present their _own_ valid token with it and have every tool
  resolve to the victim's `userId`. Now rejected with
  `403 session_principal_mismatch`; verified with two real users holding
  legitimate tokens.
- **PKCE not actually required (fixed 2026-08-09).** The `OAuth 2.1` label
  overstated it: the library mandates PKCE only when
  `tokenEndpointAuthMethod === "none"`, and dynamic registrations default to
  `client_secret_basic`. `pkceProblem` in `auth-app.ts` now rejects a missing
  `code_challenge` outright, and a `code_challenge_method` other than `S256`;
  `rejectUnacceptable` runs it alongside the scope check on **both** the GET and
  the POST `/authorize` paths, before a user is ever shown consent. Refusal is a
  spec-shaped `invalid_request` redirect carrying `iss`, not a dead end.
  The method branch is defence in depth rather than load-bearing: `parseAuthRequest`
  was verified to 400 both an explicit `plain` and an omitted method, so only a
  missing challenge reaches the guard today. It is kept so a library change
  cannot silently reintroduce a downgrade to `plain`. Deny path covered by
  `src/__tests__/auth-app.test.ts`.
- **`Origin` validation (OPEN — re-verified 2026-08-09).** Requiring a bearer
  token blocks the practical DNS-rebinding attack, but the MCP spec asks for the
  header check on HTTP transports regardless, and the Agents SDK answers
  `Access-Control-Allow-Origin: *`. Still unfixed: `apps/mcp/src` passes no
  `corsOptions` anywhere, so `McpAgent.serve` falls back to that default, and
  nothing validates the `Origin` header against an allowlist. Tracked as
  `security-plan.md` Phase 4 item 3.

Treat this entry as "authenticated, with one known gap" rather than closed —
`Origin` validation, above.

### 9. `BETTER_AUTH_SECRET` committed in the MCP worker config

`apps/mcp/wrangler.jsonc:16`:

```jsonc
"BETTER_AUTH_SECRET": "dev-secret-must-be-at-least-32-characters-long"
```

Commit `4dba41c` ("Move secrets to wrangler secret put") removed this from
`apps/web/wrangler.jsonc` but left the MCP worker untouched. The value is an
obvious placeholder, so nothing is leaked today — but it is consumed as the live
signing secret at `apps/mcp/src/index.ts:24`, so any deploy of this worker as-is
signs tokens with a key that is public in git, against a database it may share
with the web app.

**Fix:** remove from `vars`; use `apps/mcp/.dev.vars` locally and
`wrangler secret put` for production, mirroring the web app.

**Resolved 2026-08-06** — `BETTER_AUTH_SECRET` is gone from `vars` (the file now
carries a comment explaining the shadowing trap), and the committed
`BETTER_AUTH_URL` var was removed in the same pass — same shadowing risk, and
the Worker never reads it (`auth-app.ts` derives `baseURL` from the request
origin). Committed `.dev.vars.example` templates document the local setup.

### 10. Dashboard child-route loaders do not enforce authentication themselves

The layout loader at `apps/web/app/routes/dashboard.tsx:41-74` correctly throws
`redirect("/login")`, but it is not a reliable security boundary in React Router
v7: child loaders run in parallel with the parent on document requests, parent
loader data is cached and not revalidated when navigating between children, and
single-fetch `.data` requests can target an individual route loader.

- `apps/web/app/routes/dashboard._index.tsx:4-6` — no session check at all.
- `apps/web/app/routes/dashboard.settings.tsx:16-21` — `if (!session) return { user: null };`,
  silently returning instead of redirecting.

**Exposure today is nil** (the index returns nothing, settings returns only the
caller's own user). The real cost is that both files are the templates every
future dashboard page will be copied from, and CLAUDE.md's "Auth guard"
convention currently implies the layout loader suffices.

**Fix:** add a shared `requireUser(context, request)` helper, call it in every
child loader, and correct the convention in CLAUDE.md.

**RESOLVED 2026-08-08** — `apps/web/app/lib/require-user.ts`, called by the
layout loader and by **both** child loaders. `dashboard.settings.tsx` now
redirects instead of returning `{ user: null, tokens: [] }`; that soft return was
the shape worth deleting, because it answered 200 to an unauthenticated caller
and looked deliberate. `dashboard._index.tsx` guards even though it returns
nothing, so the file the next page gets copied from carries the check.

The helper throws rather than returning null, so a caller cannot continue with no
user by accident. Deny paths in `apps/web/app/__tests__/require-user.test.ts`.

**Tested at the vector, not just at the helper.** Unit tests on `requireUser`
pass whether or not a loader calls it, so `tests/e2e/loader-guards.spec.ts`
requests the loader directly. Two things make that test non-obvious, and both
were got wrong first:

- **A plain `.data` request does not exercise the child.** Single fetch resolves
  every matched loader in one request, and any one of them redirecting
  short-circuits the whole payload — so `/dashboard/settings.data` is satisfied
  by the _layout's_ guard and keeps passing with the child wide open.
  `?_routes=routes%2Fdashboard.settings` asks for one loader by id without its
  parent, which is the request this finding is actually about.
- **The status code is not the assertion.** An unauthenticated `.data` request
  answers **202**, with the redirect encoded in the body as
  `SingleFetchRedirect`. Asserting a 302, or merely "not 200", proves nothing.

Verified by removing the guard in a throwaway worktree: the `?_routes=` case goes
red while the plain `.data` cases stay green, which is the whole argument for
targeting the child.

### 11. IP-derived controls trust the first `x-forwarded-for` entry, which is client-spoofable

`packages/auth/src/server.ts:19-51` sets no `advanced.ipAddress.ipAddressHeaders`
override, so Better Auth defaults to reading `x-forwarded-for` and taking
`split(",")[0]`. Cloudflare **appends** the real visitor IP to any client-supplied
`X-Forwarded-For` header, so the first entry is fully attacker-controlled.

That value keys the rate limiter and is recorded as `session.ipAddress`, so any
IP-keyed throttling is bypassed by rotating a spoofed header, and session audit
data is unreliable.

**Fix:** set `advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } }`.

**RESOLVED 2026-08-08** — set exactly that in `createAuth`
(`packages/auth/src/server.ts`). The list holds one entry deliberately: a
fallback would restore the spoofable path whenever the trusted header is absent,
which is a state an attacker can arrange. Asserted in
`packages/auth/src/__tests__/auth-config.test.ts`, including that
`x-forwarded-for` never reappears in it.

Landed ahead of the limiter it protects (#4, resolved 2026-08-08) because it
also fixes `session.ipAddress` audit data, which is recorded today. The limiter
now keys on that value, so `tests/e2e/rate-limit.spec.ts` asserts the pairing
directly: a caller rotating a spoofed `X-Forwarded-For` stays throttled.

### 12. OAuth and verification tokens are stored in plaintext with no purge

`packages/db/migrations/0000_living_pet_avengers.sql:6-8` and
`packages/db/src/schema/accounts.ts:12-14` store `accessToken`, `refreshToken`,
and `idToken` as plain `text`. `verification.value` (migration line 79) holds raw
email-verification and password-reset tokens the same way. A grep of `docs/`,
`README.md`, and CLAUDE.md finds no acknowledgment of this — no hits for
"encrypt" or "plaintext".

Any D1 export, backup, or `wrangler d1 execute` session exposes usable GitHub and
Google access tokens for every linked user. Expired `verification` rows are never
cleaned up, so the exposure accumulates indefinitely.

(`account.password` is a scrypt hash via Better Auth — that column is fine.)

**Fix:** at minimum document the reliance on D1 at-rest encryption; better,
enable field encryption via Better Auth database hooks. Add a scheduled purge of
expired `verification` rows.

**Corrected 2026-08-08 — half of the token claim above is wrong, the other half
just went live.** Verified against `better-auth@1.6.26`, the version now
installed; the audit was written against 1.5.6.

- **Email verification writes no row at all.** The token is a JWT signed with
  `BETTER_AUTH_SECRET` (`api/routes/email-verification.mjs:13-19`), carried
  entirely in the URL. There is nothing in `verification` to leak or purge — the
  exposure moved to the secret instead, which is why #3 is now load-bearing.
- **Password reset does store a plaintext token, and this is newly reachable.**
  `request-password-reset` writes `identifier: "reset-password:<token>"` from
  `generateId(24)` (`api/routes/password.mjs:74-77`). Reset had no configured
  sender when the audit ran, so the path was dead; ADR 003 wired one, so these
  rows are now written in normal use. `/reset-password` consumes the row on
  success, but tokens that are never used — or that expire — stay forever. The
  purge in the fix above is the live half of this finding.

The `accessToken`/`refreshToken`/`idToken` plaintext storage is unaffected by
that correction and remains the larger part of #12.

### 13. Tenant data does not cascade on delete

`packages/db/migrations/0000_living_pet_avengers.sql:27-28, 37-38` — the `member`
and `invitation` tables use `ON DELETE no action` for both their organization and
user foreign keys, while `session` and `account` correctly cascade.

With foreign-key enforcement on, deleting a user or an organization fails with a
constraint error; without it, rows are orphaned. `invitation.email` retains the
personal email addresses of invitees after their organization is gone — a
residual-data leak and a GDPR-deletion problem.

**Fix:** `onDelete: "cascade"` on `member.organizationId`, `member.userId`, and
`invitation.organizationId`; decide cascade versus set-null for
`invitation.inviterId`.

**RESOLVED 2026-08-12** — migration `0002_flippant_namora.sql`. All four
foreign keys cascade, and `session.activeOrganizationId` — which had no
constraint at all — gained one with `ON DELETE set null`, so a deleted
organization can no longer leave a ghost id for `principal.ts` to hand
`/api/v1` as the caller's `organizationId`.

`invitation.inviterId` was decided as **cascade**. Set-null is the better
semantic — an invitation belongs to the organization, not to whoever sent
it — but it needs a nullable column and Better Auth's organization plugin
expects this one NOT NULL. Deleting an admin therefore voids the invitations
they sent; the organization can re-issue them. Revisit if the column becomes
nullable upstream.

`schema.test.ts` asserts the complete foreign-key set as one list, so a new
foreign key added without a delete behavior fails there rather than shipping.

**One half of the GDPR concern above is still open, and no constraint can
close it:** `invitation.email` is plain text with no foreign key to `user`, so
a pending invitation addressed to a deleted user's address survives every
cascade here. That needs an application-level sweep in the account-deletion
path — which does not exist yet (there is no delete-user or delete-organization
surface in the app today). It belongs with the work that adds one.

### 14. No `Cache-Control` on authenticated responses

`apps/web/app/entry.server.tsx:28-33` sets only `Content-Type`, and
`Cache-Control` appears nowhere in the repo. Dashboard loaders embed session user
data (name, email) into responses that carry no caching directive, leaving them
to browser and proxy heuristic caching, and to history exposure on shared
machines.

**Fix:** set `Cache-Control: no-store` for authenticated HTML and loader data
responses.

**RESOLVED 2026-08-08** — `noStoreForAuthenticated` in
`apps/web/server/security-headers.ts`, keyed on the request carrying a session
cookie rather than on a list of paths. A path list would have to be extended by
whoever adds the next authenticated route, which is the same failure mode as #10
and #15; keying on the credential covers new routes the day they appear.

Matches the cookie by suffix (`…session_token=`) so a `__Secure-` prefix does not
silently stop matching.

**Overrides a weaker `Cache-Control` rather than deferring to it.** Only an
existing `no-store` is preserved. `public, max-age=…` is obviously wrong on
personalized output, but `private` is overridden too: it keeps a response out of
shared caches while still allowing the user's own browser to store it, which
leaves the back-button-on-a-shared-machine exposure this finding names. A route
wanting its authenticated output cached has to opt out somewhere other than here.

**Immutable responses are cloned, not skipped.** `Response.redirect()` and
pass-through `fetch()` responses carry an immutable headers guard, and
`hono/secure-headers` writes without one — so such a response became a 500 that
also carried no security headers at all. `mutableResponse` rebuilds it first.
The three middlewares are exported as an ordered `securityMiddleware` list
because Hono unwinds post-`next()` code in reverse: the normaliser is registered
**last** so it runs **first**, and reordering them at the mount site would drop
the headers silently while every isolated unit test still passed.

### 15. No CSRF protection on the `/api/v1` mount

`apps/web/server/index.ts:33` mounts `apiApp` with no `hono/csrf` middleware and
no Origin validation. **Clean in practice today** — `api.ts` defines only
`GET /health` and `GET /doc`, and all current mutations go through Better Auth,
which has its own Origin-check CSRF protection. But CLAUDE.md directs developers
to add new API routes here, so the first cookie-authenticated POST ships
unprotected.

Same shape as finding 10: the `/api/v1` sub-app has no auth middleware either, so
every future route is unauthenticated by default rather than fail-closed.

**Fix:** add `csrf()` and a default `requireSession` middleware to `apiApp` now,
with explicit allowlisting for `/health` and `/doc`.

**RESOLVED 2026-08-08** — both guards now live on `apiApp` itself
(`apps/web/server/api.ts`) rather than at the mount, so they travel with the
routes they protect. `PUBLIC_OPERATIONS` allowlists `GET /health` and
`GET /doc` by method and path; everything
else calls `requirePrincipal`. The route list in the description above was
already stale by then — `/me` and `/tokens*` had shipped — which is the argument
for a default-deny rather than per-route vigilance.

Details that are not obvious:

- **Order matters.** The deny check runs _before_ CSRF. CSRF is only meaningful
  when the request carries an ambient credential to abuse; an anonymous caller
  should hear 401, not a confusing 403.
- **CSRF applies to session callers only.** Nothing attaches a bearer token
  automatically, so no cross-site page can cause one to be sent, and exempting
  them keeps the CLI working — it sends neither `Origin` nor `Sec-Fetch-Site`.
- **`hono/csrf` was tried and removed.** It only inspects requests whose
  `Content-Type` is form-shaped (`application/x-www-form-urlencoded`,
  `multipart/form-data`, `text/plain`) or absent — the shapes a cross-origin
  `<form>` can produce without a CORS preflight. That made it a **no-op on
  `application/json`**, which is what the settings UI sends on the only
  cookie-authenticated write in the app: a JSON POST carrying no origin headers
  reached the handler. Safe in practice today only because no CORS policy exists
  for a preflight to pass, which is an assumption a later config change would
  break with nothing failing to say so. Replaced by an explicit same-origin
  check on **every** unsafe method regardless of content type, reading
  `Sec-Fetch-Site` and falling back to `Origin` (Safari sent no `Sec-Fetch-*`
  before 16.4). Absent both, a cookie-authenticated write is refused.
- **The allowlist is keyed by method _and_ path.** Keyed by path alone,
  registering `POST /health` later would have made it public, and no existing
  test would have noticed because the route does not exist yet.
- **Unknown paths now 401 rather than 404** for anonymous callers. The guard runs
  before routing resolves, so it cannot know a route is absent. This is not
  surface hiding: `GET /doc` is public and lists every route the app serves
  (Low, "OpenAPI spec and version are publicly exposed"). What it removes is the
  404/401 difference as an oracle for probing paths the spec does **not**
  advertise.

`requireSession` was also fixed to throw `HTTPException` instead of a bare
`Response`: Hono's `compose()` only routes `Error` instances to the error
handler, so it had been surfacing as 500 rather than 401.

The test that keeps this true reads the OpenAPI spec and asserts every
advertised path is either allowlisted or refuses an anonymous caller, mounted and
unmounted (`apps/web/server/__tests__/api-guard.test.ts`) — the point being
routes that do not exist yet.

---

## Low

- **Theme cookie is unvalidated and can crash the app.**
  `packages/ui/src/hooks/use-theme.tsx:60` casts `getCookie("theme")` to `Mode`
  with no allowlist check, then passes it verbatim to `classList.add` at line 43.
  A value containing a space throws `InvalidCharacterError` inside the mount
  effect, unmounting the React tree — a trivial persistent client-side DoS for
  anyone who can set a cookie (subdomain, or plain HTTP since the cookie is
  written without `Secure` at line 22). Not XSS: `classList.add` is a DOM API,
  not an HTML sink. Separately, the parsing regex `/theme=([^;]+)/`
  (`use-theme.tsx:27`, `root.tsx:14`) also matches suffix-named cookies such as
  `x-theme=`, letting an unrelated cookie control the value. Fix: validate
  against `["dark","light","system"]`, anchor the regex with `(?:^|;\s*)theme=`,
  and add `Secure` on HTTPS.
- **`requireSession()` returned 500 instead of 401. RESOLVED 2026-08-08.**
  `packages/auth/src/helpers/session.ts:12-18` threw a raw `Response`, but Hono
  only routes `Error` instances to its error handler — a thrown `Response`
  escapes the fetch handler as a Worker exception. Fail-closed, so not a bypass,
  but the documented API guard was unusable as written. Now throws
  `HTTPException(401)` with a JSON body, matching `requirePrincipal`; covered in
  `packages/auth/src/__tests__/session.test.ts`. Fixed alongside #15, which is
  where the reasoning is recorded.
- **The authorization helpers are dead code.** `requireSession`, `hasRole`, and
  `ROLES` have zero call sites outside `packages/auth/src` and a non-routed
  `_examples` file, so no application-level role enforcement exists at all.
  (Organization role checks are delegated to Better Auth's plugin endpoints,
  which do enforce server-side, so nothing is currently reachable that shouldn't
  be.) Either wire them in as the canonical guard or delete them, so future
  developers don't assume protection that isn't there.
- **Missing indexes on hot auth-path lookup columns.** Only unique indexes exist
  (`user.email`, `session.token`, `organization.slug`). No index on
  `verification(identifier)`, `account(userId)`, `account(providerId, accountId)`,
  `session(userId)`, `member(userId, organizationId)`, or
  `invitation(email, organizationId)`. `docs/costs-and-limits.md:167-174` already
  lists these as a cost concern; the security angle is read amplification on
  every sign-in as the table grows, and full scans during cascade deletes.
  **RESOLVED 2026-08-12** alongside #13 — all of the above ship in
  `0002_flippant_namora.sql`, plus `apiToken(userId)` and
  `apiToken(organizationId)`. The rule applied was: index every foreign-key
  child column (so no cascade scans) plus the named non-key lookups
  (`verification(identifier)`, `invitation(email)`, and the composite
  `account(providerId, accountId)`). `session(activeOrganizationId)` is
  deliberately absent — it would serve only that column's set-null, and the
  table takes a write on every sign-in. `schema.test.ts` asserts the index set
  exactly, so an index without a stated consumer fails as loudly as a missing
  one.
- **Production deploys report `ENVIRONMENT: "development"`.**
  `apps/web/wrangler.jsonc:18-19` sets it with no `env.production` override and
  no `workers_dev: false`. Harmless today since nothing branches on it, but any
  future "relax X in development" logic will silently apply in production.
  **Update:** both halves are closed. `deploy:web` overrides `ENVIRONMENT` with
  `--var ENVIRONMENT:production`, and the missing `workers_dev: false` was a
  misreading — wrangler resolves the absent key to `routes.length === 0` and
  points `preview_urls` at the same value, so the two `custom_domain` routes
  already turn both off. Writing it out was tried and reverted: `init:product`
  strips `routes` and nothing else, so a clone would inherit an explicit `false`
  with no routes to justify it and deploy a Worker with no public hostname. The
  inference is documented above the `routes` block instead. Since issue #6, a
  hostname that neither origin variable names is refused in split mode anyway,
  which covers either being switched back on.
- **OpenAPI spec and version are publicly exposed.** `apps/web/server/api.ts:30`
  serves `/api/v1/doc` unconditionally, and `/health` returns `APP_VERSION`
  (line 26) — free reconnaissance and deployment fingerprinting as the API grows.
- **`.gitignore` misses env-file variants.** Lines 10 and 14-16 use exact names,
  so Wrangler's `.dev.vars.<environment>` files and bare `.env.staging` /
  `.env.production` are trackable. Fix: `.dev.vars*` and `.env*`, re-including
  `.env.example`. **Resolved 2026-08-06** — patterns broadened exactly as
  suggested, with `!.dev.vars.example` also re-included; committed
  `.dev.vars.example` templates now exist in both apps.
- **Password policy is the framework default.** No `minPasswordLength` is set, so
  the default 8 applies; `register.tsx:149` adds only a browser-side
  `minLength={8}`. Weak in combination with the absent rate limiting. **Partly
  mitigated 2026-08-08** by #4: sign-in is now 10 attempts per minute per
  address, so an 8-character password is no longer freely guessable. The policy
  itself is still the default.
- **Open registration and open organization creation.** No `disableSignUp` and
  `allowUserToCreateOrganization: true` (`server.ts:45-50`), which with no rate
  limiting permits unbounded automated account and tenant creation — D1 row
  growth and cost amplification. Reasonable as a starter default, but should be a
  documented, conscious switch. **Partly mitigated 2026-08-08** — `/sign-up/email`
  is capped at 3 per minute per address by #4. Organization creation is not: it
  is behind a session, so it falls in the `default` class at 120 per minute.
- **Session lifetime is untuned.** No `session` option, so: 7-day expiry, 1-day
  rolling refresh (an active session renews indefinitely), no cookie cache — so
  every dashboard request hits D1 — and no absolute cap or
  revocation-on-password-change.
- **Full secret-bearing env is spread into loader context.**
  `apps/web/load-context.ts:32` exposes `cloudflare.env` — including
  `BETTER_AUTH_SECRET` and OAuth client secrets — to every loader. Server-side
  only and no route reads it today, but one careless `return context.cloudflare.env`
  serializes secrets into client-visible JSON. Consider passing a narrowed object.
- **Real account identifiers committed to a public-facing starter.
  Half fixed, half accepted 2026-08-09.** As written this cited
  `CLAUDE.md:120-121` and `apps/web/wrangler.jsonc:14` for a production
  workers.dev URL and D1 database ID; both line refs are now stale — `CLAUDE.md`
  is 46 lines and delegates to `AGENTS.md`, and `wrangler.jsonc:14` is a comment
  about `custom_domain`.
  - The **workers.dev URL is gone** (PR #12). Every remaining `workers.dev`
    string in the tree is a placeholder (`<your-mcp-worker>`, `your-app`,
    `example.workers.dev`) or a comment.
  - The **D1 database ID stays** — `apps/web/wrangler.jsonc:62` and the matching
    line in `apps/mcp/wrangler.jsonc`, plus the Deployment section of
    `AGENTS.md`. **Accepted, not deferred.** It is unusable without an account
    API token; it must match across both wrangler files for the MCP Worker to
    reach the same users, so a placeholder would break the invariant the
    comments exist to protect; and `AGENTS.md` documents that every clone mints
    its own identity through `pnpm init:product`, which localises `database_id`
    and strips `routes`. Revisit only if the threat model gains an attack that
    an account-scoped id enables on its own.
- **Seed SQL is interpolated into a shell command.**
  `packages/cli/src/db-seed.ts:15-17` builds a double-quoted `execSync` string
  from `seedSQL`. That constant is static today, so it is not exploitable, but
  the pattern becomes shell and SQL injection the moment anyone interpolates env,
  argv, or faker data. Fix: write to a temp file and use
  `wrangler d1 execute --file`, or use `execFileSync` with an argument array.
- **Loose semver ranges with no CI to pin them.** `better-auth: "^1"`,
  `hono: "^4"`, `react-router: "^7"`, `wrangler: "^4"` are maximally loose. The
  committed lockfile mitigates this, but no CI exists to enforce
  `--frozen-lockfile`, so a plain `pnpm install` can silently jump minors.
- **Dev-toolchain advisories** (not shipped to production Workers, exploitable on
  the dev machine): `vitest@3.2.4` GHSA-5xrq-8626-4rwp (Critical, requires the
  Vitest UI server running), `shell-quote@1.8.3` GHSA-w7jw-789q-3m8p (Critical),
  `vite@6.4.1` GHSA-p9ff-h696-f583 (High, dev-server arbitrary file read),
  `undici@7.24.4` GHSA-vmh5-mc38-953g (High, TLS-validation bypass),
  `postcss`, `brace-expansion`, `sharp`, `turbo`.
- **MCP SDK transitives.** `@modelcontextprotocol/sdk@1.29.0` pulls
  `fast-uri@3.1.0` (4 High — host confusion and path traversal, fixed 3.1.5) and
  `ip-address@10.1.0` (GHSA-mwp4-54f8-5fhr).

Full audit counts from the lockfile: **3 critical, 36 high, 42 moderate, 8 low
in production dependencies** (89 total); 3/37/48/10 including dev.

---

## Verified clean

These were actively checked and found sound — worth recording so future passes
don't re-litigate them.

- **SQL injection** — no `sql` template literals, `sql.raw`, `db.run`, or
  string-built queries anywhere. All access is Drizzle schema definitions plus
  Better Auth's parameterized adapter. No dynamic column or table names.
- **XSS** — the single `dangerouslySetInnerHTML` (`root.tsx:28`) injects a static
  compile-time constant with zero interpolation. No `eval`, `new Function`,
  `innerHTML`, `insertAdjacentHTML`, or `document.write` in any source file. No
  component renders raw HTML strings.
- **Open redirect** — no `redirectTo`/`returnUrl` parameter exists anywhere; all
  `redirect()` and `callbackURL` targets are hardcoded paths.
- **Command injection in CLI scripts** — `db-migrate` derives its flag from a
  boolean, `version-bump` allowlists the level and builds the tag from
  `Number()`-parsed components, and `db-generate`/`db-reset` run fully static
  commands. No path traversal: all file paths are hardcoded.
- **Token storage** — no `localStorage` or `sessionStorage` use in any source
  file. Sessions are HttpOnly-cookie only, and `auth-client.ts:3` correctly uses
  a same-origin client.
- **Session cookie flags** — no overrides, so Better Auth defaults apply:
  `httpOnly: true`, `sameSite: "lax"`, and the `__Secure-` prefix selected from
  the HTTPS `baseURL`. Correct for this deployment.
- **`trustedOrigins`** — unset, which safely defaults to the `baseURL` origin.
  No wildcard anywhere. (Adding a custom domain alongside workers.dev will break
  auth until this is set explicitly — document rather than reaching for a
  wildcard.) **Update, issue #6:** in split-origin mode `server/origins.ts` now
  refuses any host that is neither `BETTER_AUTH_URL` nor `MARKETING_URL`, so the
  workers.dev hostname 404s before auth constructs rather than serving an auth
  surface `trustedOrigins` does not cover. Single-origin deploys are unchanged
  and this note still applies to them.
- **Secrets in git history** — a value-by-value `git grep` across every commit in
  `git rev-list --all` confirms the real GitHub, Google, and Better Auth secrets
  in `apps/web/.dev.vars` have **never** entered git. No `.env`/`.dev.vars`/key
  files are tracked, and no secret-like files were deleted in history. Only the
  placeholder secret and empty-string OAuth IDs were ever committed.
- **Seeds cannot touch production** — `db-seed.ts:16` and `db-reset.ts:19`
  hardcode `--local`. No credentials are seeded (the `admin@example.com` user has
  no `account` row, so password login for it is impossible).
- **E2E tests** — `playwright.config.ts` targets `localhost:5173` only;
  `auth.spec.ts` uses a per-run throwaway user. No production URLs, no real
  credentials. `test-results/` is gitignored, untracked, and contains no traces.
- **Logging** — nothing logs sessions, tokens, emails, or request bodies. The
  only runtime logger is `console.error(error)` for SSR render errors.
- **Error handling** — no custom `onError`, so Hono's generic
  "Internal Server Error" and "404 Not Found" responses leak no stack traces or
  Drizzle detail. (Add a structured handler before shipping real endpoints.)
- **Mass assignment** — no endpoint spreads a request body into a DB write.
- **Input validation** — the only endpoint (`GET /health`) accepts no input and
  is defined through `@hono/zod-openapi`. Nothing is unvalidated because nothing
  takes input yet.
- **CORS on the web app** — no `cors()` middleware exists, so nothing reflects
  `Origin`. Same-origin default is the correct posture.
- **Supply chain hygiene** — zero lifecycle scripts across all 8 workspace
  manifests; no typosquats; `pnpm-lock.yaml` committed with `packageManager`
  pinned; repo `.npmrc` has no registry override or integrity bypass;
  `turbo.json` carries no tokens.
