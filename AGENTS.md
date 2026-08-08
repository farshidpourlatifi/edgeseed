# AGENTS.md

**Canonical instructions for this repository.** Every coding agent reads this
file. `CLAUDE.md` imports it and adds only Claude-Code-specific notes — put
project knowledge here, not there, so there is one source of truth.

Cloudflare-native monorepo starter for shipping SaaS products fast. Full V1 spec:
`docs/starter-v1-scope.md`.

---

## License

MIT. The `LICENSE` file at the repo root is canonical — it covers every file
here, including `docs/`.

- **Never add per-file license headers.** The root file already covers the tree;
  headers would be noise across every source file and drift the moment one is
  copied.
- `init:product` rewrites `product.ts` and both `wrangler.jsonc` files but
  deliberately leaves `LICENSE` alone. MIT requires a clone to retain the notice
  for the starter portions it keeps, so stripping it in a downstream repo is a
  licensing bug, not a cleanup.
- The license grants no rights to the **EdgeSeed** name or `edgeseed.dev`. MIT is
  silent on trademarks, and silence is not a grant — a fork may use the code, not
  the identity.

---

## Git and outward-facing actions

### Permission is per instance. It never propagates.

"Commit" authorises **one** commit. "Push" authorises **one** push. The next
one — however similar, however obviously wanted — needs its own ask. There is no
such thing as being "in push mode".

None of these grant permission for the next commit or push:

- having been told to commit or push earlier in the session, even minutes ago
- an open PR you were asked to create
- being midway through a task the user asked for
- the work being finished, verified, or green in CI
- the user saying "looks good", "nice", "continue", or "go on"
- fixing review comments on a branch you were previously told to push

Local work needs no permission — edit, run, test, verify freely. The line is
anything that leaves this machine or is hard to undo.

- **Commit only when asked.** Not after "that's done", not to checkpoint work.
- **Push only when asked.** Report that the work is ready to push, then stop and
  wait for the answer.
- **Never merge a PR** without an explicit yes to that merge. Same for closing
  PRs or issues, deleting branches, or publishing anything.
- **Never `push --force`**, and never rewrite already-pushed history.
- **Branch before committing if on `main`.**
- **Never `--no-verify`.** The pre-commit hook runs lint-staged and the gitleaks
  secret scan; skipping it is how a credential reaches the remote.

The point is not ceremony. These are the actions where being wrong is expensive
and hard to walk back, so asking costs far less than assuming. If unsure whether
an approval still applies: it does not. Ask.

### GitHub CLI

This repo belongs to a personal account while a work account may also be logged
in, and which one is active is **not stable**. Prefix every `gh` call:

```bash
GH_TOKEN=$(gh auth token --user <personal-account>) gh ...
```

Unprefixed calls fail with `Could not resolve to a Repository`, which reads like
a missing repo rather than an auth mismatch. Do not use `gh auth switch` — it is
global state and silently repoints other sessions.

### Secret files are never read

`.dev.vars`, `.env`, and any variant of either (`.dev.vars.*`, `.env.*` —
Wrangler supports per-environment files) hold live credentials. Never read them —
no `cat`, no `grep`, no `echo`, no Read tool. Contents that enter a transcript
have left this machine, and gitleaks cannot help because nothing was committed.
`*.example` files are placeholder templates and are fine to read. To audit a
real file's shape, list key names only — `cut -d= -f1 apps/web/.dev.vars` —
and compare names against the example, never values.

---

## Verifying before claiming

- `pnpm build` proves a Worker **compiles**. `pnpm check:boot` proves it
  **runs**. Never report a Worker as working on the strength of a build.
- `pnpm verify` is the gate: lint, format, tests, gitleaks, build, typecheck,
  boot check, e2e. Run it before calling work complete.
- **Stop dev servers before `pnpm test:e2e`.** e2e global-setup runs `db:reset`;
  a server holding the dropped D1 file makes every auth call fail with
  `SQLITE_CANTOPEN`, and an orphaned dev server bound IPv6-only produces
  `ERR_CONNECTION_REFUSED`. Both look like code regressions and are not.
- When you invalidate a claim in one file, **grep for its other homes**. Docs
  that contradict the code are worse than missing docs, because they are trusted.
- Do not read live project files as test fixtures. `pnpm init:product` rewrites
  `wrangler.jsonc` and `packages/config/src/product.ts` in every downstream
  clone, so a test asserting on their current contents fails permanently there.
- Every guard ships with a test for its **deny** path, not just its allow path.

---

## Engineering principles

Pragmatic programming governs everything below: principles are tools for
shipping correct, maintainable code, not scripture. When two collide, choose
what leaves the code easiest to change, and say why in the PR instead of
applying a rule silently.

Applied in this order:

1. **Clean code** — the baseline. Names say what things are, functions do one
   thing, dead code is deleted rather than commented out. Match the idiom of
   the file you are in.
2. **SOLID** — the shape that keeps modules replaceable and testable:
   - **Single responsibility** — one reason to change per module. A file that
     parses env _and_ logs _and_ routes gets edited for three unrelated causes,
     and every edit risks the other two.
   - **Open/closed** — extend by adding, not by editing stable code. A new MCP
     tool is a new file registered in `registerTools`; a new page is a new
     entry in `routes.ts`. Preserve that pattern when adding surface.
   - **Liskov substitution** — anything standing in for a type must honor its
     whole contract. This is what makes test doubles valid: the stubbed
     `McpServer` and `createFakeEnv` are trustworthy only because code under
     test cannot tell the difference on the paths it exercises. A fake that
     cuts a corner the real one doesn't is a test that lies.
   - **Interface segregation** — depend on the narrowest shape you actually
     use. Take `{ db, logger }`, not the whole context; a function handed
     everything cannot be tested without building everything.
   - **Dependency inversion** — dependencies arrive as typed parameters
     (`createAuth({ db, secret, ... })`, `ToolContext`), never reached for by
     importing a concrete instance. This is the letter that buys testability:
     what is injected can be faked, what is imported is welded in.
3. **DRY** — deduplicate knowledge, not lines. Two call sites that happen to
   look alike are not duplication until they must change together.
4. **KISS** — after the above, prefer the boring solution. No abstraction on
   spec: introduce indirection when the second concrete need arrives, not
   before.

Refactor as you go, in small steps behind green tests: first make the change
easy, then make the easy change. Leave every touched file better than you
found it — a refactor small enough to ride inside the change it enables needs
no separate permission; one too big for that deserves its own conversation.

Testing follows the same pragmatism:

- **Coverage is a gap-finder, not a goal.** There is deliberately no repo-wide
  threshold — a blanket number buys assertion-free tests written to move a
  number. Each package sets its own target in its CLAUDE.md, matched to what
  the code _is_: pure logic aims at 100% (`config`, `db`, `auth/helpers`,
  `ui/lib` — small and deterministic, no excuse), request-path layers at
  90–95% (`observability`, `web/server`, `mcp/tools`), and wiring or thin CLI
  wrappers carry no unit target — they are exercised by e2e or the manual
  flows their CLAUDE.md names. New packages pick a target the same way: by the
  nature of the code, never a house number.
- **Mutation tests check the tests.** Coverage proves a line ran;
  `pnpm test:mutation` (Stryker) proves a test would notice the line breaking.
  A surviving mutant in logic code is a missing assertion — act on it, even
  though the thresholds are advisory. Logic globs go in `mutate` in
  `stryker.config.json`; UI components follow the `terminal-timeline` pattern
  first (extract the logic into a pure `.ts` module, mutate that).
- **Test behavior at the boundary, not the implementation inside it.** A test
  that breaks on a refactor with no behavior change works against the
  refactoring rule above. And every guard ships its deny-path test — the allow
  path passing proves little.

Quality is not negotiable — tests, documentation, and the verify gate are part
of "done" (see "Verifying before claiming"). But quality means the simplest
thing that provably works, not the most engineered thing that might.

---

## Top ten standing concerns

Distilled from `docs/` on 2026-08-06, statuses verified against the code that
day. The cited doc stays canonical — when a concern is resolved, update both it
and this list, or the stale copy will be trusted.

1. **Email verification is the gate — do not weaken it.** Signup grants no
   session until the address is proven, and `requireLocalEmailVerified` stops a
   social identity linking into an unproven local account. That pair is what
   closes pre-hijacking (`security-audit.md` #2, resolved 2026-08-06). Two
   traps: `accountLinking.trustedProviders` must stay **empty** — it means "link
   even when the provider says the address is unverified", so adding a provider
   weakens it — and sending goes through `@starter/email`, which silently falls
   back to logging when `RESEND_API_KEY`/`EMAIL_FROM` are unset. Verify both are
   set in production. A **configured but failing** sender is quiet too: Better
   Auth swallows the rejection on `/sign-up/email`, so signup answers 200 and
   the UI says "check your email" regardless — the resend path is the one that
   reports failure. Every call minting a verification link must pass
   `POST_VERIFICATION_REDIRECT` as `callbackURL`; the default is `/`, which in
   split-origin mode strands a just-verified user on the marketing host. Still
   missing: a forgot-password UI (reset works only via the API).
   (`docs/adr/003-transactional-email.md`)
2. **The env is validated at request time — do not route around it.**
   `authMiddleware` and the MCP Worker's `authFor` both call `parseEnv` before
   constructing anything, and a rejected env throws rather than degrading
   (`security-audit.md` #3, resolved 2026-08-08). This is what keeps concern 1
   true: verification tokens are JWTs signed with `BETTER_AUTH_SECRET`, so an
   unset secret would let anyone mint one and self-verify any address. The
   schema explicitly rejects Better Auth's `DEFAULT_SECRET` — 38 characters, so
   `.min(32)` alone accepted it. **Operational trap:** failing closed means
   deploying to a Worker whose secret was never set takes it down. Run
   `wrangler secret list` before the first deploy carrying it.
3. **No rate limiting on auth endpoints — and the defaults cannot work here.**
   better-auth's limiter keys on `NODE_ENV` (off), its memory store dies every
   request because `createAuth()` is per-request, and no `rateLimit` table
   exists. Since verification shipped this also leaves `/send-verification-email`
   and `/request-password-reset` as unauthenticated ways to send mail, so the
   exposure includes the Resend quota and other people's inboxes, not just
   brute-forced sign-in. The IP half is done — `ipAddressHeaders` is pinned to
   `cf-connecting-ip`, and that list stays one entry long, since a fallback
   restores the spoofable path. (`security-audit.md` #4; #11 resolved)
4. **Security headers ship — the CSP has four traps.** `security-headers.ts` is
   mounted above the origin redirect and carries CSP, HSTS, `X-Frame-Options`,
   `nosniff`, `Referrer-Policy`, and `no-store` for cookie-bearing requests
   (`security-audit.md` #5, #14, resolved 2026-08-08). When touching it:
   hash source expressions must be **quoted** (`'sha256-…'`) or browsers discard
   them silently; the nonce goes to `ServerRouter`, not just `<Scripts>`, or the
   mid-stream loader-data chunks are blocked; the theme script is admitted by
   hash and its test fails if the two drift; and `<Links nonce="">` is
   deliberate — inheriting the nonce puts it on `<link>` tags, which browsers
   blank, producing a hydration mismatch. A broken CSP paints a dead page
   without erroring, so verify by driving the UI, never by status code.
5. **New surface is default-deny — keep it that way.** `apiApp` requires a
   principal for every method+path not in `PUBLIC_OPERATIONS`, and CSRF applies to session
   callers only (`security-audit.md` #10, #15, resolved 2026-08-08). Adding a
   public route means adding it to that allowlist on purpose. Dashboard child
   loaders each call `requireUser` — in React Router v7 the layout loader is not
   a security boundary (children run in parallel and can be fetched directly),
   so a new page guards itself. Ask the standing-pass review questions of every
   diff that adds a route, loader, table, or tool. (`security-plan.md`)
6. **OAuth tokens sit in plaintext and tenant rows do not cascade.** Any D1
   export exposes usable Google/GitHub access tokens; expired `verification`
   rows are never purged; `member`/`invitation` foreign keys have no
   `onDelete`, so deleting a user or org fails or strands rows — and retained
   invitee emails are a GDPR-deletion problem. (`security-audit.md` #12, #13)
7. **A leaked secret is rotated first, cleaned second.** Once committed, the
   credential is compromised even if never pushed — revoke it at the provider,
   then rewrite history. Rewriting without rotation is theater.
   (`secret-scanning.md`)
8. **D1 bills rows scanned, not rows returned — and writes are the expensive
   metric.** An unindexed filter reads the whole table; deletes count as
   writes; the hot missing index is `member(userId)`, scanned on every
   dashboard navigation. Free-plan limits fail closed (errors, not bills);
   Paid has no hard cap — budget alerts inform, they do not stop usage.
   Paginate every list. (`costs-and-limits.md`)
9. **Every clone mints its own identity before deploying.** Create a new D1
   database and set its id in **both** wrangler files — the MCP Worker runs
   its own Better Auth against the web app's users, so a different id is a
   different user set. Before deploying MCP: create a real `OAUTH_KV`
   namespace (the committed `"local"` id is a placeholder with nowhere to
   store grants), and prefer the stateless handler unless session state is
   truly needed — the Durable Object shape bills duration. Leave MCP
   undeployed until a product needs it. (`costs-and-limits.md`,
   `starter-as-upstream.md`)
10. **Downstream, `@starter/*` is read-only and applied migrations are
    immutable.** Product code lives in the product's own scope; starter fixes
    are made upstream and arrive via `git merge upstream/main` — never rebase
    a product's main. Never edit a migration that has reached production; add
    a new one. (`starter-as-upstream.md`, `starter-v1-scope.md`)

---

## Security standards

The concerns above are the open risks. This is the settled part: patterns
already in the code that new work must follow. Deviating is allowed, but it is a
decision to argue for in the PR, not a detail to get wrong quietly.

Three rules generate most of the rest:

1. **Fail closed.** When configuration is missing or a caller is unidentified,
   refuse. Never degrade to a working-but-weaker path — a silent downgrade is
   how every finding in `security-audit.md` shipped.
2. **Guard where the data is read**, not one layer up. A parent that happens to
   check today is not a boundary.
3. **Every guard ships its deny-path test.** The allow path passing proves
   almost nothing.

### Configuration

Auth-relevant bindings are read through `parseEnv` (`packages/config/src/env.ts`)
and never off `c.env` directly — `authMiddleware` and the MCP Worker's `authFor`
both do this, and a rejected env throws rather than degrading. Add every new
binding to the schema, not just to an app's ad-hoc `Bindings` type.

The schema rejects Better Auth's `DEFAULT_SECRET` explicitly. Length checks are
not enough on their own: that constant is 38 characters and passed `.min(32)`
for months.

**Optional bindings go through `optionalBinding`, not `.optional()`.** `.dev.vars`
delivers an unset key as `""`, not as absent, and every optional key in
`.dev.vars.example` ships that way — so a plain `.optional()` rejects the
documented setup path on every request.

**Anything that runs the Worker needs an env to run it with.** `check:boot`
supplies throwaway values as `--var` and the CI e2e job writes a throwaway
`.dev.vars`; without them a correctly failing Worker serves nothing and the check
asserts "is CI configured" instead of "does the bundle boot". Remember that
`pnpm verify` passes locally in this situation, because a developer machine has a
`.dev.vars` — CI is the only place this shows up.

### The API surface (`apps/web/server/api.ts`)

- **Default deny.** Every operation not in `PUBLIC_OPERATIONS` requires a
  principal. The allowlist is keyed by **method and path** (`"GET /health"`), so
  adding `POST` to an existing public path does not inherit its exemption.
  Making something public is an edit to that list — explicit and reviewable. Do
  not "temporarily" widen it.
- **Guards live on `apiApp`, not at the mount** in `index.ts`, so they travel
  with the routes rather than depending on the mount staying correct.
- **CSRF applies to session callers only, and runs after the deny check.**
  Bearer tokens are not ambient credentials — nothing attaches them
  automatically — so there is no cross-site vector to defend, and exempting them
  keeps the CLI working, since it sends neither `Origin` nor `Sec-Fetch-Site`.
  Running CSRF before the deny check would answer an anonymous caller 403
  instead of 401.
- **Do not reach for `hono/csrf` here.** It was tried and removed: it only
  inspects form-shaped or absent content types, making it a **no-op on
  `application/json`** — the content type of the app's only cookie-authenticated
  write. The replacement checks every unsafe method regardless of body, via
  `Sec-Fetch-Site` with an `Origin` fallback, and refuses when neither is
  present. Do not narrow it back to a content-type predicate.
- Anonymous requests to unknown `/api/v1` paths answer **401, not 404**. The
  guard runs before routing resolves, so it cannot know the route is absent. It
  does not hide the surface — `GET /doc` is public and lists every route — but it
  does remove the 404/401 difference as an oracle for probing paths the spec does
  not advertise. Do not "fix" this.
- Reject with `HTTPException`, never a bare `throw new Response(...)`. Hono's
  `compose()` only routes `Error` instances to the error handler, so a thrown
  `Response` escapes as a 500.

### Loaders

Every protected loader calls `requireUser(context, request)`
(`apps/web/app/lib/require-user.ts`) — **including children of the dashboard
layout**. In React Router v7 the layout loader is not a security boundary:
children run in parallel with it, and a `.data` request can fetch one directly,
so the parent's redirect never applies.

Guard even a loader that returns nothing today. Both files in
`app/routes/_examples/` do, because they are the templates the next page is
copied from — which is exactly how the original defect propagated.

**Test a new guard at the vector.** A unit test on `requireUser` passes whether
or not the loader calls it, and a plain `.data` request is satisfied by the
layout's guard — so request the child alone with
`?_routes=routes%2F<route-id>` and assert on the `SingleFetchRedirect` payload,
not the status (which is 202). `tests/e2e/loader-guards.spec.ts`.

Throw, never soft-return. `return { user: null }` answers 200 to an
unauthenticated caller and reads as deliberate.

### Response middleware

- **Never assume a response is mutable.** `Response.redirect()` and responses
  passed through from `fetch()` carry an immutable headers guard; writing to one
  throws `TypeError: immutable`. Unguarded, that is a 500 _and_ a response with
  none of the headers applied. `securityMiddleware` handles this centrally.
- **Mount `app.use(...securityMiddleware)` as one unit.** Hono unwinds
  post-`next()` code in reverse registration order, so the list is deliberately
  ordered inside `security-headers.ts`. Reordering at the call site silently
  drops headers, and every isolated unit test still passes — which is why there
  is a test exercising the three together.
- Authenticated responses get `Cache-Control: no-store`, keyed on the session
  cookie rather than a path list so new routes are covered on arrival. An
  existing directive is **overridden** unless it already contains `no-store` or
  `private`; a `public, max-age` on personalized output is the leak, not a
  preference to respect.

### CSP — four traps, all of them silent

A broken CSP paints a dead page without erroring, so **verify by driving the UI,
never by status code.** There is an e2e test that opens a Radix menu for exactly
this reason.

1. Hash source expressions must be **quoted** (`'sha256-…'`). Unquoted, browsers
   discard them as an invalid source and report only that.
2. The nonce goes to **`ServerRouter`**, not just `<Scripts>`. React Router emits
   loader data as mid-stream script chunks that `root.tsx` cannot reach.
3. The theme script is admitted by **hash**, and `theme-script.test.ts` fails if
   the script and its hash drift. Do not hand-edit the hash.
4. `<Links nonce="">` is deliberate. Inheriting the nonce stamps it on `<link>`
   tags, and browsers blank the attribute after parsing, producing a hydration
   mismatch React will not patch up.

`script-src` carries no `unsafe-inline` and no `unsafe-eval`. `style-src` keeps
`unsafe-inline` because Tailwind injects a runtime `<style>` and Radix writes
inline style attributes; neither executes script.

### Identity and IP

`ipAddressHeaders` is `["cf-connecting-ip"]` and stays exactly one entry long.
Cloudflare _appends_ to any client-supplied `X-Forwarded-For`, so the default
first-entry read is attacker-controlled, and a fallback entry would restore that
path whenever the trusted header is absent — a state an attacker can arrange.

MCP tools read identity from `ctx.user` (the OAuth grant), never from tool
arguments.

### Ask of every diff that adds surface

- New route or API path — is it in the allowlist on purpose, or denied by default?
- New loader — does it call `requireUser` itself?
- New middleware that touches a response — does it survive an immutable one?
- New binding — is it in `webEnvSchema`/`mcpEnvSchema`?
- New guard — is there a test for the **deny** path?
- New inline script — nonce or hash, and which, and is it tested?
- Invalidated a claim in a doc — did you grep for its other homes? The audit,
  `security-plan.md`, this file and the per-package `CLAUDE.md` files all repeat
  each other, and a stale copy is trusted.

---

## Stack

- **Runtime:** Cloudflare Workers (D1, KV, etc.)
- **Web:** React Router v7 + Hono + Tailwind v4
- **Auth:** Better Auth (email/password + org/tenancy)
- **DB:** Drizzle ORM on D1 (SQLite)
- **UI:** shadcn/ui components (unified `radix-ui` package, not individual `@radix-ui/*`)
- **Theme:** Single oklch preset from shadcn (light/dark/system), no multi-color switcher
- **MCP:** MCP server in `apps/mcp`, gated by OAuth 2.1 (`@cloudflare/workers-oauth-provider`)

## Monorepo layout

```
apps/web          — React Router app (Cloudflare Workers)
apps/mcp          — MCP server (Cloudflare Workers)
packages/auth     — Better Auth config, middleware, session/role helpers
packages/config   — Zod-validated env schemas, version, product identity
packages/db       — Drizzle schema, migrations, D1 client
packages/email    — EmailSender port + Resend transport (verification, reset)
packages/observability — structured logging, correlation IDs, Sentry
packages/testing  — shared test helpers (dependency-free by rule)
packages/ui       — shadcn/ui components, hooks, theme
packages/cli      — Dev workflow scripts (db:*, api:spec, check:boot, version:bump)
docs/             — ADRs, API specs
tests/e2e         — Playwright e2e tests
```

Each app and package carries its own `CLAUDE.md` with directory-specific rules
and a coverage target. Read it before working in that directory.

---

## Key architecture decisions

### Web app server layer

`apps/web/server/index.ts` is a Hono app that:

- Runs `observabilityMiddleware` first, then `authMiddleware` (db + auth per request)
- Mounts Better Auth at `/api/auth/**`
- Mounts `principalMiddleware` on `/api/v1/*`, then the versioned API at `/api/v1`
- Passes `db`, `auth`, `logger` and `requestId` to React Router loaders via `load-context.ts`

### Observability

`packages/observability` (see its CLAUDE.md and `docs/adr/002-observability.md`):

- `observabilityMiddleware` runs **first** in the Hono chain — request-scoped
  logger + correlation id on `c.get("logger")` / `c.get("requestId")`, also
  reachable in loaders via `context.logger` / `context.requestId`
- `app.onError(observabilityErrorHandler)` reports failures and answers with
  `{ error, requestId }` — never the internal message
- `withSentry()` wraps the Worker entry in `worker.ts` / `apps/mcp/src/index.ts`;
  no `SENTRY_DSN` means it is a pass-through
- Every log field goes through `redact()` — never `console.log` directly in
  request paths, and never log a raw URL (query strings carry tokens; redaction
  matches key names only). Log the pathname.
- **Workers Logs needs `observability.enabled` in each `wrangler.jsonc`** — without
  it, logs show in `wrangler tail` but are never retained or queryable
- Every log entry goes to three sinks: Workers Logs, Sentry Logs (`enableLogs`,
  the queryable stream), and the breadcrumb trail of any error event from that
  request. Sentry's default console integration is deliberately removed —
  re-adding it double-records every line as `"[object Object]"`
- Cloudflare (retention 3d free / 7d paid) and Sentry (grouping, alerting,
  releases) are complementary; leaving `SENTRY_DSN` unset gives a working
  Cloudflare-only setup

### MCP authentication

`apps/mcp` is gated by OAuth 2.1 — user-facing setup is `docs/mcp.md`; see also its
CLAUDE.md and `docs/security-audit.md` #8:

- `/mcp` is an `apiRoute` on `OAuthProvider`; without a bearer token it returns
  401 with the `WWW-Authenticate` challenge clients follow to discovery
- It runs its **own** Better Auth instance (separate Worker, so it cannot read the
  web app's cookie) against the **same** D1 — so `database_id` must match `apps/web`
- Locally, `pnpm dev` for the MCP app uses `--persist-to ../web/.wrangler/state` so
  both Workers share one local database
- Tools read identity from `ctx.user` (the OAuth grant), **never** from tool arguments
- PKCE and scope validity are enforced in `auth-app.ts`, not by the library
- A session id is bound to its principal in KV; a mismatch is `403`

### API authentication

`/api/v1` accepts a session cookie **or** a bearer token, resolved to one
`principal` by `principalMiddleware`:

- Only the SHA-256 hash of a token is stored; plaintext is returned once
- Token management is session-only — a token that can mint tokens outlives
  revocation of the one that leaked
- A present-but-invalid bearer token is rejected, never downgraded to cookie auth

### Routes

Defined in `apps/web/app/routes.ts` (explicit route config, not file-based routing):

- `/` — landing page
- `/login` — email/password + GitHub/Google social login
- `/register` — with confirm password validation
- `/dashboard` — layout with sidebar, topbar, auth guard
- `/dashboard/settings` — profile, plus API token management

When adding a dashboard page: add the route in `routes.ts`, create the file in
`app/routes/`, then run `npx react-router typegen`.

### UI components

All in `packages/ui/src/components/ui/`, imported as
`@starter/ui/components/ui/button`. Components use the unified `radix-ui`
package (`import { Dialog } from "radix-ui"`), NOT individual `@radix-ui/*`.

Theme is CSS-variable-based (oklch) in `apps/web/app/app.css`. `ThemeProvider`
in `packages/ui/src/hooks/use-theme.tsx` manages light/dark/system via cookies.

### Dashboard layout

- **Sidebar** (desktop): collapsible, org switcher, nav links with active state, user dropdown
- **Topbar**: breadcrumbs, mobile hamburger, theme toggle, notification bell, user menu
- Sidebar/topbar code is inline in `dashboard.tsx`, not separate component files

### Auth in loaders

```ts
const session = await requireUser(context, request); // redirects when signed out
const orgs = await context.auth.api.listOrganizations({ headers: request.headers });
```

**Every protected loader calls `requireUser` itself, children included** — not
only the ones that currently read sensitive data. In React Router v7 the layout
loader is not a security boundary: children run in parallel with it and a
`.data` request can fetch one directly, so the parent's redirect never applies.
A loader that returns nothing today is the template the next page is copied
from, which is exactly how audit #10 propagated.

Never soft-return. `return { user: null }` answers 200 to an unauthenticated
caller and reads as deliberate.

The dashboard layout loader returns `{ user, activeOrganizationId, organizations }`
for its own rendering; child routes may read that through the parent, but they
still guard themselves.

### Social login (GitHub + Google)

Providers auto-enable when their credentials are set (conditional in
`packages/auth/src/server.ts`). Each **origin** needs its own registered
callback — the web app's registration does not cover the MCP Worker:

- GitHub: `{ORIGIN}/api/auth/callback/github`
- Google: `{ORIGIN}/api/auth/callback/google`

---

## Dev commands

```bash
pnpm dev                    # Start web app dev server
pnpm db:generate            # Generate Drizzle migration
pnpm db:migrate             # Apply migrations (local)
pnpm db:seed                # Seed dev data
pnpm db:reset               # Drop and re-apply all migrations
pnpm api:spec               # Generate OpenAPI spec
pnpm api:call GET /me       # Call /api/v1 with STARTER_API_TOKEN (bearer)
pnpm version:bump [type]    # Bump version (patch/minor/major)
pnpm test                   # Run Vitest
pnpm test:e2e               # Run Playwright
pnpm test:coverage          # Vitest with coverage report (coverage/)
pnpm test:mutation          # Stryker mutation tests (reports/mutation/)
pnpm lint / pnpm lint:fix   # ESLint (flat config in eslint.config.mjs)
pnpm format / pnpm format:check  # Prettier
pnpm verify                 # Full gate: lint, format, test, gitleaks, build, typecheck, boot, e2e
pnpm deploy:web             # verify + wrangler deploy (the gated deploy path)
pnpm init:product <name>    # Stamp product identity on a fresh clone (docs/starter-as-upstream.md)
pnpm check:docs-sync        # Fail on drift: undocumented root scripts, stale .dev.vars.example
pnpm check:boot             # Boot each built Worker and prove it serves (after build)
```

## Quality gates

- Pre-commit hook (`.githooks/pre-commit`, wired by the root `prepare` script) runs
  lint-staged (eslint --fix + prettier on staged files) then a gitleaks secret scan.
- CI runs gitleaks over full history on PRs and pushes to main
  (`.github/workflows/gitleaks.yml`). It needs `pull-requests: read`, or the
  action 403s and crashes **before scanning**, which looks like a finding.
- Deploys go through `pnpm deploy:web`, which refuses to ship unless `pnpm verify` passes.
- **`pnpm check:boot` runs inside `verify` and in CI** (after `build`/`typecheck`).
  It starts each built Worker and asserts it serves one unauthenticated request.
  `build` proves compilation; only this proves the bundle _runs_. Without it a
  Worker that throws at module init passes the entire gate — not hypothetical: it
  caught exactly that on its first run, when vite left `zod` external, wrangler
  resolved it to zod 3, and bundled better-auth called zod 4 APIs
  (`coerce.boolean(...).meta is not a function`).
- **Keep zod on one major.** better-auth ≥1.6 requires zod 4 and peers on
  `drizzle-orm@^0.45.2`; `@hono/zod-openapi` must be v1.x to match. These four move
  together — pinning any one back reintroduces the boot failure above.
- **Sentry only initialises in the built Worker.** `withSentry()` is in `worker.ts`;
  `pnpm dev` mounts `server/index.ts` directly, so `captureError` no-ops on :5173.
- Secret-handling procedures are in `docs/secret-scanning.md`.

## TypeScript notes

- Web app tsconfig uses `@cloudflare/workers-types/experimental` + DOM lib
- `worker.ts` imports `./build/server` (generated by `pnpm build`, no type
  declarations) — the import carries a `@ts-expect-error`, so `pnpm typecheck`
  passes regardless of build state
- Route types are generated into `.react-router/types/` via `rootDirs`
- UI package is typechecked through the web app, since it needs DOM types

## Conventions

- **Adding a page:** route in `routes.ts` → create route file → `npx react-router typegen`
- **Adding a UI component:** place in `packages/ui/src/components/ui/` → import from `@starter/ui/components/ui/name`
- **Adding an API route:** add to `apps/web/server/api.ts` with OpenAPI schema → `pnpm api:spec` → add matching MCP tool in `apps/mcp`. It is authenticated by default; a public one must be named in `PUBLIC_OPERATIONS`, by method and path
- **Auth guard:** `requireUser(context, request)` in **every** protected loader, children included — the layout loader is not a boundary (audit #10)
- **Toasts:** `import { toast } from "sonner"` — Toaster is mounted at root
- **E2E locators:** `getByRole`/`getByLabel` first; `data-testid` only for
  role-less elements; never CSS class selectors — `tests/e2e/CLAUDE.md`
- **New package:** follow `docs/creating-packages.md` (includes a required per-package context file)

---

## Deployment

Target production URL: `https://app.edgeseed.dev` (marketing site: `edgeseed.dev`).
Only `app.edgeseed.dev` runs auth — `BETTER_AUTH_URL` pins one origin and OAuth
callbacks are registered per-origin, so the session cookie stays host-scoped
there and the marketing site can never see it.

**Legacy deploy (pre-rename):** `https://starter-web.farshid-pourlatifi-3fa.workers.dev`.
The Workers were renamed `starter-*` → `edgeseed-*`, so the next `pnpm deploy:web`
creates a **new** Worker and leaves that one running. Delete it after cutover,
then delete this paragraph.

D1: `edgeseed-db` / `639d0b4e-b410-4e14-b4a3-8f5e6c95c8fe` (same id in **both**
wrangler files — the MCP Worker runs its own Better Auth against these users).
The pre-rename `starter-db` (`510ae3cb-…`) is no longer referenced; delete it
once you have confirmed nothing needs migrating out of it.

```bash
# 1. Gated deploy — runs the full verify suite, then deploys
pnpm deploy:web

# 2. Remote migrations (only when schema changes) — or `pnpm db:migrate --remote`
cd apps/web && npx wrangler d1 migrations apply edgeseed-db --remote
```

**Always pass `--local` or `--remote` explicitly to any `wrangler d1` command.**
Wrangler defaults to **local** when neither is given, so an omitted flag does
not mean "remote" — it means the command quietly acts on your own database and
reports success. `db:migrate` shipped exactly that bug: `--remote` mapped to an
empty flag, so the documented production migration path was a no-op against
production. `resolveDbTarget` now makes the flag impossible to omit.

### Creating a D1 — keep the binding named `DB`

`wrangler d1 create <name>` offers to add the binding for you and suggests a
binding name derived from the database name. **Do not accept it.** It appends a
_second_ entry to `d1_databases` rather than replacing the existing one, so the
app keeps resolving `c.env.DB` to the old database while the config looks
migrated. Everything reads `c.env.DB` — `packages/auth` middleware,
`packages/config` env schema, `apps/mcp/src/env.ts`.

Either answer `DB` at the prompt, or decline and edit `database_id` by hand in
**both** wrangler files. It also rewrites the file with tab indentation, so run
`pnpm format` afterwards or `format:check` fails.

Changing `database_id` gives you a **fresh local database** too — wrangler keys
its sqlite state by id, not name. Re-run `pnpm db:reset && pnpm db:seed`.

### Custom domains and the origin split

Full reference: `docs/domains.md`. The shape is **configurable, not baked in** —
that is deliberate starter surface.

- **Default is one origin**: landing page and app share a hostname. Nothing to
  configure, and it is what `pnpm dev` does on localhost.
- **Split origin** is opt-in via `MARKETING_URL`. Set it and `server/origins.ts`
  moves `/login`, `/register`, `/dashboard` and `/api` to `BETTER_AUTH_URL`'s
  origin, while `/` on the app origin bounces back to marketing.
- The middleware sits **before** `authMiddleware`, so auth cannot execute on the
  marketing origin. That guarantee is structural — do not reorder it.
- If both variables name the same host the resolver falls back to single-origin
  rather than looping. Tested; check it first if a split silently does nothing.

Hostnames are declared as `custom_domain` routes in `apps/web/wrangler.jsonc`,
so `wrangler deploy` creates the DNS records itself — never pre-create an
A/CNAME for them, and the zone must be on this same Cloudflare account.
`init:product` **strips** `routes` from a clone alongside localising
`database_id`, since they name hostnames the clone does not own.

This repo runs split: `edgeseed.dev` marketing, `app.edgeseed.dev` app.

Never deploy with a raw `wrangler deploy` — that skips the verify gate **and**
ships `ENVIRONMENT: "development"` from `wrangler.jsonc`, which tags every
production Sentry event `development` and leaves `LOG_LEVEL` at `debug`.
`deploy:web` overrides it with `--var ENVIRONMENT:production`; the var stays
`development` in the file because that block is shared with local dev.

### Secrets

All sensitive vars go through `wrangler secret put <NAME>`, never
`wrangler.jsonc`. A `var` **shadows** a same-named secret at deploy time, so a
committed value silently wins over `wrangler secret put`.

Required: `BETTER_AUTH_SECRET` (32+ chars) for both Workers; `BETTER_AUTH_URL`
for the web Worker only — the MCP Worker derives its origin from each request
and neither declares nor reads the variable.

**Required whenever `routes` declares more than one hostname:**
`MARKETING_URL`. The split is driven by the variable, not by the route list, so
declaring both hostnames without setting it deploys a Worker that answers
`/login`, `/register`, `/dashboard` and `/api/auth` on **both** — `origins.ts`
returns `null` for every request and the "auth never constructs on the
marketing origin" guarantee silently does not hold.

```bash
wrangler secret put MARKETING_URL   # https://edgeseed.dev
```

Do **not** put it in `vars`: that block is shared with local dev, so the value
would reach `pnpm dev` and bounce `localhost:5173/` to the production marketing
host. Same reason `ENVIRONMENT` is corrected with `--var` at deploy time rather
than committed. Nothing enforces this yet — the structural fix is to refuse to
serve a host that is neither origin, tracked in issue #6.

Optional (social login): `GITHUB_CLIENT_ID`/`SECRET`, `GOOGLE_CLIENT_ID`/`SECRET`.

**Effectively required in production (email):** `RESEND_API_KEY` and
`EMAIL_FROM`, together. Absent, `@starter/email` falls back to logging the
message instead of sending it — which means nobody can verify an address or
reset a password, and the only signal is one `warn` per attempt. `EMAIL_FROM`
must be on a domain verified in Resend. See `docs/adr/003-transactional-email.md`.

Optional (error reporting) — absent means Sentry is fully disabled. Step-by-step:
`docs/sentry-setup.md`. **One Sentry project per Worker**; environments live
inside a project, so do not create a project per environment.

- `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE` (`0`..`1`, default `0`)
- `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE` — override `ENVIRONMENT` / `APP_VERSION`
- `LOG_LEVEL` — `debug`|`info`|`warn`|`error`; `debug` in development, `info` elsewhere

### Local dev

Dev vars live in each app's `.dev.vars` (gitignored); wrangler merges them during
`pnpm dev`. `apps/mcp` needs its own copy — it is a separate Worker. Each app
ships a committed `.dev.vars.example` — copy it to `.dev.vars` and fill it in;
it is also the key-name reference for auditing a real file. Agents never read
the real files — see "Secret files are never read".

---

## Route examples

`apps/web/app/routes/_examples/` holds reference implementations that are **not**
registered as routes — copy-paste starting points.

| File                         | What it shows                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `dashboard-with-widgets.tsx` | Stats cards, activity table with empty state, quick action cards                                  |
| `settings-full.tsx`          | Tabbed settings (General/Team/Billing), profile with avatar upload, danger zone, team member list |

To use one: copy to `app/routes/`, register in `routes.ts`, run
`npx react-router typegen`, wire real data. See `_examples/README.md`.

## Generating new UI (design workflow)

UI is generated with V0/shadcn, not written from scratch. The workflow — V0
project URL, theme preset, prompt template, integration steps — lives in
`docs/design-workflow.md`. That file is **product-owned**: repos extending this
starter replace it with their own design sources (`docs/starter-as-upstream.md`).
This pointer stays stable.
