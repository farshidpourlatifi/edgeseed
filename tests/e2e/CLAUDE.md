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
- **The MCP Worker is booted by `organization-lifecycle.spec.ts`, not by
  `webServer`**, and that is deliberate twice over. It shares
  `apps/web/.wrangler/state` so it reads the same D1 the browser writes, and two
  miniflare instances cannot _initialise_ one persist root at the same time — a
  `webServer` entry starts in parallel with the web app and dies at boot with
  `Directory named "cache:storage" not found`, about a directory that exists.
  Started after the web server is serving, it is reliable. It also keeps the
  cost local: `webServer` is not scoped to a project or a `-g` filter, so
  declaring it there made `pnpm test:e2e -g favicon` compile a Worker and open a
  Durable Object namespace. `startMcpWorker`/`stopMcpWorker` in `mcp-client.ts`
  own the lifecycle, and the stop signals the whole process group — an orphaned
  wrangler holding port 8788 or the shared D1 breaks the _next_ run in a way
  that looks nothing like a leak.
- **The MCP Worker runs with `--var SENTRY_DSN:` and must keep doing so.** With
  a real DSN in a developer's `apps/mcp/.dev.vars`, this Worker alternates
  between ~10s responses and 30s `503`s and the OAuth grant fails about half the
  time. **It is the Sentry flush, not KV** — compare the handler's own
  `durationMs` with what wrangler measures for the same request: `durationMs: 4`
  against `POST /register 201 (9927ms)`, versus `durationMs: 1` against
  `(3ms)` with the DSN emptied. The KV write finishes in single-digit
  milliseconds; the rest is spent after the handler returns, with `withSentry`
  holding the response on a flush that `enableLogs: true` turns into a network
  round trip per log line. A local-dev configuration artifact, not a defect —
  `withSentry`, miniflare's KV and the wrangler/workerd skew were each tested
  and cleared, and CI never sees it because the `.dev.vars` it writes names no
  DSN. **Do not "fix" `withSentry` on the strength of it**; with no DSN it
  really is the pass-through the docs describe. The override is right anyway: a
  test run must not inherit local configuration, nor ship its deliberate
  deny-path failures into a real Sentry project. `--var` beats `.dev.vars`, the
  same mechanism `check:boot` uses.
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

## The suite runs where the Worker does not

`playwright.config.ts` pins every browser context to `Pacific/Kiritimati`
(UTC+14) and `en-GB`. The Worker is UTC and answers `en-US`, so the two
deliberately disagree on **both** axes: a date rendered by anything but the
pinned seam comes out different on the two sides of hydration.

**That makes a mismatch observable, not observed — the difference matters.**
React reports one by logging an error and re-rendering the subtree on the
client, so a spec that asserts nothing about the rendered value and installs no
listener carries on passing while the server's markup is discarded. Pinning
alone would move where the bug hides rather than catch it.

The watching half is `watchForHydrationFailures` in `helpers.ts`. **A spec that
drives a page rendering a date installs it and asserts the result is empty**,
and asserts the pinned `en-US` shape of the date itself. Two pages qualify
today — `/dashboard/members` and `/dashboard/settings` — and `members.spec.ts`
and `api-tokens.spec.ts` cover them. A third page that renders a date adds the
same pair, or it is not covered, whatever the pins say.

Agreement is what let the original defect ship. `toLocaleDateString(undefined,
…)` asks the _runtime_ for its locale and zone, and a server-rendered page has
two runtimes — but CI's Chromium answered exactly what the Worker answered, so
the two strings matched, the suite went green, and the mismatch existed only on
a reader's machine. It was found by opening the page in a real browser.

**The pin has its own deny-path test, because it is invisible.** Delete the two
lines and every other spec still passes — a correctly pinned formatter renders
the same string in any browser, so nothing notices that the suite stopped
testing the thing it was widened to test. `hostile-environment.spec.ts` asserts
the browser's resolved zone and locale, and that neither matches the Worker's.
It restates those values rather than importing them from the config on purpose:
a shared constant would move with the edit that removed the pin and assert
nothing. Both halves were seen red — with the pin deleted the spec reports the
machine's own zone.

The unit suite is pinned the other way, to `America/Los_Angeles`
(`vitest.config.ts`), so the day boundary is crossed in both directions:
UTC+14 pushes a late-UTC instant onto the next day, UTC-7 pulls an early one
onto the previous. `format-date.test.ts` carries the matching config assertions
for that side, locale included: the unit suite is pinned to `en-GB` as well, so
removing the locale from the seam fails six cases there in twelve seconds
rather than waiting on the e2e run. Dropping the zone option fails two, and
changing the zone fails one — an eastern zone caught by the late instant, a
western one by the early instant.

Both pins have to be set in `vitest.config.ts` itself, and they work for
different reasons. Node re-reads `TZ` whenever it changes, so that one would
apply anywhere; it fixes the default _locale_ at startup and ignores a later
assignment, so `LC_ALL` works only because vitest runs test files in **forked**
workers that read the inherited environment as they boot. Setting `LC_ALL`
inside a running test does nothing — the process it would need to convince has
already started.

A spec that needs a date on screen should expect the pinned `en-US` rendering
(`Aug 15, 2026`), never the browser's — that is what `format-date.ts` exists to
guarantee, and asserting the browser's form would assert the bug.

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
`markEmailVerified` does: the window is seven days, and revoking through the UI
would spend a whole describe reaching a state one `UPDATE` gets to. The refusal
they produce is still entirely better-auth's. Drive both as the **real
recipient** — better-auth checks the invitation's state before the address, so a
bystander sees the same screen and the test would pass for the wrong reason.

`shortenInvitation` is the third of that family and the least obvious. It pulls
`expiresAt` **in** to an hour from now, never past it, so that "resend extends
the expiry" is an assertion rather than a formality: the window is seven days
and SQLite stores whole seconds, so an invitation created and resent inside one
second comes back byte-identical. It must not be `expireInvitation` — better-auth
filters expired rows out of `findPendingInvitation`, so resending past one mints
a _second_ invitation with a new id, which is the opposite of what that test is
about.

## Membership writes are asserted at the endpoint, not at a missing button

`member-actions.spec.ts` drives the allow paths through the page and every deny
path through `/api/auth/organization/*` with a real session cookie. That split
is the point rather than a convenience: the page renders no control the reader
lacks the role for, so a click-driven deny test asserts a button is absent —
true, and no evidence at all about what the server would have answered. The
browser holds that cookie, and the writes go straight to better-auth, so the
endpoint is the boundary and the endpoint is what gets tested.

Two of those cases fail against **stock better-auth**, whose `adminAc` grants
`member: ["update", "delete"]` — an admin changing a role, and an admin removing
somebody. Both were watched going red with `ORGANIZATION_ROLES.admin` reverted
to `adminAc` before they were kept. They are the only thing standing between
that narrowing and a silent regression on a version bump, so do not weaken them
into status-only assertions.

**Refused requests still spend the rate limit.** The limiter runs in
better-auth's router hook, ahead of the handler, so a deny-path test costs the
`mail` bucket exactly what an allow-path one does. The describe that provokes a
429 on purpose mints its address **inside the test** rather than through
`test.use`, because `retries: 1` would otherwise re-run it against the bucket
the first attempt had already spent, and the calls expected to succeed would
429 instead.

## A spec about a breakpoint proves it is at that breakpoint

`mobile-organization-switcher.spec.ts` sets `viewport: { width: 375, height: 812 }`
and every test opens by asserting `getByRole("complementary")` has count 0 — the
sidebar, hidden by `hidden md:block`, and with it the desktop switcher.

Without that assertion the file is worthless: the desktop control satisfies every
locator in it, so a run at the default 1280px passes against an app with **no**
mobile control at all. That is exactly how the gap survived #34's own coverage
until #36 walked into it. Playwright's role engine skips anything hidden from the
accessibility tree, so `display: none` really does mean count 0 here.

Both halves were seen red before being kept: with the topbar's
`OrganizationMenuItems` removed all three tests fail on the missing menu items,
and with `CreateOrganizationDialog` moved _inside_ `DropdownMenuContent` the
create case alone fails, because Radix unmounts the menu on close and takes the
dialog with it.

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
