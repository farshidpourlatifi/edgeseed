/**
 * Where an invitation link points, and how long it stays acceptable.
 *
 * **Better Auth mints no invitation URL of its own.** Its `sendInvitationEmail`
 * JSDoc says so outright — "Better Auth doesn't generate invitation URLs" — and
 * `plugins/organization/routes/crud-invites.mjs` only ever hands the callback an
 * invitation id. So there is no canonical accept path to match: this one is the
 * product's own. `?id=` reuses the query parameter
 * `/organization/get-invitation` already takes, so a single name carries from
 * the emailed link through to the endpoint that reads it.
 *
 * These live here rather than beside the other redirect constants in
 * `apps/web/app/lib/auth-redirects.ts`, and the direction is inverted on
 * purpose. `POST_VERIFICATION_REDIRECT`, `PASSWORD_RESET_REDIRECT` and
 * `POST_RESET_REDIRECT` are passed *into* Better Auth by the browser at the call
 * site, so the web app owns them. An invitation URL is built *inside*
 * `createAuth` — `sendInvitationEmail` is server configuration, and
 * `@starter/auth` cannot import from `apps/web`. `auth-redirects.ts` re-exports
 * the path, so there is still exactly one value and the e2e suite reads the same
 * one production does.
 */

/**
 * The route that spends an invitation. The `accept-invitation` entry in
 * `apps/web/app/routes.ts` must agree, and `APP_PATH_PREFIXES` in
 * `apps/web/server/origins.ts` must carry it or a split-origin deployment
 * strands the reader on the marketing host.
 */
export const INVITATION_ACCEPT_PATH = "/accept-invitation";

/** The query parameter carrying the invitation id, matching `/organization/get-invitation`. */
export const INVITATION_ID_PARAM = "id";

/**
 * How long an invitation stays acceptable — seven days.
 *
 * Pinned rather than inherited. Better Auth defaults to 48 hours
 * (`getDate(orgOptions.invitationExpiresIn || 3600 * 48, "sec")` in
 * `crud-invites.mjs`), which kills an invitation sent on a Friday afternoon
 * before the recipient's Monday. A resend can now revive one from the members
 * page, but that costs somebody an interruption for a window that was simply
 * too short.
 *
 * The longer window does not widen the exposure the way it would for a
 * verification or reset link, because the link alone grants nothing: accepting
 * needs a session whose address matches the invitation, and `acceptInvitation`
 * refuses anything else with `YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION`.
 */
export const INVITATION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;

/**
 * The same window in days, for copy that has to name it.
 *
 * Derived rather than restated, so the sentence in the invitation email cannot
 * drift away from the expiry the server actually enforces.
 */
export const INVITATION_EXPIRES_IN_DAYS = INVITATION_EXPIRES_IN_SECONDS / 60 / 60 / 24;

/**
 * The absolute URL an invitation email points at.
 *
 * Absolute, and resolved against `BETTER_AUTH_URL`, because that binding *is*
 * the app origin by definition — `apps/web/server/origins.ts` treats it as such
 * — and the reader opens this link from a mail client with no origin of its own.
 * A relative path would be meaningless there, and in split-origin mode a link
 * built from the marketing host is a redirect at best.
 *
 * This is the same class of trap as `POST_VERIFICATION_REDIRECT`, and it has the
 * same blind spot: no e2e can cover the leg, because the emailed body only ever
 * reaches the dev server's log. That is exactly why this is a function with its
 * own unit test rather than a template literal inside `createAuth`.
 */
export function invitationAcceptUrl(baseURL: string, invitationId: string): string {
  const url = new URL(INVITATION_ACCEPT_PATH, baseURL);
  url.searchParams.set(INVITATION_ID_PARAM, invitationId);
  return url.toString();
}
