import { INVITATION_EXPIRES_IN_DAYS } from "@starter/auth/invitation";

/**
 * What the accept-invitation screen is showing, and why.
 *
 * Pure and separate from the route for the same reason `reset-password-link.ts`
 * is: the branching is where the mistakes live, and a unit test proves far more
 * here than a component test would for far more setup.
 *
 * `/accept-invitation` has three entry states rather than two, because it is the
 * one auth screen a **signed-out** reader is expected to reach — the link
 * arrives in their mailbox, not from inside the app.
 */

/**
 * Why an invitation cannot be used.
 *
 * Deliberately not one bucket. Better Auth answers three genuinely different
 * situations with the same 400/403 pair, and each needs opposite advice: fetch
 * a new invitation, switch accounts, or verify your address. Telling all three
 * readers the same thing sends two of them around a loop that cannot terminate
 * — the mistake `reset-password-errors.ts` documents having shipped once.
 */
export type InvitationFailure =
  /** Expired, revoked, already accepted, or never existed. Indistinguishable — see below. */
  | "dead"
  /** The signed-in account's address is not the one that was invited. */
  | "wrong-account"
  /** The session's address is unproven, and `requireEmailVerificationOnInvitation` is pinned on. */
  | "needs-verification"
  /** `membershipLimit` reached. Nothing the reader can do; the organization has to act. */
  | "org-full"
  /** Anything else. Not evidence the invitation is bad, so it must not claim it is. */
  | "error";

/**
 * The shape both call sites reduce to.
 *
 * Two different objects arrive here. Server-side, `auth.api.getInvitation`
 * throws better-call's `APIError`, which carries `body.code` and a numeric
 * `statusCode`. Client-side, `authClient.organization.acceptInvitation` resolves
 * with `{ error: { code, status } }`, where `status` is the number. Normalising
 * at the boundary keeps one mapping instead of two that can disagree.
 */
export interface InvitationErrorLike {
  code?: string;
  status?: number;
}

/** Better Auth's codes, from `plugins/organization/error-codes.mjs`. */
const NOT_RECIPIENT = "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION";
const VERIFY_TO_VIEW = "EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION";
const VERIFY_TO_ACCEPT = "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION";
const MEMBERSHIP_LIMIT = "ORGANIZATION_MEMBERSHIP_LIMIT_REACHED";

/**
 * Read a rejected invitation call as something worth telling the reader.
 *
 * **The code is checked first and the status only as a fallback, and that order
 * is load-bearing in the opposite direction from `resetErrorMessage`.** There
 * the rule was "map the code, never the status". Here one branch has no code at
 * all: `getInvitation`'s dead-invitation case is
 * `APIError.fromStatus("BAD_REQUEST", { message: "Invitation not found!" })` —
 * a bare message, deliberately outside `ORGANIZATION_ERROR_CODES` — so a
 * code-only mapping would fall through on the single most common failure. Do
 * not "tidy" this into one or the other.
 *
 * Expired, revoked and already-accepted are genuinely indistinguishable: both
 * `getInvitation` and `acceptInvitation` collapse `!invitation`,
 * `status !== "pending"` and `expiresAt < now` into one refusal. So they share
 * one sentence, and it is worded to cover all three.
 *
 * A status that is not 400 or 403 is **not** read as a dead invitation. An
 * unrecognised failure is no evidence about the link, and guessing that it is
 * recreates the loop this type exists to avoid.
 */
export function invitationFailure(error: InvitationErrorLike): InvitationFailure {
  switch (error.code) {
    case NOT_RECIPIENT:
      return "wrong-account";
    case VERIFY_TO_VIEW:
    case VERIFY_TO_ACCEPT:
      return "needs-verification";
    case MEMBERSHIP_LIMIT:
      return "org-full";
  }

  // No code, or one this build does not know. 400 is the dead-invitation
  // refusal; 403 with an unknown code is still a refusal to act on this
  // account, which is the closest honest reading.
  if (error.status === 400) return "dead";
  if (error.status === 403) return "wrong-account";
  return "error";
}

/**
 * The three states the screen can be in, and the loader's return type.
 *
 * Written out rather than inferred so every branch carries the same property
 * set — an inferred union whose `unavailable` members disagree about
 * `signedInAs` makes the component narrow for a difference that does not
 * matter.
 */
export type InvitationScreen =
  /** No session. The link came from a mailbox, so this is expected, not an error. */
  | { kind: "signed-out"; invitationId: string }
  /** A live invitation addressed to the signed-in account. */
  | { kind: "ready"; invitationId: string; organizationName: string; inviterEmail: string }
  /**
   * Nothing to accept — for now. `signedInAs` is present only when there was a
   * session to name, and `invitationId` only when the URL carried one at all:
   * the empty-`?id=` case has nothing to remember, and nothing to come back to.
   */
  | { kind: "unavailable"; reason: InvitationFailure; signedInAs?: string; invitationId?: string };

/**
 * Whether signing in as somebody else could still make this invitation work.
 *
 * The dead-end screens all offer a way back to `/login`, and for two of them
 * that trip is the actual remedy: the invitation is alive and pending, and the
 * only thing wrong is which account is holding it. Those two must carry the
 * invitation with them, or the reader does exactly what they were told to do,
 * lands on `/dashboard`, and has to go back to their mailbox to find the link
 * again — the same drop the signed-out flow already avoids.
 *
 * The rest deliberately do not. A `dead` invitation has nothing to come back
 * to; `org-full` is not about the account at all, so a different one cannot
 * help; and `error` says nothing about either, so promising a round trip that
 * resolves it would be a guess.
 */
export function invitationSurvivesReauth(failure: InvitationFailure): boolean {
  return failure === "wrong-account" || failure === "needs-verification";
}

export interface InvitationFailureCopy {
  title: string;
  description: string;
}

/**
 * The sentence for each failure. A table rather than branching in the component,
 * so the wording is assertable without rendering anything.
 */
export function invitationFailureCopy(
  failure: InvitationFailure,
  signedInAs?: string,
): InvitationFailureCopy {
  switch (failure) {
    case "dead":
      return {
        title: "This invitation is no longer valid",
        description:
          // Derived, not restated. The server enforces this window and the
          // invitation email quotes it; a third hardcoded copy is the one that
          // goes stale when the constant moves.
          `Invitations expire after ${INVITATION_EXPIRES_IN_DAYS} days and can only be used once. ` +
          `Ask whoever invited you to send a new one.`,
      };
    case "wrong-account":
      return {
        title: "This invitation is for a different account",
        description: signedInAs
          ? `It was sent to another address, and you are signed in as ${signedInAs}. Sign out and sign back in with the invited address.`
          : "It was sent to another address. Sign out and sign back in with the address it was sent to.",
      };
    case "needs-verification":
      return {
        title: "Confirm your email address first",
        description:
          "Your address has not been verified yet, so this invitation cannot be accepted. Verify it and open this link again.",
      };
    case "org-full":
      return {
        title: "This organization is full",
        description:
          "It has reached its member limit, so nobody else can join right now. Whoever invited you will need to make room.",
      };
    case "error":
      return {
        title: "Something went wrong",
        description:
          "The invitation could not be loaded. This is not necessarily a problem with the invitation itself — try again in a moment.",
      };
  }
}
