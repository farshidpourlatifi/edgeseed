import { RATE_LIMIT_RULES } from "@starter/auth/rate-limit";
import { OWNER_MUST_BE_PROMOTED } from "@starter/auth/roles";

/**
 * What to tell somebody whose membership write was refused.
 *
 * Pure and separate from the components for the reason `invitation-state.ts`
 * and `reset-password-errors.ts` are: the branching is where the mistakes live,
 * and every sentence below is assertable without rendering anything.
 *
 * Two rules carried over from those modules, both learned the hard way:
 *
 * - **The default must not claim to know what happened.** An unrecognised
 *   failure is not evidence that the reader did something wrong, and a fallback
 *   that says otherwise sends them around a loop that cannot terminate.
 * - **Map the code, and let the status decide only what the code cannot.** 429
 *   is the exception in the other direction — the rate limiter answers before
 *   the handler runs, so there is no organization error code on it at all.
 */

/** The shape better-auth's client returns on a rejected call. */
export interface MemberActionErrorLike {
  code?: string;
  status?: number;
}

/**
 * Which write was refused. It picks the fallback sentence, and it picks the
 * rate-limit sentence — invitations sit in a far stricter class than the rest.
 */
export type MemberAction = "invite" | "resend" | "revoke" | "changeRole" | "remove" | "leave";

/**
 * Better Auth's codes, from `plugins/organization/error-codes.mjs`, plus this
 * repo's one addition.
 *
 * That one is **imported, not restated** — `@starter/auth/roles` is a leaf with
 * no imports of its own, so the server that throws the code and the browser
 * that renders it read the same constant, and the package index (which would
 * have dragged better-auth into this bundle) stays out of it.
 */
const CODES = {
  ownerMustBePromoted: OWNER_MUST_BE_PROMOTED,
  inviteRoleRefused: "YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE",
  alreadyMember: "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION",
  alreadyInvited: "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION",
  invalidEmail: "INVALID_EMAIL",
  invitationLimit: "INVITATION_LIMIT_REACHED",
  membershipLimit: "ORGANIZATION_MEMBERSHIP_LIMIT_REACHED",
  onlyOwner: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER",
  withoutAnOwner: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER",
  cannotInvite: "YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION",
  cannotUpdate: "YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER",
  cannotDelete: "YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER",
  cannotCancel: "YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION",
  memberNotFound: "MEMBER_NOT_FOUND",
  invitationNotFound: "INVITATION_NOT_FOUND",
} as const;

/**
 * The refusal a stale page produces, worded as the reload it needs.
 *
 * Better Auth answers a cross-tenant target and a vanished one with the same
 * code — `findMemberById` is a global lookup and the organization is compared
 * afterwards — so this sentence covers "somebody else already removed them",
 * "they left", and "that id belongs to another organization". All three mean
 * the same thing to the reader: what you are looking at is out of date.
 */
const STALE = "That person is no longer in this organization. Reload the page." as const;

/**
 * The last-owner rule, in the reader's terms rather than better-auth's.
 *
 * Its own two codes say "leave" for what may have been a removal or a demotion,
 * which reads as a non-sequitur next to a "Change role" dialog. The rule is one
 * rule, so it gets one sentence and the action supplies the verb.
 */
function lastOwnerMessage(action: MemberAction): string {
  const verb =
    action === "changeRole"
      ? "change the last owner's role"
      : action === "remove"
        ? "remove the last owner"
        : "leave as the last owner";

  return `You cannot ${verb} — an organization must always have one. Make somebody else an owner first.`;
}

/**
 * The rate-limit sentence, with the real number rather than a remembered one.
 *
 * `@starter/auth/rate-limit` is a leaf whose only import is type-only, so
 * reading the policy table here costs the browser bundle nothing — and the copy
 * cannot drift away from the limit that produced the 429. Inviting and
 * resending are the same endpoint in the strict `mail` class (three a minute,
 * because they make the app send mail on somebody's say-so); everything else
 * lands in the loose `default` bucket, which a person clicking buttons will
 * never reach, so that sentence stays generic on purpose.
 */
function rateLimitMessage(action: MemberAction): string {
  if (action !== "invite" && action !== "resend") {
    return "You are doing that too quickly. Wait a minute and try again.";
  }

  return (
    `Invitations are limited to ${RATE_LIMIT_RULES.mail.max} a minute, and you have just ` +
    `sent that many. Wait a minute and try again.`
  );
}

/** The sentence for a failure this build does not recognise. */
function fallback(action: MemberAction): string {
  switch (action) {
    case "invite":
      return "Could not send the invitation. Try again.";
    case "resend":
      return "Could not resend the invitation. Try again.";
    case "revoke":
      return "Could not revoke the invitation. Try again.";
    case "changeRole":
      return "Could not change that role. Try again.";
    case "remove":
      return "Could not remove that person. Try again.";
    case "leave":
      return "Could not leave the organization. Try again.";
  }
}

/**
 * Turn a rejected membership write into something worth reading.
 *
 * The permission codes (`cannotInvite`, `cannotUpdate`, `cannotDelete`,
 * `cannotCancel`) are reachable **without a bug**, even though the page does
 * not render a control the reader lacks the role for: the loader decided that
 * when the page was served, and a demotion in another tab — or by somebody else
 * — makes the answer stale without reloading anything. So they get a sentence
 * that explains rather than one that accuses.
 */
export function memberActionMessage(action: MemberAction, error: MemberActionErrorLike): string {
  // Before the codes: the limiter refuses in better-auth's router hook, ahead
  // of the handler, so a 429 carries no organization error code to match on.
  if (error.status === 429) return rateLimitMessage(action);

  switch (error.code) {
    case CODES.ownerMustBePromoted:
    case CODES.inviteRoleRefused:
      return "Invite this person as a member or an admin, then promote them once they have joined.";
    case CODES.alreadyMember:
      return "That address already belongs to somebody in this organization.";
    case CODES.alreadyInvited:
      // Not an error to recover from by retrying — the invitation is sitting on
      // the list below, with the control that does what they meant.
      return "That address has already been invited. Use Resend on their pending invitation.";
    case CODES.invalidEmail:
      return "That does not look like an email address.";
    case CODES.invitationLimit:
      return "This organization has too many invitations pending. Revoke some before sending more.";
    case CODES.membershipLimit:
      return "This organization has reached its member limit.";
    case CODES.onlyOwner:
    case CODES.withoutAnOwner:
      return lastOwnerMessage(action);
    case CODES.cannotInvite:
      return "You no longer have permission to invite people to this organization.";
    case CODES.cannotUpdate:
    case CODES.cannotDelete:
      return "You no longer have permission to do that. Reload the page.";
    case CODES.cannotCancel:
      return "You no longer have permission to revoke invitations here.";
    case CODES.memberNotFound:
      return STALE;
    case CODES.invitationNotFound:
      return "That invitation has already been used or withdrawn. Reload the page.";
    default:
      return fallback(action);
  }
}
