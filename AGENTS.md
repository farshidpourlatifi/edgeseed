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

### A new branch must never inherit `main` as its upstream

`git checkout -b <name> origin/main` **sets the new branch's upstream to
`origin/main`**, because git tracks whatever ref you branched from. A later bare
`git push` then writes straight to `main` — no warning, no prompt, and every
branch protection the repo relies on is simply not consulted, because nothing
ever addressed the feature branch. The commit lands on `main` and cannot be
walked back without rewriting pushed history, which the rule above forbids.

This has happened here (`feat/org-referential-integrity`, 2026-08-12): the
branch was created that way, the work was reported as "one push from a PR", and
the human's `git push` put it on `main` instead. Git announces the tracking in
its own output — `branch '<name>' set up to track 'origin/main'` — and it was
not read.

So, when creating a branch:

```bash
git checkout -b <name> --no-track origin/main   # or: git switch -c <name> --no-track origin/main
```

- **Verify before reporting anything as pushable.** `git rev-parse --abbrev-ref
--symbolic-full-name @{u}` must print `origin/<name>`, or fail with "no
  upstream" — never `origin/main`. A branch with no upstream is the safe state:
  a bare `git push` refuses and tells the human what to run.
- **Never hand over a bare `git push`.** Give the explicit form, which is
  correct regardless of how the branch was wired: `git push -u origin <name>`.
- **`git checkout -b <name> main` is not the fix.** Branching from the _local_
  `main` copies main's upstream too. `--no-track` is what breaks the
  inheritance; `-u` on first push is what sets the right one.

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
- `pnpm verify:fast` is the same gate **minus e2e** — everything that runs in
  seconds to a couple of minutes, for the inner loop. It is deliberately the
  whole rest of the gate, not "lint and unit": `gitleaks` and `check:boot` have
  each caught a real defect the cheaper checks passed. A green `verify:fast` is
  never reported as a green `verify`; the full command is what "done" means.
- **Stop dev servers before `pnpm test:e2e`.** e2e global-setup runs `db:reset`;
  a server holding the dropped D1 file makes every auth call fail with
  `SQLITE_CANTOPEN`, and an orphaned dev server bound IPv6-only produces
  `ERR_CONNECTION_REFUSED`. Both look like code regressions and are not.
- When you invalidate a claim in one file, **grep for its other homes**. Include
  `.github/skills/code-review/SKILL.md` when the claim is a review rule. Docs that
  contradict the code are worse than missing docs, because they are trusted.
- **Docs drift is checked in two halves, and only one is automatic.**
  `pnpm check:docs-sync` runs on every PR and fails on the mechanical kind:
  an undocumented root script, a stale `.dev.vars.example`, a relative link
  whose target is gone, an MCP tool or API path that ships without a mention in
  the README. It cannot judge whether a sentence is still _true_ — that is the
  quarterly sweep in `docs/housekeeping.md`, which a scheduled workflow opens an
  issue for. Adding a claim that only a human can verify means adding it there.
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
- **`ignorePatterns` in `stryker.config.json` is load-bearing — never empty
  it.** Stryker does **not** read `.gitignore`. It crawls the whole working
  directory, ignoring only a hard-coded list (`node_modules`, `.git`, `.next`,
  `.nuxt`, `.svelte-kit`, `*.tsbuildinfo`) plus whatever `ignorePatterns` adds.
  Then `disableTypeChecks` (default `true`) babel-parses **every** file
  matching `**/*.{js,ts,jsx,tsx,html,vue,mjs,mts,cts,cjs}` in one unbounded
  `Promise.all` and keeps the rewritten source in memory. `wrangler dev` leaves
  a 5.5 MB bundle plus a 12 MB sourcemap per run in `apps/*/.wrangler/tmp`, so
  a few days of dev work is ~355 MB of bundled JS handed to babel at once —
  the parent process OOMs at any `--max-old-space-size`, before the dry run,
  with `coverageAnalysis` making no difference. Patterns are **bare directory
  names** (`.wrangler`, not `**/.wrangler/**`), matching Stryker's own
  hard-coded list: the crawler tests each pattern against the directory entry
  name, so a bare name prunes the subtree at any depth, while a `**/…/**` glob
  only ever matches files _below_ it. Add a build-output directory here the
  moment a new tool starts writing one — `.react-router` is on the list for
  exactly that reason. It was deliberately kept off while its types were
  tracked; issue #30 untracked them, and gitignoring alone changes nothing
  here, because Stryker crawls the disk rather than the index. Excluding it is
  safe because the sandbox runs vitest, not `tsc`: the root `vitest.config.ts`
  collects only `*.test.ts`, and the generated types are consumed exclusively
  by `import type` in `.tsx` route modules, which esbuild erases.
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

That date is the warranty on this list, so it is re-verified on a schedule
rather than on remembering: section 1 of the sweep in
[`docs/housekeeping.md`](./docs/housekeeping.md) walks all ten against the
current code and updates the date to the day it actually happened.

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
   split-origin mode strands a just-verified user on the marketing host. The
   forgot-password UI ships as of 2026-08-13 (`/forgot-password`,
   `/reset-password`, linked from `/login`), and a reset **revokes every
   existing session** — but deliberately does **not** mark the address
   verified, so an unverified user who resets still lands on the verification
   notice. Do not "fix" that without deciding it: it widens what satisfies the
   gate this concern rests on.
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
3. **Rate limiting ships — it is a binding, not a store, and it is required.**
   `packages/auth/src/rate-limit.ts` wires three Workers `[[ratelimits]]`
   bindings into `createAuth` as `rateLimit.customStorage`, keyed per IP+path
   per 60s: mail 3, credentials 10, default 120 (`security-audit.md` #4,
   resolved 2026-08-08). Five traps: `enabled: true` is pinned to a **literal**
   — better-auth's default keys on `NODE_ENV`, which Workers never set, and that
   is the entire original defect; the bindings are **required** in
   `sharedEnvSchema`, so a Worker missing one refuses every request instead of
   quietly running unthrottled; do **not** reach for KV or `secondaryStorage`
   (KV is one write/sec/key, and `secondaryStorage` moves sessions out of D1);
   the limiter lives in better-auth's HTTP router hook, so anything calling
   `auth.api.*` directly **bypasses it** and must limit itself, as MCP's
   `/authorize` login does; and `ipAddressHeaders` stays one entry long
   (`cf-connecting-ip`) since a fallback restores the spoofable path it keys on
   (#11). It bounds one address — a Cloudflare WAF rule is still the answer for
   volumetric abuse. E2E specs need their own `cf-connecting-ip` (`clientIp` in
   `tests/e2e/helpers.ts`) or they throttle each other.
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
6. **OAuth tokens sit in plaintext and expired rows are never purged.** Any D1
   export exposes usable Google/GitHub access tokens, and `verification` holds
   raw email-verification and password-reset values that nothing cleans up, so
   the exposure only grows. (`security-audit.md` #12 — still open.) The
   **referential-integrity half of this concern is closed**: as of
   2026-08-12 every tenant foreign key cascades and
   `session.activeOrganizationId` nulls out, so deleting a user or org can no
   longer fail or strand rows (#13). One GDPR residue survives that fix and no
   constraint can reach it — `invitation.email` has no foreign key to `user`,
   so an invitation addressed to a deleted user's address needs an
   application-level sweep in whatever finally adds an account-deletion
   surface.
7. **A leaked secret is rotated first, cleaned second.** Once committed, the
   credential is compromised even if never pushed — revoke it at the provider,
   then rewrite history. Rewriting without rotation is theater.
   (`secret-scanning.md`)
8. **D1 bills rows scanned, not rows returned — and writes are the expensive
   metric.** An unindexed filter reads the whole table; deletes count as
   writes. The auth-path indexes ship as of 2026-08-12, `member(userId)`
   among them — the rule was **every foreign-key child column** (so no cascade
   scans) **plus the named non-key lookups**, and `schema.test.ts` asserts that
   set exactly, so a new index needs a stated consumer and a missing one fails.
   Keep new tables to it. Free-plan limits fail closed (errors, not bills);
   Paid has no hard cap — budget alerts inform, they do not stop usage.
   Paginate every list. (`costs-and-limits.md`)
9. **Every clone mints its own identity before deploying.** Create a new D1
   database and set its id in **both** wrangler files — the MCP Worker runs
   its own Better Auth against the web app's users, so a different id is a
   different user set. Before deploying MCP: create a real `OAUTH_KV`
   namespace (the committed `"local"` id is a placeholder with nowhere to
   store grants — the schema checks that binding's **name**, so `check:boot`
   catches a rename but never a placeholder id), and prefer the stateless
   handler unless session state is
   truly needed — the Durable Object shape bills duration. Leave MCP
   undeployed until a product needs it. The rate-limit `namespace_id`s are the
   one identity a clone can safely keep: they need no provisioning, and both
   Workers share them on purpose. Change them only when a **second product**
   lands in the same Cloudflare account, since the ids are account-scoped.
   (`costs-and-limits.md`, `starter-as-upstream.md`)
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
supplies throwaway values as `--var` — plus `--env-file` at an empty fixture, so
a developer's `.dev.vars` is not loaded underneath them and the env is the same
everywhere — and the CI e2e job writes a throwaway `.dev.vars`, which is that
suite's configuration channel rather than an inheritance to suppress; without them a correctly failing Worker serves nothing and the check
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
- **`apiApp` ends in a terminal `all("*")`, and it must stay last.** An
  _authenticated_ unknown path clears the deny guard and matches no route, so
  without it the request falls out of the mount — and
  `hono-react-router-adapter` installs React Router **after** this app, so it
  lands on the browser splat and an API client is served an HTML page. Nothing
  about the status or content type says so (both were already `404 text/html`),
  which is how it survived review; only the body distinguishes them, so the
  tests assert the body. Anything registered below it is unreachable — that is
  the one place in this repo where route order really is load-bearing, unlike
  `app/routes.ts`, where React Router ranks by specificity instead.
- **Routes may live in a sub-app, mounted above that terminal handler.**
  `server/api-organization.ts` is one, and it registers its **full** paths and is
  mounted at `/` rather than under a prefix — so the string beside each route is
  the string `/doc` advertises and `check:docs-sync` matches against the README.
  The guards travel with `apiApp`, so a sub-app's routes are default-deny on
  arrival like any other. What is not automatic: `api-guard.test.ts` sweeps the
  paths **the spec advertises**, so a registry merge that silently did nothing
  would shrink that sweep to zero without failing — which is why the same file
  asserts the organization paths are in the document at all.
- Reject with `HTTPException`, never a bare `throw new Response(...)`. Hono's
  `compose()` only routes `Error` instances to the error handler, so a thrown
  `Response` escapes as a 500. Use `rejectRequest` from `@starter/auth` rather
  than building one: it is the envelope every guard and route on this app answers
  in, `{ error, code? }`, and a route with its own is how a client ends up
  parsing two error formats from one API.

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
  existing directive is **overridden unless it already contains `no-store`** —
  `private` is not enough, because it keeps a response out of shared caches
  while still letting the browser store it, which leaves the
  back-button-on-a-shared-machine exposure #14 names. Do not relax this to
  "preserve anything private".

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

### Rate limiting

Three `[[ratelimits]]` bindings, one per enforcement class, adapted to Better
Auth's storage contract in `packages/auth/src/rate-limit.ts`. The policy table
there is canonical; the numbers in both `wrangler.jsonc` files must match it,
since the binding is what enforces and the table is what the app reports.

- **A path's class is a decision, not a default.** `CLASSIFIERS` names what
  leaves the loose `default` bucket. Anything an **unauthenticated** caller can
  use to make the app send mail belongs in `mail` — that is why
  `/sign-up/email` sits there rather than with the credential endpoints.
  `/organization/invite-member` is there too, despite being authenticated and
  permission-checked: a compromised admin session spends the sending reputation
  just as fast, and that cost is what the class bounds. **One prefix covers
  invite and resend**, since `resend: true` is a body flag on the same endpoint
  rather than a second path.
- **Never make `enabled` conditional.** It is a literal `true`. Better Auth's
  own default is `isProduction`, which reads `NODE_ENV` — unset on Workers — and
  that alone is why the limiter did nothing for the life of the repo.
- **A new Worker adds the bindings or it does not boot.** They are required in
  `sharedEnvSchema`, and the check is for the `limit` method rather than mere
  presence, because the realistic failure is a _misnamed_ binding: wrangler
  deploys that without complaint.
- **`auth.api.*` bypasses the limiter.** Better Auth applies it in the HTTP
  router's `onRequest` hook, so any endpoint that authenticates by calling
  `auth.api.signInEmail` and friends must call a limiter itself —
  `rateLimitKey(headers, path)` builds a matching key. MCP's `/authorize` login
  form is the one such endpoint today; a second one is a new hole.
- **Do not migrate this to KV.** It was evaluated and rejected: one write per
  second per key, cached negative lookups, and `secondaryStorage` relocates
  session storage out of D1 as a side effect.

### Identity and IP

`ipAddressHeaders` is `["cf-connecting-ip"]` and stays exactly one entry long.
Cloudflare _appends_ to any client-supplied `X-Forwarded-For`, so the default
first-entry read is attacker-controlled, and a fallback entry would restore that
path whenever the trusted header is absent — a state an attacker can arrange.
The rate limiter keys on that value, so widening the list does not merely dirty
audit data — it hands an attacker a fresh bucket per request.

MCP tools read identity from `ctx.user` (the OAuth grant), never from tool
arguments. An organization id **is** allowed as a tool argument — MCP is
stateless here, with no "set active organization" — but it is a **target**, not a
credential: `list_members` and `list_invitations` each resolve it through
`getOrganizationForMember` before reading, and a foreign organization and a
nonexistent one get the identical refusal, so an id is not a cross-tenant oracle.
`list_organizations` is what hands a client the ids it may target.

### Organization roles

One matrix, `ORG_CAPABILITIES` in `packages/auth/src/helpers/roles.ts`, read
through `can(role, capability)` — never `hasRole` at a call site, which
re-decides the policy there. Admin+ invites, resends and revokes; **owner only**
changes a role or removes somebody; anybody may leave. Nobody is _invited_ as an
owner — that is a promotion, so it happens to somebody already inside.

**The page is not the boundary, and neither is any loader.** These writes go
from the browser to `/api/auth/organization/*` through `authClient`, so the
session cookie reaches Better Auth with no product code in between. What
enforces the matrix is `ORGANIZATION_ROLES` in `packages/auth/src/organization.ts`,
which narrows Better Auth's **own** role table: stock `adminAc` grants
`member: ["update", "delete"]`, so with the defaults left alone every admin
changes roles and removes members whatever the UI offers. Two e2e cases in
`member-actions.spec.ts` were seen red against those defaults, and they are the
only thing standing between this rule and a silent regression on a version bump.

- **Add a capability to `ORG_CAPABILITIES` first**, then render from it. The API
  imports it (`server/api-organization.ts` derives both its `can()` gates and the
  `capabilities` it reports from the object itself, so a new entry needs no edit
  there); the MCP list tools derive their reported capabilities and their
  `readInvitations` gate from it the same way (#39).
- **The API is the one surface where product code does sit between the caller and
  Better Auth**, so it enforces twice on purpose: `can()` decides which refusal is
  heard first and keeps a doomed write from costing a round trip, and the
  delegated `auth.api.*` call is what actually enforces. A 403 coming back from
  Better Auth there means the two disagree — a bug in this repo — and is
  deliberately left to surface as a 500 rather than reported to the caller as
  their own fault.
- **A capability that maps to a Better Auth permission needs the role table to
  agree**, and `organization.test.ts` asserts every role × capability pair
  against `authorize()` so it cannot quietly not.
- **A capability-gated _read_ carries the capability into its query**, not just
  into the route above it. `callerIsMember` takes an optional `capability` and
  the invitation reads pass one, derived through `rolesGranting()` — the same
  "guard where the data is read" rule that put membership in the clause, applied
  to the role, since a demotion between the `can()` call and the read would
  otherwise still return the addresses.
- **The last-owner rule is state, not rank.** Better Auth enforces it on leave,
  demote and remove; the page reads `countOwners` so it can say so in advance
  rather than offering a control that fails.
- Product rules Better Auth has no vocabulary for go in `organizationHooks` —
  where the write is — not in a component. The invite-as-owner ban is the one
  such rule today (`beforeCreateInvitation`).

### Ask of every diff that adds surface

- New route or API path — is it in the allowlist on purpose, or denied by default?
- New loader — does it call `requireUser` itself?
- New middleware that touches a response — does it survive an immutable one?
- New binding — is it in `webEnvSchema`/`mcpEnvSchema`?
- New guard — is there a test for the **deny** path?
- New organization capability — is it in `ORG_CAPABILITIES`, does
  `ORGANIZATION_ROLES` agree with it, and is the deny case asserted at the
  **endpoint** rather than at a missing button?
- New auth endpoint — is it in the right rate-limit class, and if it reaches
  Better Auth through `auth.api.*` rather than HTTP, does it limit itself?
- New inline script — nonce or hash, and which, and is it tested?
- New time logic — does `now` arrive as an input, with a test at a non-now
  instant? New rendered date — does it go through `format-date.ts`? New
  day/month/civil-time logic — whose zone, and is it named?
- New user-visible mention of the product — its name, slug, version or
  repository URL — does it read from `@starter/config` rather than a literal?
  A literal ships the starter's identity to every clone, and the repo URL is
  the one value nothing derives, so it may be empty and the surface has to
  render without it (issue #32).
- Invalidated a claim in a doc — did you grep for its other homes? The audit,
  `security-plan.md`, this file, `.github/skills/code-review/SKILL.md` and the
  per-package `CLAUDE.md` files all repeat each other, and a stale copy is trusted.

---

## Time

Full rationale: [`docs/adr/004-time-and-timezones.md`](./docs/adr/004-time-and-timezones.md).
These are the rules it produces.

**Time is an input.** Anything that compares, expires, or writes a moment takes
`now` from its caller and defaults it: `now: Date = new Date()`
(`packages/auth/src/helpers/api-token.ts`) for a function that reads the clock
once, `input.now ?? new Date()` (`org-store.ts`, `api-token-store.ts`) for the
same thing behind an options object, and `now?: () => string`
(`packages/observability/src/logger.ts`) for an object that reads it repeatedly
over its life — a logger built once would otherwise freeze at its construction
time. One exception is allowed and it is named rather than left to judgement:
`touchLastUsed` in `principal.ts` reads the clock bare because nothing compares
against `lastUsedAt`. "Nothing reads it back" is the whole test.

**Storage is instants, and the application writes every one.**
`integer({ mode: "timestamp" })` columns — no zone, no offset, nothing to
interpret. **Never a SQL clock default**: no `CURRENT_TIMESTAMP`, no
`DEFAULT (unixepoch())`. Defaults are drizzle's `$defaultFn`
(`packages/db/src/helpers/timestamps.ts`), which runs in application code on the
way to the database. That distinction looks cosmetic and is the entire reason
rows are time-travelable — a value the application produced is one a test can
produce differently, while a database-generated value can only ever be the
moment the row was written.

**Every rendered date goes through `apps/web/app/lib/format-date.ts`**, the
single formatting seam, with locale (`en-US`) and zone (UTC) pinned. A call site
must not reach for `Intl` or `toLocaleDateString` however small the need looks:
the same hydration defect shipped twice that way, and it is invisible in CI
unless the browser is pinned to disagree with the Worker.

**IANA names, never offsets.** `Europe/Amsterdam`, not `+02:00` — an offset is a
fact about one instant rather than about a place, and it changes twice a year.

**Civil time names its zone.** "Day", "month", "start of week", "9am" mean
nothing without one. "Older than 30 days" is an instant comparison and needs no
zone; "at midnight" has picked one whether or not it says so.

**Tests move the data's timestamps, never the world's clock.** The clock cannot
be virtualised here — Workers freeze `Date.now()` for the duration of a request
and expose no way to set it, and Better Auth's expiry checks and the rate-limit
binding read the real clock through code this repo does not own. Seed the row
instead: `expireInvitation` / `shortenInvitation` in `tests/e2e/helpers.ts` at
the e2e level, a `now` argument at the unit level. The suites run under a
deliberately hostile timezone and locale so an unpinned formatter fails in CI
rather than on a reader's machine.

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

- Runs `observabilityMiddleware` first, so it sees every request
- Then `app.use(...securityMiddleware)` — response headers, the CSP nonce, and
  `no-store` for cookie-bearing requests. Mounted as one ordered unit; see
  "Security standards"
- Then the origin resolver (no-op unless `MARKETING_URL` is set), which
  redirects across the split and **404s a hostname that is neither origin**. It
  sits **below** the headers so redirects and refusals carry them, and **above**
  `authMiddleware` so auth never constructs on the marketing origin or on an
  origin nobody declared
- Then `authMiddleware` — validates the env through `parseEnv` and refuses the
  request if it fails, then builds db + auth per request
- Mounts Better Auth at `/api/auth/**`
- Mounts `principalMiddleware` on `/api/v1/*`, then the versioned API at
  `/api/v1`, which is **default-deny** with a same-origin CSRF check for session
  callers
- Passes `db`, `auth`, `logger`, `requestId` and `cspNonce` to React Router
  loaders via `load-context.ts`

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
- **Membership writes are session-only too**, for the same shape of reason: a
  token that can promote its own owner turns one leaked credential into
  permanent control of the organization, which revoking that token does not
  undo. Reads under `/api/v1/organization/*` are open to tokens; the four writes
  answer 403. Both refusals come from `requireInteractivePrincipal`, which takes
  the sentence as an argument rather than being re-implemented per surface
- A present-but-invalid bearer token is rejected, never downgraded to cookie auth
- **An organization-scoped route takes no organization id.** The tenant is the
  principal's, and it is re-checked against the `member` table on every request —
  a session outlives a removal, and a token's `organizationId` is stamped once at
  creation. A member or invitation outside it answers **404**, never 403, so ids
  are not a cross-tenant oracle
- **A write reaching Better Auth through `auth.api.*` charges the rate limiter
  itself**, keyed under the Better Auth path it delegates to, so the browser and
  the API share one budget per address. The class comes from `rateLimitClassFor`,
  never a second table

### Routes

Defined in `apps/web/app/routes.ts` (explicit route config, not file-based routing):

- `/` — landing page
- `/login` — email/password + GitHub/Google social login
- `/register` — with confirm password validation
- `/forgot-password` — requests a reset link; enumeration-safe notice
- `/reset-password` — spends the link; dead-link state when the token is absent,
  expired, or already used
- `/accept-invitation` — spends an organization invitation. The **one loader
  that deliberately does not call `requireUser`**: the link arrives in a
  mailbox, so the signed-out state is the point, and it discloses nothing an
  anonymous caller did not already supply. Signed out it offers `/login` and
  `/register` carrying `?invitation=<id>`, which both read to return the reader
  here instead of `/dashboard`
- `/dashboard` — layout with sidebar, topbar, auth guard
- `/dashboard/members` — the active organization's members and its pending
  invitations, both bounded, plus every membership write: invite, resend,
  revoke, change role, remove, leave. The invitations half is admin-and-owner
  only, since it carries invited addresses. **The writes go from the browser
  straight to Better Auth's endpoints through `authClient`**, so they pass
  through the rate limiter that a server-side `auth.api.*` call would step
  around — which means the page renders from `ORG_CAPABILITIES` but does not
  enforce it. Enforcement is `ORGANIZATION_ROLES` in `packages/auth`; see
  "Organization roles" under Security standards
- `/dashboard/settings` — profile, plus API token management
- `*` — branded 404, written last for readability. **Not for correctness:**
  React Router ranks branches by specificity and docks a splat by `splatPenalty`
  (-2) in `computeScore`, so a static route declared below it still wins its own
  path, and reordering fixes nothing. Its loader returns
  `data(null, { status: 404 })`, which is what makes the document answer 404
  rather than a 200 that merely says "not found" — a page that renders correctly
  while answering 200 is wrong for every crawler, monitor and link checker, and
  nothing in a browser shows it. It sees browser paths; `/api/auth/**` and
  `/api/v1/*` are answered by Hono first, and the origin refusal in
  `server/origins.ts` stays deliberately plain `Not Found` because it is a
  security boundary, not an app page. That it sees only browser paths is
  enforced, not assumed: the adapter installs React Router **after** the Hono
  app, so `apiApp` ends in a terminal `all("*")` returning JSON — without it an
  authenticated miss on an unknown `/api/v1` path reached this page and served
  an API client HTML. Anonymous misses are still 401 from the deny guard

When adding a dashboard page: add the route in `routes.ts`, then create the file
in `app/routes/`. Route types regenerate on their own — see "TypeScript notes".

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

**An org-scoped loader resolves its tenant with `resolveMembership`, never from
the URL.** `session.activeOrganizationId` is the input, and the helper answers
"is this caller a member of that organization, and as what" — `null` for no,
which is a state to render, not a 500. Two facts make the round trip necessary
rather than ceremonial: Better Auth sets the session field in
create-organization, accept-invitation and set-active only, so
`sessionDatabaseHooks` sets it at sign-in and a session predating that carries
`null`; and `removeMember` clears the **remover's** session, never the removed
member's, so the field can name an organization the caller has just been thrown
out of. Reads still scope themselves — `listPendingInvitations` carries its own
membership check — because the lookup is not the guard.

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
pnpm version:bump [type]    # Bump version + regenerate openapi.json, then print the tag steps
pnpm test                   # Run Vitest
pnpm test:e2e               # Run Playwright
pnpm test:coverage          # Vitest with coverage report (coverage/)
pnpm test:mutation          # Stryker mutation tests (reports/mutation/)
pnpm lint / pnpm lint:fix   # ESLint (flat config in eslint.config.mjs)
pnpm format / pnpm format:check  # Prettier
pnpm verify:fast            # The gate minus e2e — inner loop only, never a substitute for verify
pnpm verify                 # Full gate: verify:fast, then e2e
pnpm deploy:web             # verify + wrangler deploy (the gated deploy path)
pnpm deploy:web:ungated     # the deploy half alone — CI only, see below
pnpm init:product <name> [--repo <url>]   # Stamp product identity on a fresh clone (docs/starter-as-upstream.md)
pnpm check:docs-sync        # Fail on drift: undocumented root scripts, stale .dev.vars.example
pnpm check:boot             # Boot each built Worker and prove it serves (after build)
pnpm check:release-version <tag>   # Refuse a tag disagreeing with package.json / APP_VERSION
pnpm check:not-downgrade <tag>     # Refuse a tag older than what production serves
pnpm check:deployed <output> <version>   # Assert the live /health reports that version
pnpm release:notes <log>    # Version ID preamble for the GitHub Release body
```

## Quality gates

- Pre-commit hook (`.githooks/pre-commit`, wired by the root `prepare` script) runs
  lint-staged (eslint --fix + prettier on staged files) then a gitleaks secret scan.
- CI runs gitleaks over full history on PRs and pushes to main
  (`.github/workflows/gitleaks.yml`). It needs `pull-requests: read`, or the
  action 403s and crashes **before scanning**, which looks like a finding.
- Deploys go through `pnpm deploy:web`, which refuses to ship unless `pnpm verify` passes.
  It is `verify && deploy:web:ungated`, and the release workflow runs those two
  halves as separate steps so CI cannot drift from the local deploy path — in
  particular the `--var ENVIRONMENT:production` override.
- **`deploy:web:ungated` is not a shortcut — never run it by hand.** It exists
  so the workflow can hold Cloudflare credentials for one step instead of the
  whole job: `verify` runs install scripts, eslint plugins, browsers and the
  test suite, and none of that third-party code should be able to read a token
  that deploys to production. Running it directly skips the gate entirely,
  which is the thing `deploy:web` exists to prevent.
- **`pnpm check:boot` runs inside `verify` and in CI** (after `build`/`typecheck`).
  It starts each built Worker and asserts it serves an unauthenticated request —
  and, where a target declares `envProbe`, a **second** request that reaches
  `parseEnv`. That second one is what catches a binding renamed in
  `wrangler.jsonc`, which wrangler deploys without complaint and which would
  otherwise take every auth route down with the gate green. `@starter/web` needs
  no probe: its readiness path already sits behind `authMiddleware`.
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
- Route types are generated into `.react-router/types/` via `rootDirs`. The
  directory is **gitignored** — `apps/web`'s `typecheck` is
  `react-router typegen && tsc --noEmit`, so `pnpm typecheck` produces them, and
  `react-router dev` rewrites them as routes change. Never commit them: they
  were tracked until issue #30, and every upstream release that added a route
  then conflicted with every downstream product that added one, because
  `routes.ts` merges line-by-line while the generated union is a single list.
  `react-router build` does **not** write them, so `typecheck` is the only
  producer in CI — do not reduce that script back to a bare `tsc --noEmit`
- UI package is typechecked through the web app, since it needs DOM types

## Conventions

- **Adding a page:** route in `routes.ts` → create route file. Route types are generated, not committed — `pnpm typecheck` and `react-router dev` both write them
- **Adding a UI component:** place in `packages/ui/src/components/ui/` → import from `@starter/ui/components/ui/name`
- **Adding an API route:** add to `apps/web/server/api.ts` with OpenAPI schema → `pnpm api:spec` → add matching MCP tool in `apps/mcp`. It is authenticated by default; a public one must be named in `PUBLIC_OPERATIONS`, by method and path
- **Auth guard:** `requireUser(context, request)` in **every** protected loader, children included — the layout loader is not a boundary (audit #10)
- **Toasts:** `import { toast } from "sonner"` — Toaster is mounted at root
- **E2E locators:** `getByRole`/`getByLabel` first; `data-testid` only for
  role-less elements; never CSS class selectors — `tests/e2e/CLAUDE.md`
- **New package:** follow `docs/creating-packages.md` (includes a required per-package context file)
- **New organization-scoped feature:** follow [`docs/tenancy.md`](./docs/tenancy.md) — scoped tables, loaders, API routes, MCP tools, and the capability matrix

---

## Deployment

Target production URL: `https://app.edgeseed.dev` (marketing site: `edgeseed.dev`).
Only `app.edgeseed.dev` runs auth — `BETTER_AUTH_URL` pins one origin and OAuth
callbacks are registered per-origin, so the session cookie stays host-scoped
there and the marketing site can never see it.

D1: `edgeseed-db` / `639d0b4e-b410-4e14-b4a3-8f5e6c95c8fe` (same id in **both**
wrangler files — the MCP Worker runs its own Better Auth against these users).

**Production deploys are tag-triggered.** Pushing a `v*` tag runs
`.github/workflows/release.yml`, which deploys and then cuts a GitHub Release —
so the release is a record of a deploy that happened rather than a claim made
next to one. Full flow in "Cutting a release" below.

```bash
# Remote migrations — BEFORE the deploy that needs them. See "Schema changes"
# below; the release workflow deliberately does not run these.
# Addresses the DB binding, so this line is correct in a renamed clone too.
pnpm db:migrate --remote

# Gated deploy — runs the full verify suite, then deploys.
# Local escape hatch. It leaves no release behind and runs no smoke check, so
# the tag flow is the production path; reach for this only when CI is the
# thing that is broken.
pnpm deploy:web
```

### Schema changes: migrate first, in two releases

**Apply the migration before the code that needs it, never after.** The old code
must tolerate the new schema, because both run at once — Cloudflare rolls a
deploy out gradually, and a failed release leaves the old version serving.
Deploy-then-migrate means every request between the two steps hits code querying
a column that does not exist yet.

So a schema change is **expand, then contract**, across two releases:

1. **Expand** — apply a migration that only adds (nullable column, new table,
   new index). Push the tag; the new code reads and writes it.
2. **Contract** — in a _later_ release, once nothing running still references
   the old shape, apply the destructive part (drop the column, add the NOT NULL).

Never edit a migration that has reached production; add a new one (concern #10).
This is why the workflow does not migrate: a destructive migration applied
automatically on every tag is not something to discover during an incident, and
the safe ordering cannot be expressed as "one step in the deploy".

**A foreign-key change is a whole-table rebuild, and the generated SQL is not
D1-safe until `db:generate` rewrites it.** SQLite cannot `ALTER` a constraint,
so drizzle-kit emits `CREATE __new_x` → `INSERT … SELECT` → `DROP x` →
`RENAME`, wrapped in `PRAGMA foreign_keys=OFF` / `…=ON`. **D1 rejects that
pragma** — it enforces foreign keys and exposes only `PRAGMA
defer_foreign_keys`. Local `db:migrate` runs against miniflare's SQLite, which
accepts it, so the whole verify gate goes green and the **remote** migration is
what fails. `db-generate.ts` therefore strips the pragma from files it creates
and says so in its output (`packages/cli/src/lib/d1-sql.ts` explains why
removing it is safe rather than merely expedient). Two consequences:

- Migrations under `packages/db/migrations/` are generated **and then
  rewritten** — do not "restore" a stripped pragma, and do not hand-write one.
- The rebuild's `INSERT … SELECT` re-validates every existing row against the
  new constraints. Rows that already violate them fail the migration loudly,
  which is correct — orphans are the defect. Check before applying to a real
  database rather than discovering it mid-release:

```bash
pnpm --filter @starter/web exec wrangler d1 execute DB --remote --command "SELECT COUNT(*) FROM member m LEFT JOIN organization o ON o.id = m.organizationId WHERE o.id IS NULL;"
```

### Cutting a release

```bash
# If this release carries a schema change, apply the (additive) migration first
# — see "Schema changes" above.
pnpm db:migrate --remote

pnpm version:bump patch                      # package.json + APP_VERSION + openapi.json
git commit -am "chore(release): v0.1.1"
git push origin HEAD
git tag -a v0.1.1 -m "v0.1.1"
git push origin v0.1.1                       # this is what deploys
```

The workflow then, in order: checks the tag against `APP_VERSION`, checks it is
on `main`, checks it is not already released, runs the full `verify` gate,
deploys, requests `/api/v1/health` on every deployed origin until one reports
the tagged version, and only then creates the release.

Six things this shape depends on:

- **The tag must name the commit carrying the bump.** `version:bump` deliberately
  does not tag — it runs before the bump is committed, so any tag it made would
  point one commit too early and ship the previous `APP_VERSION` under the new
  version's name. `check:release-version` refuses that, before deploying.
- **The tag must be annotated** (`-a`). `git push --follow-tags` skips
  lightweight tags, so a lightweight one looks pushed and silently never
  triggers the workflow.
- **The tag must be on `main`.** A tag pushed from a feature branch would
  otherwise deploy that branch to production; the workflow checks ancestry and
  refuses.
- **A tag is released once.** Re-running a _completed_ release would upload a
  second Cloudflare version while the existing release still names the first,
  so the workflow refuses. Re-running a _failed_ run is fine — no release
  exists yet. To ship again, cut a new version.
- **A green deploy is not a working deploy.** `wrangler deploy` uploads happily
  against a Worker whose secrets were never set; that Worker then 500s on every
  request (concern #2). `check:deployed` asserts the live `/api/v1/health`
  reports the tagged version — not merely a 200, since the _previous_ deploy
  answers 200 too. If it fails, the Worker is live and broken and there is no
  release: fix forward, or roll back to the previous Version ID in the
  Cloudflare dashboard.
- **The release names the Cloudflare Version ID**, not just the commit — that is
  the identifier Cloudflare's rollback UI takes, so it is the field you need
  when a release turns out to be the bad one. It comes from wrangler's
  structured output (`WRANGLER_OUTPUT_FILE_PATH`), not from scraping the
  console, which is not a contract.

**Required secrets, on a `production` GitHub environment** (Settings →
Environments → `production`), **not on the repository**. A repository secret is
readable by every workflow in the repo; an environment secret is readable only
by a job declaring `environment: production`, which is the `deploy` job alone.
Restrict that environment's deployment branches and tags to `v*` as well.
Without these the workflow fails at the deploy step, after `verify` has passed —
the tag is already pushed by then, so fix the secret and re-run the job rather
than cutting a new version:

| Secret                  | What                                                          |
| ----------------------- | ------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Account token, minimum scope — `docs/cloudflare-api-token.md` |
| `CLOUDFLARE_ACCOUNT_ID` | The account the Workers live in                               |

Neither is in scope during `verify`. That step runs install scripts, eslint
plugins, browsers and the test suite; the credentials appear one step later, on
the deploy alone. `GITHUB_TOKEN` is likewise scoped to the two steps that use
it, and only the separate `release` job holds `contents: write`.

These are the only credentials the workflow holds — Worker secrets
(`BETTER_AUTH_SECRET`, provider keys, `RESEND_API_KEY`) live in Cloudflare and
ship through a separate channel, so `wrangler deploy` never sees or needs them.

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

**Never address an existing D1 by `database_name` when shelling out to
wrangler — use the `DB` binding.** `wrangler d1` accepts either, and the name is
the one a clone renames: `init:product` stamps it to `<slug>-db`, so a script
naming this repo's database resolves to nothing downstream. `wrangler d1 create`
is the one exception — it names a database that does not exist yet, so there is
no binding to address. It shipped that way and the
#17 clean-clone exercise caught it — worse, `d1 migrations apply` reports the
miss as "No migrations present at apps/web/migrations", sending the reader to
look for their migrations instead of their database. The constant and the
reasoning live in `packages/cli/src/lib/d1-binding.ts`; `init-product.test.ts`
fails if a `db:*` script reverts to a name literal.

### Custom domains and the origin split

Full reference: `docs/domains.md`. The shape is **configurable, not baked in** —
that is deliberate starter surface.

- **Default is one origin**: landing page and app share a hostname. Nothing to
  configure, and it is what `pnpm dev` does on localhost.
- **Split origin** is opt-in via `MARKETING_URL`. Set it and `server/origins.ts`
  moves `/login`, `/register`, `/forgot-password`, `/reset-password`,
  `/accept-invitation`, `/dashboard` and `/api` to `BETTER_AUTH_URL`'s origin, while `/` on the app
  origin bounces back to marketing. `APP_PATH_PREFIXES` is the canonical list —
  this one is a copy, so add a new product route to the code first.
- **Setting it also closes the set of hostnames.** One that is neither
  `BETTER_AUTH_URL` nor `MARKETING_URL` gets a 404 and an `origin.refused` warn.
  What it is defending against: `routes` and these two variables are
  **independent lists that nothing reconciles** — a third `custom_domain`, a
  zone route added in the dashboard, an explicitly enabled
  `workers_dev`/`preview_urls` (both off by inference here, since wrangler
  resolves `workers_dev` to `routes.length === 0`), a legacy record, or a
  configured host on an alternate Cloudflare HTTPS port. Unset, nothing is
  refused, because a Worker cannot read its own `routes` list and so cannot tell
  single-origin from unconfigured-split. The match is hostname **and port**, not
  scheme — plaintext is Cloudflare's Always Use HTTPS to solve, before the
  Worker runs.
- **It closes what the Worker serves, not what the hostname serves.** Static
  assets are matched ahead of the Worker (`run_worker_first` defaults to
  `false`), so `/assets/*` and the favicons still answer 200 on a refused host.
  Public bytes, no auth surface — say that rather than claiming the hostname
  goes dark.
- The middleware sits **before** `authMiddleware`, so auth cannot execute on the
  marketing origin. That guarantee is structural — do not reorder it.
- If both variables name the same host the resolver falls back to single-origin
  rather than looping, and that fallback is **whole**: it refuses nothing
  either, because a marketing apex still in `routes` matches neither origin in
  that state and 404ing the landing page over one copy-pasted secret is worse
  than the hole. Tested; check it first if a split silently does nothing.

Hostnames are declared as `custom_domain` routes in `apps/web/wrangler.jsonc`,
so `wrangler deploy` creates the DNS records itself — never pre-create an
A/CNAME for them, and the zone must be on this same Cloudflare account.
`init:product` **strips** `routes` from a clone alongside localising
`database_id` and `database_name`, since they name hostnames the clone does not
own. It strips that
block and nothing else, so **never write out a key whose correct value depends
on `routes` existing** — the key survives into a clone that no longer has the
routes justifying it. `workers_dev` is the live example: absent, wrangler
resolves it to `routes.length === 0` and it is correct in both repos; written
out as `false` to document that, it would leave a stripped clone with no custom
domain _and_ no workers.dev, i.e. a Worker with no public hostname at all.
Document the inference in a comment above `routes`, which gets stripped with it.

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

**Renaming a Worker gives it an empty secret store.** Secrets are keyed by
Worker name, so the `starter-*` → `edgeseed-*` rename stranded
`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` and `SENTRY_DSN` on the old Worker. Nothing warned:
`createAuth` builds `socialProviders` conditionally, so production answered
`PROVIDER_NOT_FOUND` on every social sign-in, and `withSentry()` degraded to a
pass-through with no error reporting at all. Redeploying does not help — code
and secrets ship through separate channels, and `wrangler deploy` never touches
the store.

So for any future rename: carry the secrets over **before** deleting the old
Worker. `wrangler secret list --name <old>` gives the names, but values cannot be
read back, so each has to be re-obtained from its provider — and GitHub shows a
client secret exactly once, so that one must be regenerated. That ordering is the
whole point; once the old Worker is gone, even the list of what to restore is
gone with it.

The `starter-*` → `edgeseed-*` cutover itself is **complete** (2026-08-09).
`edgeseed-web` carries all seven of the old Worker's secrets plus `EMAIL_FROM`,
`MARKETING_URL` and `RESEND_API_KEY`; the old Worker and the pre-rename
`starter-db` have both been deleted.

Required: `BETTER_AUTH_SECRET` (32+ chars) for both Workers; `BETTER_AUTH_URL`
for the web Worker only — the MCP Worker derives its origin from each request
and neither declares nor reads the variable.

**Required whenever `routes` declares more than one hostname:**
`MARKETING_URL`. The split is driven by the variable, not by the route list, so
declaring both hostnames without setting it deploys a Worker that answers
the whole auth surface — `/login`, `/register`, `/forgot-password`,
`/reset-password`, `/accept-invitation`, `/dashboard`, `/api/auth` — on
**both** — `origins.ts`
serves every request where it arrived and the "auth never constructs on the
marketing origin" guarantee silently does not hold. This is the one half the
code cannot catch, since a Worker cannot read its own `routes` list; setting the
variable is what declares the topology, and everything `origins.ts` enforces
follows from it.

```bash
wrangler secret put MARKETING_URL   # https://edgeseed.dev
```

Do **not** put it in `vars`: that block is shared with local dev, so the value
would reach `pnpm dev` and bounce `localhost:5173/` to the production marketing
host. Same reason `ENVIRONMENT` is corrected with `--var` at deploy time rather
than committed.

Setting it has one consequence to know in advance: the Worker stops answering on
every hostname neither variable names. Before setting it, list every hostname
that reaches the Worker — `routes`, dashboard zone routes, `workers_dev` and
`preview_urls` if either is on — and move any uptime monitor or smoke target off
the leftovers. `check:deployed` requests `/api/v1/health` on every target
`wrangler deploy` reports, so a leftover one fails the release on `HTTP 404`
_after_ the deploy has landed (`docs/domains.md`).

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

To use one: copy to `app/routes/`, register in `routes.ts`, wire real data. See
`_examples/README.md`.

## Generating new UI (design workflow)

UI is generated with V0/shadcn, not written from scratch. The workflow — V0
project URL, theme preset, prompt template, integration steps — lives in
`docs/design-workflow.md`. That file is **product-owned**: repos extending this
starter replace it with their own design sources (`docs/starter-as-upstream.md`).
This pointer stays stable.
