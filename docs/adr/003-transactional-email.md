# ADR 003: Transactional email and mandatory verification

**Status:** Accepted
**Date:** 2026-08-06

## Context

`docs/security-audit.md` #2 — account pre-hijacking — has been the highest live
finding since the audit. It needs two things the starter did not have: an
address must be **proven** before it grants access, and a social identity must
not link into an unproven local account. Proving an address requires sending
mail, and password reset (audit: "non-functional, no sender configured") needs
the same capability.

The constraint that shapes everything: **Cloudflare cannot send this mail.**

- **Email Routing** is inbound only — it receives and forwards.
- **Email Workers** `send_email` can send, but only to an address in
  `allowed_destination_addresses`; anything else fails `E_RECIPIENT_NOT_ALLOWED`.
  That is built for "notify the operator", not "verify a stranger".

So a third party is required. This is also a common source of stale advice:
MailChannels was the free default for Workers for years and **discontinued that
tier in mid-2024**, yet still ranks highly in search results.

## Decision

**Resend, behind a one-method port in `@starter/email`.**

- **The port is the decision that matters.** `EmailSender` has a single `send`
  method. Callers depend on it; nothing outside `packages/email` names Resend.
  Swapping to SES or Postmark is a new file, not a migration.
- **Resend as the default transport** — a single `fetch` to
  `api.resend.com/emails`, no SDK, no Node built-ins, so it runs unmodified on
  Workers. Free tier (~3k/month) covers a starter; the paid step is cheap.
- **Opt-in, exactly like Sentry.** No `RESEND_API_KEY`/`EMAIL_FROM` ⇒ the
  logger fallback. A fresh clone signs up, verifies and resets with no Resend
  account, because in development the log line carries the link — that IS the
  local delivery mechanism.
- **The fallback is loud outside development.** There it drops the body and the
  recipient (a live single-use credential and PII respectively) and logs at
  `warn`: absent credentials in production is a misconfiguration, not a mode.
- **Both credentials are required together.** A key with no verified sender
  fails at Resend on every send — a 4xx per signup is worse than one warning.
- **`requireEmailVerification: true`**, `sendOnSignUp`, and
  `autoSignInAfterVerification`. Sign-up creates the row but grants no session.
- **Account linking trusts the provider's claim, never the provider's name.**

### Why `trustedProviders` is empty

This reads backwards until you look at the code. In
`better-auth/dist/oauth2/link-account.mjs` the refusal is:

```js
if (!isTrustedProvider && !userInfo.emailVerified || requireLocalEmailVerified && !dbUser.user.emailVerified || ...)
```

`trustedProviders` does not mean "providers we consider reputable". It means
"link **even when the provider says the address is unverified**". Google and
GitHub both report verification status honestly, so naming either there would
only discard a signal already arriving for free. An empty list is strictly
safer and costs legitimate users nothing.

`requireLocalEmailVerified: true` is the other half, and the one that actually
closes #2: a social identity will not link into a local account that has not
proven its own address. Better Auth 1.6 defaults it to true; it is pinned
explicitly because the whole defence rests on it.

### Rejected alternatives

- **Cloudflare Email Workers `send_email`** — cannot reach an arbitrary
  recipient (above). Fine for operator alerts; useless for auth.
- **MailChannels** — free Workers tier discontinued 2024.
- **SMTP from a Worker** — Workers gained TCP sockets, so this is technically
  possible and still a bad idea: deliverability, connection reuse, and port-25
  blocking are all problems an HTTP API does not have.
- **AWS SES** — cheapest at scale and a fine downstream swap, but SigV4 signing
  plus production-access review is a poor first-run experience for a starter.
- **Closing signup instead of verifying** — considered, and it does kill #2 more
  bluntly. Rejected because it moves the cost onto every downstream product
  (each one must re-open signup and then get verification right anyway), and
  because it makes the starter's default flow untestable as shipped.

## Consequences

- **Sign-up no longer returns a session.** `/register` shows a check-your-email
  notice; `/login` shows the same notice with a resend action when sign-in fails
  with `EMAIL_NOT_VERIFIED`, so a lost email is recoverable rather than a dead
  end.
- **The notice must not claim an account was created.** Better Auth returns the
  same shape for an address that already exists (anti-enumeration); wording that
  confirmed creation would rebuild the oracle it removes.
- **A send failure fails the request.** `sendVerificationEmail` errors propagate
  to `observabilityErrorHandler` rather than being swallowed. Reporting a
  delivery that did not happen is worse, and Better Auth's generic duplicate
  response makes retrying sign-up a working recovery path.
- **`packages/cli` gained one external devDependency**, `better-auth`, so
  `db:seed` can write a real password hash with the same hasher sign-in verifies
  against. The seeded admin can now actually sign in — it never could before,
  because the seed wrote a `user` row with no `account`.
- **E2E flips `emailVerified` in local D1** (`markEmailVerified`) rather than
  following a link. With no key configured the message only reaches the dev
  server's log, which Playwright cannot read — and the token is a signed JWT, so
  there is no `verification` row to read it out of either. The token →
  `/verify-email` round trip is therefore Better Auth's own coverage, not ours;
  everything either side of it is tested, including the refusal.

  Verified manually end to end 2026-08-06 on :5173: sign-up → check-your-email →
  `email.send.logged` carrying the link → follow it → auto sign-in → dashboard.
  Redo this walk if the verification options change; a green suite would not
  catch that leg breaking.

- **The MCP Worker wires a sender it never uses.** It has no signup or reset
  screen, but `createAuth` requires a transport and the env schema is shared.
- Audit #2 is closed. Password reset is functional at the API level; the
  forgot-password **UI** is still unbuilt — no link on `/login`, no reset route.
  Tracked in `docs/security-audit.md` #2 under "Still open from the related gap",
  which stays the single home for it.
