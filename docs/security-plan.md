# Security Fix & Test Plan

Companion to [security-audit.md](./security-audit.md). Findings are referenced by
their number there (e.g. **A3** = audit finding 3).

Two parts:

1. **Remediation phases** — ordered by risk-reduction per unit of effort, each
   fix paired with the test that proves it holds.
2. **The standing pass** — a repeatable checklist to re-run whenever the audit
   needs refreshing, so security review becomes routine rather than a one-off.

---

## Phase 0 — Do this before anything else (minutes)

Nothing here requires a code change; these are checks that determine whether you
are dealing with a live incident or a latent risk.

### 0.1 Confirm the production auth secret is actually set — **A3**

The audit could not verify this (wrangler needs interactive Cloudflare auth).
If the secret is unset, sessions are currently signed with a public constant and
anyone can forge a login.

```bash
cd apps/web && npx wrangler secret list
```

Expect `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` in the output.

**If either is missing:** treat it as an active compromise of session integrity.
Set a fresh 32+ character secret, redeploy, and accept that all existing sessions
are invalidated (which is the desired outcome — it evicts any forged ones).

```bash
openssl rand -hex 32 | npx wrangler secret put BETTER_AUTH_SECRET
```

### 0.2 Fix the machine-level registry configuration — **A7**

Every install into this repo currently runs over plaintext HTTP with TLS
verification off. Edit `~/.npmrc`: set `registry=https://registry.npmjs.org/` and
delete the `strict-ssl=false` line.

**Test:** `npm config get registry` returns the HTTPS URL, and
`npm config get strict-ssl` returns `true`.

---

## Phase 1 — Dependency upgrades (hours, highest risk reduction)

This phase alone closes the critical and several high findings. Do it first
because the code-level fixes in Phase 2 partly depend on APIs from newer
`better-auth`.

### 1.1 Upgrade the four framework dependencies — **A1, A6**

| Package        | From   | To (minimum) | Why                                                |
| -------------- | ------ | ------------ | -------------------------------------------------- |
| `better-auth`  | 1.5.6  | **1.6.22**   | account takeover, OAuth replay, org-invite bypass  |
| `hono`         | 4.12.9 | **4.12.34**  | CORS credential reflection, `app.mount()` path bug |
| `drizzle-orm`  | 0.41.0 | **0.45.2**   | SQL injection via identifiers                      |
| `react-router` | 7.13.2 | **7.18.0**   | turbo-stream RCE primitive, DoS, open redirect     |

The `drizzle-orm` **range** must change, not just the lockfile — `^0.41` can
never resolve to `0.45.2` under semver. Same reasoning argues for tightening the
other three from bare majors (`^1`, `^4`, `^7`) to minor-pinned ranges.

```bash
pnpm --filter @starter/auth add better-auth@^1.6.22
pnpm --filter @starter/db add drizzle-orm@^0.45.2
pnpm --filter @starter/web add hono@^4.12.34 react-router@^7.18.0
pnpm install
```

**Tests after upgrading:**

```bash
pnpm audit --prod --registry=https://registry.npmjs.org/
pnpm typecheck && pnpm test
cd apps/web && npx react-router typegen && cd ../..
pnpm test:e2e
```

Expect the critical count to drop to zero and the production high count to fall
sharply. `better-auth` 1.5→1.6 and `drizzle-orm` 0.41→0.45 both cross minor
boundaries — read their changelogs and re-run migrations against a local D1 to
confirm the schema still generates identically:

```bash
pnpm db:reset && pnpm db:generate
```

`git diff packages/db/migrations/` should show no unexpected drift.

### 1.2 Refresh the dev toolchain and MCP SDK — **A (low)**

```bash
pnpm update -r --latest --filter '!@starter/auth' --filter '!@starter/db'
```

Then re-run `pnpm test` and `pnpm dev` to confirm nothing broke. Verify
`@modelcontextprotocol/sdk` picked up `fast-uri >= 3.1.5`.

---

## Phase 2 — Close the fail-open auth defaults (days)

These are the findings where the code is "correct" today but wrong the moment
the starter is used for a real product.

### 2.1 Fail closed on missing or weak env — **A3**

The schema already exists and is already correct
(`packages/config/src/env.ts:6`). It simply has no callers. Wire
`parseEnv(webEnvSchema, c.env)` into `authMiddleware` (or worker init) and let it
throw.

**Test** — add to `packages/config` or `packages/auth`:

```ts
it("rejects a missing secret", () => {
  expect(() => parseEnv(webEnvSchema, { DB: {} })).toThrow();
});
it("rejects a short secret", () => {
  expect(() => parseEnv(webEnvSchema, { BETTER_AUTH_SECRET: "short" })).toThrow();
});
it("rejects better-auth's default secret", () => {
  expect(() =>
    parseEnv(webEnvSchema, { BETTER_AUTH_SECRET: "better-auth-secret-12345678901234567890" }),
  ).toThrow();
});
```

That third case needs an explicit `.refine()` on the schema — length alone does
not catch it, and it is precisely the value that ships silently today.

### 2.2 Require email verification and disable implicit account linking — **A2**

In `packages/auth/src/server.ts`: set
`emailAndPassword.requireEmailVerification: true`, add an
`emailVerification.sendVerificationEmail` sender, add a `sendResetPassword`
sender (password reset is currently non-functional), and configure
`account.accountLinking` with `disableImplicitLinking: true` or an explicit
`trustedProviders` allowlist.

This needs an email transport — Resend or Cloudflare Email Routing. That
dependency is why this is Phase 2 and not Phase 1.

**Test** — the pre-hijacking scenario, as an e2e test:

1. Register `victim@example.com` with an attacker-chosen password.
2. Assert sign-in is refused before verification.
3. Simulate a Google sign-in for the same address.
4. Assert a **new** account is created, or linking is refused — not that the
   identity merges into the attacker's row.

### 2.3 Add real rate limiting — **A4, A11**

Two halves, and both are required — an IP-keyed limiter is worthless while the IP
is spoofable:

1. Add a KV namespace binding, wire it as Better Auth's `secondaryStorage`, and
   set `rateLimit: { enabled: true, storage: "secondary-storage" }` with stricter
   `customRules` on `/sign-in/email` and `/sign-up/email`. Do **not** rely on the
   default: it keys on `NODE_ENV`, which Workers never set, and its memory
   storage is discarded every request because `createAuth()` is re-instantiated
   per request.
2. Set `advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } }`.
   Cloudflare appends to client-supplied `X-Forwarded-For`, so the default
   `split(",")[0]` is attacker-controlled.

**Test:** an e2e test that fires 20 failed sign-ins in a loop and asserts a 429
before the 20th. Then repeat it while sending a rotating spoofed
`X-Forwarded-For` header and assert the 429 still arrives — that second
assertion is the one that catches a regression on the header config.

### 2.4 Add security headers — **A5, A14**

Add `secureHeaders()` from `hono/secure-headers` as the **first** middleware in
`apps/web/server/index.ts`, with at minimum `frame-ancestors 'none'` /
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, and HSTS. The inline theme
script at `apps/web/app/root.tsx:28` needs a CSP nonce or hash — compute the
hash, since the script is static by design.

Separately set `Cache-Control: no-store` on authenticated HTML and loader
responses.

**Test:**

```bash
curl -sI https://starter-web.farshid-pourlatifi-3fa.workers.dev/login | grep -iE 'content-security|x-frame|x-content-type|referrer-policy|strict-transport'
```

Better, as an e2e assertion so it cannot regress silently:

```ts
const res = await request.get("/login");
expect(res.headers()["x-frame-options"]).toBe("DENY");
expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
```

Then confirm the app still renders — a CSP that blocks the theme script produces
a flash of unstyled content rather than a hard error, so check visually, not just
for a 200.

### 2.5 Make the API surface fail closed — **A10, A15**

- Add `csrf()` from `hono/csrf` to `apiApp`.
- Add a default session-check middleware to `apiApp`, allowlisting `/health` and
  `/doc`, so new routes are authenticated unless explicitly opted out.
- Fix `requireSession()` to throw `HTTPException(401)` from `hono/http-exception`
  instead of a raw `Response` — Hono only routes `Error` instances to its error
  handler, so today it surfaces as a 500.
- Add a shared `requireUser(context, request)` helper, call it in **every**
  dashboard child loader, and correct the "Auth guard" convention in CLAUDE.md,
  which currently implies the layout loader is sufficient.

**Test:** a test that enumerates every registered `/api/v1` route and asserts
each one either appears in the allowlist or returns 401 unauthenticated. That
shape is what keeps the guarantee true for routes that don't exist yet.

---

## Phase 3 — Data handling and hardening (days)

### 3.1 Secrets and config hygiene — **A9, A (low)**

- Remove `BETTER_AUTH_SECRET` from `apps/mcp/wrangler.jsonc`; move to
  `apps/mcp/.dev.vars` and `wrangler secret put`, mirroring what commit `4dba41c`
  did for the web app.
- Broaden `.gitignore` to `.dev.vars*` and `.env*`, re-including `.env.example`.
- Add an `env.production` block setting `ENVIRONMENT: "production"`.
- Replace the real workers.dev URL and D1 database ID in CLAUDE.md with
  placeholders before publishing the starter.
- Narrow `load-context.ts` to pass a specific env subset rather than spreading
  everything including secrets into every loader.

**Test:** `git grep -iE 'BETTER_AUTH_SECRET.*[:=].*[a-z0-9]{16}' -- '*.jsonc' '*.json' '*.ts'`
returns nothing. Add this to the standing pass below.

### 3.2 Database schema corrections — **A12, A13**

- Add `onDelete: "cascade"` to `member.organizationId`, `member.userId`, and
  `invitation.organizationId`; decide cascade vs set-null for
  `invitation.inviterId`.
- Add indexes on `verification(identifier)`, `account(userId)`,
  `account(providerId, accountId)`, `session(userId)`, `member(userId)`, and
  `invitation(email)`.
- Add a scheduled purge of expired `verification` rows (a Cron Trigger).
- Document the plaintext storage of OAuth tokens and verification values, or
  encrypt them via Better Auth database hooks.

```bash
pnpm db:generate && pnpm db:migrate
```

**Test:** a Vitest case that creates an org with members and invitations, deletes
the org, and asserts no orphaned rows remain. Currently this would fail with a
constraint error — that failure _is_ the bug being fixed.

### 3.3 Client-side hardening — **A (low)**

In `packages/ui/src/hooks/use-theme.tsx`: validate the cookie against
`["dark","light","system"]` before use, anchor the parsing regex to
`(?:^|;\s*)theme=` so `x-theme=` cannot hijack it, and append `Secure` on HTTPS.
Apply the same regex fix to the inline script in `root.tsx:14`.

**Test:** a unit test asserting `getResolvedMode` falls back to a safe default
for `"dark evil-class"`, `""`, and `"../../etc"`, and that a `x-theme=dark`
cookie does not set the theme.

### 3.4 CLI hardening — **A (low)**

Rewrite `packages/cli/src/db-seed.ts` to write SQL to a temp file and invoke
`wrangler d1 execute --file`, or use `execFileSync` with an argument array, so no
shell string is ever built from SQL.

---

## Phase 4 — MCP server (do not deploy before this) — **A8**

The MCP worker is currently unbuildable, and **that broken build is the only
thing keeping its unauthenticated endpoints off the internet.** It is an
accidental control. Whoever fixes the build removes it.

So: land all of this in the _same_ change that makes the worker buildable.

1. Add the missing `agents` dependency, the Durable Object binding, and the
   migration that `McpAgent` requires; replace `database_id: "local"`.
2. Gate `fetch` before `serve()` — `workers-oauth-provider`, a bearer token, or
   Cloudflare Access.
3. Validate the `Origin` header against an allowlist (the MCP spec requires this
   on HTTP transports as DNS-rebinding protection) and pass explicit
   `corsOptions` rather than inheriting SDK defaults.
4. Thread the authenticated principal into `ToolContext` so tools can scope
   queries by user and organization, and note in
   `apps/mcp/src/tools/index.ts` that no tool may query D1 without a resolved
   principal.

**Test:** `curl` both `/sse` and `/mcp` with no credentials and assert 401; with
a valid token assert the handshake succeeds; with a foreign `Origin` assert 403.

---

## The standing pass

Re-run this whenever dependencies change, before any deploy that touches auth,
and on a schedule (monthly is reasonable for a starter). It is deliberately
mechanical — the point is that it needs no judgment to execute, so it actually
gets done.

### Automated checks

```bash
pnpm audit --prod --registry=https://registry.npmjs.org/
```

```bash
git grep -nE '(secret|token|password|client_secret)\s*[:=]\s*["'"'"'][A-Za-z0-9_\-]{16,}' -- '*.ts' '*.tsx' '*.json' '*.jsonc'
```

```bash
git ls-files | grep -iE '\.(env|dev\.vars|pem|key)' && echo "TRACKED SECRET FILE" || echo "clean"
```

```bash
git grep -nE 'dangerouslySetInnerHTML|eval\(|new Function|innerHTML|localStorage|sessionStorage' -- '*.ts' '*.tsx'
```

```bash
git grep -nE 'sql\.raw|db\.run\(|execSync\(`|\$\{.*\}.*(SELECT|INSERT|UPDATE|DELETE)' -- '*.ts'
```

Each grep is a **tripwire, not a verdict** — every current hit is documented as
clean in the audit's "Verified clean" section. A _new_ hit is what warrants
investigation.

### Manual review questions

Ask these of every diff that adds a route, endpoint, or table:

1. **Every new `/api/v1` route** — does it validate input with Zod, and does it
   check the session? (Until Phase 2.5 lands, the mount is unauthenticated by
   default, so this is on the author.)
2. **Every new dashboard child route** — does its loader call the auth guard
   itself, rather than relying on the layout?
3. **Every new table holding tenant data** — is every query filtered by the
   caller's verified organization membership, not by an ID from the request?
4. **Every new MCP tool** — does it resolve an authenticated principal before
   touching `db`?
5. **Every new form or mutation** — is it CSRF-protected, and does it derive the
   acting user from the session rather than from form input?
6. **Any new secret** — is it in `wrangler secret put` and `.dev.vars`, never in
   `wrangler.jsonc`?

### Re-running the full audit

The ten lenses used for the original audit, suitable for re-running as parallel
agents: secrets and git history; auth configuration and sessions; authorization
and tenancy isolation; injection and unsafe execution; XSS and client-side;
headers, CSRF, CORS, and cookies; API surface, validation, and error handling;
MCP server exposure; dependencies and supply chain; infrastructure config and
data handling.

Keeping the lenses stable across runs is what makes results comparable over time
— a finding that disappears should disappear because it was fixed, not because
nobody looked that direction this round.

### Suggested CI gate

No CI exists today, which is why the loose semver ranges in **A (low)** carry
real risk. A minimal GitHub Actions workflow closes several findings at once:

```yaml
- run: pnpm install --frozen-lockfile
- run: pnpm audit --prod
- run: pnpm typecheck && pnpm test
```

`--frozen-lockfile` is the load-bearing flag: it prevents a plain `pnpm install`
from silently jumping minor versions on `better-auth`, `hono`, or
`react-router`.

---

## Suggested ordering summary

| Phase | Effort  | Closes                             | Do it when                                  |
| ----- | ------- | ---------------------------------- | ------------------------------------------- |
| 0     | Minutes | A3 (verify), A7                    | **Now**                                     |
| 1     | Hours   | A1, A6, dev-toolchain              | **Now** — highest risk reduction per effort |
| 2     | Days    | A2, A3, A4, A5, A10, A11, A14, A15 | Before any real user data                   |
| 3     | Days    | A9, A12, A13, low findings         | Before publishing the starter               |
| 4     | Days    | A8                                 | Before the MCP worker is ever deployed      |
