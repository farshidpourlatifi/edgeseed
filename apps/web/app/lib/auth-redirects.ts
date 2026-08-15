import {
  INVITATION_ACCEPT_PATH,
  INVITATION_ID_PARAM,
  INVITATION_EXPIRES_IN_DAYS,
} from "@starter/auth/invitation";

/**
 * Where each auth flow lands when it is done.
 *
 * Separate from `auth-client.ts` because that module *constructs* a Better Auth
 * client at import time, while everything here is pure — constants, and the two
 * path builders derived from them. `tests/e2e/password-reset.spec.ts` and
 * `tests/e2e/invitations.spec.ts` import them to follow the same URLs production
 * does, which they could not do without building a browser auth client inside
 * the Playwright process, coupling the suite to something it does not use.
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

/**
 * Where an invitation link lands, re-exported so this module stays the one place
 * a route or a spec looks up "where does this flow end".
 *
 * **Owned by `@starter/auth`, not by this file, and the inversion is the point.**
 * The three constants above are handed *to* Better Auth by the browser at the
 * call site, so the web app can own them. An invitation URL is built *inside*
 * `createAuth` — `sendInvitationEmail` is server configuration — and
 * `@starter/auth` cannot import from `apps/web`. Declaring it here and passing
 * it down would mean threading a value through `authMiddleware` for no gain, so
 * the package owns it and this re-export keeps one name at the call sites.
 *
 * `INVITATION_ID_PARAM` travels with it because the pair is one fact: the path
 * is useless without knowing which parameter carries the id, and
 * `/organization/get-invitation` already names it `id`.
 *
 * Imported from `@starter/auth/invitation`, **never** from the package root:
 * the root index re-exports `createAuth`, so a browser module reaching for it
 * would pull better-auth, drizzle and the D1 adapter into the client bundle.
 * The subpath is a leaf with no imports of its own.
 */
export { INVITATION_ACCEPT_PATH, INVITATION_ID_PARAM, INVITATION_EXPIRES_IN_DAYS };

/**
 * The query parameter that carries an invitation through a sign-in or sign-up
 * round trip.
 *
 * Deliberately **not** a general `redirectTo`. It carries an id, and the only
 * destination it can produce is `INVITATION_ACCEPT_PATH` — a fixed path this
 * module owns — so there is no caller-supplied path to validate and no open
 * redirect to get wrong. A bogus id costs the reader one dead-invitation
 * screen and nothing else.
 */
export const INVITATION_PARAM = "invitation";

/**
 * The in-app path that spends an invitation.
 *
 * Relative, unlike the absolute URL `@starter/auth` puts in the email: every
 * caller of this one is already on the app origin, and a relative path keeps
 * `pnpm dev` and the e2e suite working without knowing what that origin is.
 */
export function invitationAcceptPath(invitationId: string): string {
  return `${INVITATION_ACCEPT_PATH}?${INVITATION_ID_PARAM}=${encodeURIComponent(invitationId)}`;
}

/**
 * Where a signed-out invitee goes to sign in or register, carrying the
 * invitation so the page can send them back to it.
 *
 * The id is encoded rather than interpolated raw. Better Auth's own ids are
 * URL-safe, but this value reaches here straight off a query string the reader
 * controls, and a raw `&` would silently truncate the parameter.
 */
export function invitationAuthPath(page: "/login" | "/register", invitationId: string): string {
  return `${page}?${INVITATION_PARAM}=${encodeURIComponent(invitationId)}`;
}
