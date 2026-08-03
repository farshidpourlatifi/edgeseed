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

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| 1 | Critical | `better-auth@1.5.6` account-takeover advisories | Live |
| 2 | High | Account pre-hijacking via unverified signup + implicit OAuth linking | Live |
| 3 | High | `BETTER_AUTH_SECRET` unvalidated; silent fallback to a public default | Live footgun |
| 4 | High | No rate limiting on any auth endpoint | Live |
| 5 | High | No security response headers anywhere | Live |
| 6 | High | Vulnerable `hono`, `drizzle-orm`, `react-router` versions | Live |
| 7 | High | Global `~/.npmrc` uses plaintext HTTP registry with TLS off | Live (machine) |
| 8 | Medium | MCP server has no authentication | Latent |
| 9 | Medium | `BETTER_AUTH_SECRET` committed in `apps/mcp/wrangler.jsonc` | Live |
| 10 | Medium | Dashboard child loaders do not enforce auth themselves | Pattern risk |
| 11 | Medium | IP-derived controls trust spoofable `x-forwarded-for` | Live |
| 12 | Medium | OAuth and verification tokens stored in plaintext, never purged | Live |
| 13 | Medium | `member`/`invitation` foreign keys do not cascade on delete | Live |
| 14 | Medium | No `Cache-Control` on authenticated responses | Live |
| 15 | Medium | No CSRF protection on the `/api/v1` mount | Pattern risk |

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

### 3. A missing `BETTER_AUTH_SECRET` silently signs sessions with a publicly-known default

*Verified directly against the installed package during this audit.*

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

**Fix:** add a KV binding as `secondaryStorage` and set
`rateLimit: { enabled: true, storage: "secondary-storage" }` with stricter
`customRules` on `/sign-in/email` and `/sign-up/email`; or add a Cloudflare Rate
Limiting rule scoped to `/api/auth/*`. Combine with finding 11 — an IP-keyed
limiter is worthless while the IP is spoofable.

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

### 7. Global `~/.npmrc` fetches packages over plaintext HTTP with TLS verification disabled

*Machine-level, outside the repo, but it governs every install into this repo.*

`/Users/farshid/.npmrc` contains `strict-ssl=false` and
`registry=http://registry.npmjs.org/`. Every `pnpm install` on this machine
fetches packages over unencrypted HTTP with certificate validation turned off,
which allows trivial man-in-the-middle package substitution. This was observed
during the audit: `pnpm audit` failed with a `426` because the registry now
mandates HTTPS.

The committed `pnpm-lock.yaml` contains integrity hashes and no `http://` URLs,
so existing dependencies are still constrained — but a MITM'd fresh install of
any *new* package would be poisoned at lockfile-creation time and the bad hash
would then be committed as truth.

**Fix:** set `registry=https://registry.npmjs.org/` and delete
`strict-ssl=false` from `~/.npmrc`. The repo's own `.npmrc` is clean.

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

### 11. IP-derived controls trust the first `x-forwarded-for` entry, which is client-spoofable

`packages/auth/src/server.ts:19-51` sets no `advanced.ipAddress.ipAddressHeaders`
override, so Better Auth defaults to reading `x-forwarded-for` and taking
`split(",")[0]`. Cloudflare **appends** the real visitor IP to any client-supplied
`X-Forwarded-For` header, so the first entry is fully attacker-controlled.

That value keys the rate limiter and is recorded as `session.ipAddress`, so any
IP-keyed throttling is bypassed by rotating a spoofed header, and session audit
data is unreliable.

**Fix:** set `advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } }`.

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

### 14. No `Cache-Control` on authenticated responses

`apps/web/app/entry.server.tsx:28-33` sets only `Content-Type`, and
`Cache-Control` appears nowhere in the repo. Dashboard loaders embed session user
data (name, email) into responses that carry no caching directive, leaving them
to browser and proxy heuristic caching, and to history exposure on shared
machines.

**Fix:** set `Cache-Control: no-store` for authenticated HTML and loader data
responses.

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
- **`requireSession()` returns 500 instead of 401.**
  `packages/auth/src/helpers/session.ts:12-18` throws a raw `Response`, but Hono
  only routes `Error` instances to its error handler — a thrown `Response`
  escapes the fetch handler as a Worker exception. Fail-closed, so not a bypass,
  but the documented API guard is unusable as written. Fix: throw
  `HTTPException(401)` from `hono/http-exception`.
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
- **Production deploys report `ENVIRONMENT: "development"`.**
  `apps/web/wrangler.jsonc:18-19` sets it with no `env.production` override and
  no `workers_dev: false`. Harmless today since nothing branches on it, but any
  future "relax X in development" logic will silently apply in production.
- **OpenAPI spec and version are publicly exposed.** `apps/web/server/api.ts:30`
  serves `/api/v1/doc` unconditionally, and `/health` returns `APP_VERSION`
  (line 26) — free reconnaissance and deployment fingerprinting as the API grows.
- **`.gitignore` misses env-file variants.** Lines 10 and 14-16 use exact names,
  so Wrangler's `.dev.vars.<environment>` files and bare `.env.staging` /
  `.env.production` are trackable. Fix: `.dev.vars*` and `.env*`, re-including
  `.env.example`.
- **Password policy is the framework default.** No `minPasswordLength` is set, so
  the default 8 applies; `register.tsx:149` adds only a browser-side
  `minLength={8}`. Weak in combination with the absent rate limiting.
- **Open registration and open organization creation.** No `disableSignUp` and
  `allowUserToCreateOrganization: true` (`server.ts:45-50`), which with no rate
  limiting permits unbounded automated account and tenant creation — D1 row
  growth and cost amplification. Reasonable as a starter default, but should be a
  documented, conscious switch.
- **Session lifetime is untuned.** No `session` option, so: 7-day expiry, 1-day
  rolling refresh (an active session renews indefinitely), no cookie cache — so
  every dashboard request hits D1 — and no absolute cap or
  revocation-on-password-change.
- **Full secret-bearing env is spread into loader context.**
  `apps/web/load-context.ts:32` exposes `cloudflare.env` — including
  `BETTER_AUTH_SECRET` and OAuth client secrets — to every loader. Server-side
  only and no route reads it today, but one careless `return context.cloudflare.env`
  serializes secrets into client-visible JSON. Consider passing a narrowed object.
- **Real account identifiers committed to a public-facing starter.**
  CLAUDE.md:120-121 and `apps/web/wrangler.jsonc:14` carry the production
  workers.dev URL and D1 database ID. Not exploitable without an API token, but
  together they identify the Cloudflare account and name a concrete production
  target for the unauthenticated surfaces above. Replace with placeholders before
  publishing.
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
  wildcard.)
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
