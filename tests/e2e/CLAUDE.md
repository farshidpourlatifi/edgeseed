# tests/e2e

## Locator convention

Priority order, same as Playwright's own guidance:

1. **`getByRole` / `getByLabel`** — the default. These select through the
   accessibility tree, so every locator doubles as an a11y assertion: a button
   that loses its accessible name fails the test, as it should.
2. **`getByText`** — for prose that has no role. Sparingly.
3. **`getByTestId`** — escape hatch, only for elements no role locator can
   reach (the terminal's animated body is `aria-hidden`; its accessible
   transcript is a separate element). The `data-testid` is added at the
   component — read `packages/ui/CLAUDE.md` before adding one.
4. **Never CSS class or structure selectors** (`.tw`, `div > span`) — they
   couple tests to styling and break on refactors with no behavior change.

Page-anchor ids (`#quality`, `#terminal-demo`) are stable navigation targets
and acceptable as region scopes; the element inside is still selected by role
or testid.

## Running

- `pnpm test:e2e` from the root. **Stop dev servers first** — global-setup
  runs `db:reset`, and a server holding the D1 file or port 5173 produces
  `SQLITE_CANTOPEN` / `ERR_CONNECTION_REFUSED` that look like code regressions
  (details in the root AGENTS.md).
- Playwright boots its own web server (`webServer` in `playwright.config.ts`),
  pinned to `127.0.0.1` — do not change `port` to `url` there; the comment in
  the config explains why.
- Tests use a per-run throwaway user (`helpers.ts`); never point this suite at
  a deployed environment.

## `rate-limit.spec.ts` is the only check that the policy and the bindings agree

The limits live in three places: `RATE_LIMIT_RULES` (`packages/auth/src/rate-limit.ts`),
`simple.limit` in both `wrangler.jsonc` files, and this spec. The binding is what
enforces; the table is what the app believes. **Import the numbers from the table —
never restate them here.** Derived, a mismatch fails in both directions: raise the
table without the binding and the run is refused early, raise the binding without
the table and the expected 429 never arrives. Restated, both stay green at the old
values, which is the drift actually worth catching.

Verified by desyncing the table to `max: 5` against a binding of 10 and watching the
sign-in case go red (`expected 429, received 401`).

**Open each counting test with `awaitRateLimitWindow()`.** Locally the limiter is
miniflare's, and it is a **fixed** window keyed on `Math.floor(Date.now() / 60000)`
that calls `buckets.clear()` — every key, not just the one under test — the instant
that value changes. A sequence straddling a wall-clock minute boundary therefore
counts from zero again and the expected 429 never arrives. It cost one flaky run
before the guard existed. The helper only sleeps in the last few seconds of a
window, so most runs pay nothing.

## Any spec that signs in or registers needs its own client address

Auth rate limiting keys on `cf-connecting-ip` (`docs/security-audit.md` #4,
#11), and nothing sets that header locally — the dev server runs under Vite, not
behind Cloudflare. Without one, every spec shares a single bucket and they
throttle each other; `/sign-up/email` allows three per minute, and two specs
register.

Put `test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } })` at the
top of the file. `clientIp()` is unique per call **on purpose**: buckets live in
the dev server's memory, `db:reset` does not clear them, and
`reuseExistingServer` keeps that server across local re-runs — a fixed address
would make the second run of the day fail for reasons that look nothing like the
cause.

## Seeding an organization

`giveOrganization(email, slug, name)` writes `organization` + `member` rows into
the local D1 directly, the same way `markEmailVerified` flips a column.

It **is** a shortcut around a UI flow, and that is now deliberate. Issue #34
landed a real creation path, so the helper is no longer the only way to reach an
org-owning state — it is the _fast_ way. Use it when a spec needs an
organization to exist before testing something else; do not use it when the
creation path itself is what is under test.

**`organizations.spec.ts` must never call it.** The epic's acceptance criterion
is a brand-new account creating its first organization with no seeded data, so
seeding there would skip exactly the code the spec exists to cover.

`giveMembership(email, slug, role)` adds a second person to a seeded
organization, and `fillOrganization(slug, prefix, count)` fills one with
synthetic members so a pagination assertion is not vacuous — with three people
in an organization, a bounded list and an unbounded one render identically.
Those synthetic users have no password and no `account` row: they exist to be
listed, never signed in as, which also keeps twenty sign-ups off the
credentials rate-limit bucket. Their `createdAt`s increase by design; the list
is ordered by that column, and a page boundary drawn through a block of ties is
where a row gets served on both pages or on neither.

**A spec that asserts on a role badge must not name its accounts after roles.**
`members.spec.ts` calls them Ana, Ben, Cai — an address of
`e2e-mem-owner-…@example.com` satisfies `toContainText("owner")` on its own, so
the badge could be missing entirely and the assertion would still pass.

## Invitations

`invitations.spec.ts` needs three things the other specs do not.

**A session-authenticated API call must send `Origin`.** Better Auth's
`validateOrigin` runs only when the request carries a cookie
(`api/middlewares/origin-check.mjs`: `if (!(forceValidate || useCookies))
return`), so an anonymous sign-in passes without one and every call after it
answers `403 MISSING_OR_NULL_ORIGIN`. A browser always sends it; Playwright's
`request` fixture never does. Sending it is not routing around the check —
`appOrigin()` reads it from the project config rather than restating it.

**Each invitation must target an address not already in that organization.**
Better Auth refuses a second one with
`USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION`, so a user who accepts in one
block cannot be the subject of another — which is why that file has a named user
per case rather than two shared ones.

**`/organization/invite-member` is in the `mail` class** (3/60s per IP+path), so
no describe mints more than three. Sign-ups are a separate bucket, since the key
is `${ip}|${path}`, but `createAccount` still takes an address of its own.

`expireInvitation` / `revokeInvitation` write the columns directly, the same way
`markEmailVerified` does: the window is seven days and revoking needs the UI that
ships in #37, so neither state is otherwise reachable inside one run. The refusal
they produce is still entirely better-auth's. Drive both as the **real
recipient** — better-auth checks the invitation's state before the address, so a
bystander sees the same screen and the test would pass for the wrong reason.

## Testing a loader guard

**Use `?_routes=` to reach a child loader on its own.** Single fetch resolves
every matched loader in one request and **any** of them redirecting
short-circuits the whole payload — so a plain `/dashboard/settings.data` request
is satisfied by the dashboard _layout's_ guard and keeps passing with the child
wide open. `?_routes=routes%2Fdashboard.settings` asks for one loader by id
without its parent, which is the request a child guard has to answer alone, and
the vector audit #10 is about (`loader-guards.spec.ts`).

**Assert on the payload, not the status.** An unauthenticated `.data` request
answers **202** with the redirect encoded in the body as `SingleFetchRedirect` —
checking for a 302, or merely "not 200", passes without proving anything.

Both were verified by removing the guard in a throwaway worktree and confirming
the suite goes red; a guard test that has never been seen to fail is a guess.

## The headless browser has no WebGL

Playwright's headless Chromium returns `null` for **both** `getContext("webgl2")`
and `getContext("webgl")`. Anything drawing to a GPU canvas therefore runs its
unsupported path in every CI run, never its happy path — so a spec asserting
"the canvas mounted" fails here while being perfectly correct in a real browser.

That is useful rather than annoying: it means the landing page's shader
background (`apps/web/app/components/landing/hero-background.tsx`) gets its
fallback exercised on every run, and a regression that dropped the capability
check shows up here first.

It does **not** show up as an error, though. `shaders-react` constructs its mount
inside an un-awaited `async` effect, so the library's throw becomes an unhandled
rejection that no error boundary catches, and its constructor has already
inserted the `<canvas>` by then. Dropping the guard therefore leaves a stranded
empty canvas and a green suite unless something asserts on the DOM — which is
why the spec counts canvases rather than trusting the absence of failures.

Branch on support rather than assuming it — `hero-background.spec.ts` probes
`getContext("webgl2")` in the page and asserts the canvas is absent when the
answer is no.
