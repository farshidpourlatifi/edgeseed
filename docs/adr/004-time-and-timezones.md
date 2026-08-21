# ADR 004: Time is an input, timezones are a rendering concern

**Status:** Accepted
**Date:** 2026-08-21

## Context

The code had already converged on a way of handling time before anything wrote
it down. Every timestamp column is an epoch integer; four helpers take `now` as
a parameter; one module formats every date the app renders. None of that was a
decision anyone could point at, which means none of it was reviewed for — a new
helper reaching for `new Date()` inline would have passed every gate in the
repo.

That gap closes now rather than later because of what arrives next. Retention
rules (#41) and the activity timeline (#44) are the first features whose
_behaviour_ is time, not merely stamped with it. Conventions that exist before
they are written cost nothing; the same conventions retrofitted afterwards are a
refactor of shipped code with tests already leaning on the old shape.

**The constraint that shapes everything below: on this runtime the clock cannot
be virtualised.** Workers freeze `Date.now()` for the duration of a request —
it advances only across I/O — and neither workerd nor miniflare exposes a way to
set it. Better Auth reads the real clock inside its own modules, and the rate
limiter's window is enforced by a Cloudflare binding this repo does not own. So
the usual escape hatch — freeze the world, assert against a fixed instant — is
not available at the boundary where most of the behaviour lives. Whatever
strategy this ADR lands on has to work with a clock that always says _now_.

The second constraint is that a server-rendered page has **two** runtimes. The
Worker is UTC and answers `en-US`; the reader's browser is wherever they are and
answers whatever they configured. Anything that asks the _runtime_ for a locale
or a zone therefore produces two different strings for one value, React finds
text it did not render, and it discards the server's markup for that subtree.
That is not hypothetical here: it shipped, in the members list and again in the
API-token list, and was found by opening a page in a real browser rather than by
anything in CI.

## Decision

**Time is an input. Timezones are a rendering concern. Tests move the data, not
the clock.**

### Storage is instants, and the application writes every one

Timestamps are stored as UTC instants in `integer({ mode: "timestamp" })`
columns — epoch seconds, no zone, no offset, nothing to interpret. Every column
in `packages/db/src/schema/` is that shape today and new ones follow it.

**No SQL clock defaults, ever** — no `CURRENT_TIMESTAMP`, no `DEFAULT
(unixepoch())`. Where a column has a default it is drizzle's `$defaultFn`
(`packages/db/src/helpers/timestamps.ts`), which runs in **application** code on
the way to the database rather than inside SQLite. The difference looks
cosmetic and is the entire reason rows are time-travelable: a value the
application produced is a value a test can produce differently, while a value
the database produced can only ever be the moment the row was written.

### Time is an input, in one of two shapes

Anything that compares, expires, or writes a moment takes `now` from its caller
and defaults it. Two shapes exist in the tree, and the choice between them is
not stylistic:

- **A `Date` value** — for a function that reads the clock once.
  `packages/auth/src/helpers/api-token.ts` (`now: Date = new Date()`),
  `org-store.ts` and `api-token-store.ts` (`input.now ?? new Date()`).
- **A function returning the value** — for an object that will read the clock
  repeatedly over its life. `packages/observability/src/logger.ts`'s
  `now?: () => string`; a logger built once and stamping every entry would
  otherwise freeze at its construction time, which is a bug, not a seam.

**The exception is named on purpose.** `touchLastUsed` in
`packages/auth/src/helpers/principal.ts` reads the clock bare. Nothing compares
against `lastUsedAt` — it is an operator convenience, explicitly not an audit
guarantee — so no test needs to move it, and threading a parameter through a
fire-and-forget bookkeeping write would buy nothing. A rule with no stated
exception gets applied as ceremony; this is the shape of exception that is
allowed, and "nothing reads it back" is the test.

### The Workers runtime is UTC

There is no server-local timezone to leak, and no deployment where that changes.
This is why the failure mode in this app is always _browser disagrees with
server_ and never _two servers disagree_ — and why the fix is pinning what is
rendered, not configuring the runtime.

### One formatting seam

`apps/web/app/lib/format-date.ts` is **the** place a date becomes a string.
Both the locale (`en-US`) and the zone (UTC) are pinned there, and its own doc
comment carries the reasoning at length; this ADR and that comment must not
drift.

Pinning is a stand-in for internationalisation, not a rejection of it. The
point of the seam is that there is exactly one module to change when this
product grows a locale of its own — which is also why a call site must not
reach for `Intl` or `toLocaleDateString` directly, however small the need looks
at the time. Both shipped defects were a call site doing precisely that.

### IANA names, never offsets

When a user's zone is eventually stored, it is stored as an IANA name —
`Europe/Amsterdam`, not `+02:00`. An offset is a fact about one instant, not
about a place: it changes twice a year, and a stored `+02:00` is silently wrong
for half of it. This is a rule about what may be persisted; nothing stores a
zone today.

### Civil time names its zone

Anything meaning "day", "month", "start of week", or "9am" is a _civil_ time and
is ambiguous without a zone. Such logic states its zone explicitly at the point
it makes the judgement, rather than inheriting whatever the runtime happens to
be. A retention rule saying "older than 30 days" is an instant comparison and
needs no zone; one saying "delete at midnight" has picked a zone whether or not
it admits to it.

### Tests move the data's timestamps, never the world's clock

This is the strategy the runtime constraint forces, and it turns out to be the
better one anyway. A test that needs an expired invitation writes an `expiresAt`
in the past and lets production code read the real clock — so the refusal under
test is the one production produces, arrived at the way production arrives at it.
The precedents are `expireInvitation` / `shortenInvitation` in
`tests/e2e/helpers.ts` at the e2e level, and `now` parameters at the unit level.

The cost is honest: a test cannot assert on behaviour that depends on the clock
passing _during_ the test, and nothing here virtualises Better Auth's internal
reads or the rate-limit window. Those are exercised as themselves or not at all.

### The suites run under a hostile zone and locale

Browser and process are pinned to a zone and locale that deliberately **disagree**
with the Worker's UTC/`en-US`, so an unpinned formatter fails in CI instead of on
a reader's machine. Agreement is the reason both shipped defects survived
review: CI's Chromium answered exactly what the Worker answered, so the mismatch
existed only where nobody was looking. See #60 for the suite-wide pinning; the
targeted precedents it generalises are `format-date.test.ts` (`TZ=Pacific/Kiritimati`)
and `members.spec.ts` (`locale: "en-GB"`).

## Deferred, with named triggers

These are decided but not built. The triggers are the point — each is a thing
that will actually happen, not a vague "when we need it".

- **An injected `Clock` port** carried on request context, with an env-gated
  override. **Trigger:** billing epic #23 scoping, or the first Cron Trigger
  consumer (a retention sweep becoming scheduled). When built, the override
  **fails closed in production** — a request that can move the server's clock is
  a request that can un-expire a session or a token — and it ships its deny-path
  test like every other guard here. Not built now because nothing yet needs the
  server's _own_ clock moved; fixture time travel covers every case in the tree.
- **A cookie carrying zone and locale together**, set the same way the theme
  cookie is, feeding server-side `Intl` through the seam. **Trigger:** the first
  need to display a time in the reader's own zone. Locale rides with zone rather
  than arriving separately because calendar selection and text direction both
  hang off locale, and splitting them means two mechanisms to keep consistent.
  The seam is what makes this a change to one module.
- **Billing period anchoring** — which zone a subscription month turns over in.
  **Trigger:** #23. Lean UTC-anchored, for the same reason everything else here
  is: it is the one zone with no DST discontinuity to fall into.

## Rejected alternatives

**Client-only formatting of SSR'd dates** (render a placeholder, format after
mount, or `suppressHydrationWarning`). This is the obvious fix and it is
rejected, not deferred. It recreates the exact hydration mismatch the seam
exists to prevent, and it is **invisible in CI** — Playwright's Chromium agrees
with the Worker, so the technique tests clean and fails on readers. A date that
must be in the reader's own zone is the zone+locale cookie's job, server-side,
through the seam.

**A mocked or frozen world clock in tests.** Not available: the runtime freezes
`Date.now()` per request and offers no way to set it, and the code that most
needs virtualising — Better Auth's expiry checks, the rate-limit binding — is
not this repo's to patch. A partial mock would be worse than none, because it
would make some paths testable at a fixed instant while the paths around them
kept reading the real clock, and nothing would say which was which.

**Storing a UTC offset instead of a zone name.** Loses the DST rule, so it is
correct for at most half a year per stored value.

**Storing local civil time strings** (`"2026-08-21 09:00"` plus a zone in
another column). Every comparison becomes a parse, ordering becomes a string
sort that is only accidentally right, and the pair can be updated
independently into a state that means nothing.

**Formatting at each call site.** Six lines is small enough to copy, which is
how the same defect reached two pages. Deduplicating this is deduplicating
_knowledge_ — how this product renders a date — not lines that happen to match.

## Consequences

- **A reader west of UTC sees the UTC calendar day.** Something created at 6pm
  in Los Angeles reads as the next day. This is a real cost, it is accepted
  knowingly, and it is what the zone+locale cookie fixes when a product needs
  it fixed.
- **Every rendered date is in one place**, so growing a locale is a change to
  one module and a review question, not a sweep.
- **Time-dependent behaviour is testable at any instant** without controlling
  the clock, because the application writes every timestamp it later reads.
- **The suites are slower to satisfy on first write.** A hostile zone and locale
  mean an assertion that quietly depended on the machine's defaults now fails —
  which is the mechanism working, not a regression.
- **New surface carries a review question** (AGENTS.md, and
  `.github/skills/code-review/SKILL.md`): does `now` arrive as an input, does a
  rendered date go through the seam, and whose zone is the civil-time logic in.
