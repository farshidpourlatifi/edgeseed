/**
 * Where each auth flow lands when it is done.
 *
 * Separate from `auth-client.ts` because that module *constructs* a Better Auth
 * client at import time, and these are pure data. `tests/e2e/password-reset.spec.ts`
 * imports them to follow the same URLs production does — which it could not do
 * without building a browser auth client inside the Playwright process, coupling
 * the suite to something it does not use.
 */

/**
 * Where a freshly verified address lands.
 *
 * Every call that mints a verification link must pass this as `callbackURL`.
 * Better Auth defaults it to `"/"` (`sign-up.mjs`: `body.callbackURL ? … :
 * encodeURIComponent("/")`) and `/verify-email` redirects there after
 * `autoSignInAfterVerification` sets the session — so omitting it drops a
 * just-signed-in user on the landing page, and in split-origin mode
 * `server/origins.ts` then bounces them to the marketing host while their
 * cookie stays on the app host, which reads as being logged out.
 *
 * One constant rather than two literals because "where a verified user lands"
 * is a single fact: sign-up and resend drifted apart exactly once already.
 */
export const POST_VERIFICATION_REDIRECT = "/dashboard";

/**
 * Where a reset link lands — the same fact as `routes.ts`'s `reset-password`
 * entry, which is why it is a constant and not a literal at the call site.
 *
 * Passed as `redirectTo` on `requestPasswordReset`. Better Auth emails
 * `${baseURL}/reset-password/<token>?callbackURL=<this>` and the GET on that
 * link 302s to `new URL(callbackURL, ctx.baseURL)` — `ctx.baseURL` being
 * `BETTER_AUTH_URL` + `/api/auth`. So an **absolute path** resolves against the
 * app origin no matter which host the reader opened their mail on, which is
 * what keeps the split-origin deployment correct for free. A bare relative
 * segment (`reset-password`, no slash) would resolve under `/api/auth/` and
 * 404; do not shorten it.
 *
 * If this and `routes.ts` drift, the emailed link 302s to a 404 and the only
 * signal is a user who cannot reset. `tests/e2e/password-reset.spec.ts` builds
 * its link from **this constant**, so a drifted value is the URL the spec
 * actually follows and the missing form fails it. Hard-coding the path there
 * instead would make that walk decorative — it was, once.
 */
export const PASSWORD_RESET_REDIRECT = "/reset-password";

/**
 * Where a completed reset sends the reader.
 *
 * `/login` rather than `/dashboard`: `resetPassword` mints no session — and
 * with `revokeSessionsOnPasswordReset` it has just deleted every existing one —
 * so there is nothing to carry into the dashboard. Signing in with the new
 * password is the proof that the reset worked, and for an address that was
 * never verified `/login` is also what surfaces the verification notice.
 */
export const POST_RESET_REDIRECT = "/login";
