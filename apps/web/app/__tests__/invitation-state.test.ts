import { describe, it, expect } from "vitest";
import { INVITATION_EXPIRES_IN_DAYS } from "@starter/auth/invitation";
import {
  invitationFailure,
  invitationFailureCopy,
  invitationSurvivesReauth,
} from "~/lib/invitation-state";

/**
 * The mapping is the whole risk on this screen. Better Auth answers several
 * genuinely different situations with the same two statuses, and the failure
 * mode of getting it wrong is a reader who is told to do something that cannot
 * possibly work — the loop `reset-password-errors.ts` documents having shipped.
 */
describe("invitationFailure", () => {
  it("should read a recipient mismatch as the wrong account, not a dead link", () => {
    expect(
      invitationFailure({ code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION", status: 403 }),
    ).toBe("wrong-account");
  });

  /** Both codes: one is raised by `getInvitation`, the other by `acceptInvitation`. */
  it("should read either verification code as needing verification", () => {
    expect(
      invitationFailure({ code: "EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION", status: 403 }),
    ).toBe("needs-verification");
    expect(
      invitationFailure({
        code: "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION",
        status: 403,
      }),
    ).toBe("needs-verification");
  });

  it("should read a membership limit as the organization being full", () => {
    expect(invitationFailure({ code: "ORGANIZATION_MEMBERSHIP_LIMIT_REACHED", status: 403 })).toBe(
      "org-full",
    );
  });

  it("should read acceptInvitation's own refusal as a dead invitation", () => {
    expect(invitationFailure({ code: "INVITATION_NOT_FOUND", status: 400 })).toBe("dead");
  });

  /**
   * The case that forces the status fallback to exist at all.
   *
   * `getInvitation`'s dead-invitation branch is
   * `APIError.fromStatus("BAD_REQUEST", { message: "Invitation not found!" })` —
   * deliberately outside `ORGANIZATION_ERROR_CODES`, so it carries **no code**.
   * A code-only mapping would fall through to the generic error on the single
   * most common failure this screen sees. Do not "tidy" the fallback away.
   */
  it("should read a codeless 400 as a dead invitation", () => {
    expect(invitationFailure({ status: 400 })).toBe("dead");
  });

  it("should read a codeless 403 as the wrong account", () => {
    expect(invitationFailure({ status: 403 })).toBe("wrong-account");
  });

  /**
   * The deny path that keeps the screen honest. A 500, a network failure or a
   * rate-limit 429 says nothing about the invitation, and claiming it is dead
   * sends the reader to ask for a replacement that will fail the same way.
   */
  it.each([500, 429, 401, undefined])(
    "should not claim the invitation is dead on status %s",
    (status) => {
      expect(invitationFailure({ status })).toBe("error");
    },
  );

  it("should prefer a known code over the status it arrived with", () => {
    // A future better-auth could move this refusal to another status; the code
    // is the contract, and the fallback must not override it.
    expect(
      invitationFailure({ code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION", status: 400 }),
    ).toBe("wrong-account");
  });

  it("should fall back on an unrecognised code rather than guessing from it", () => {
    expect(invitationFailure({ code: "SOMETHING_NEW", status: 400 })).toBe("dead");
    expect(invitationFailure({ code: "SOMETHING_NEW", status: 503 })).toBe("error");
  });
});

describe("invitationFailureCopy", () => {
  it("should name the signed-in address when there is one to name", () => {
    const copy = invitationFailureCopy("wrong-account", "someone@example.com");
    expect(copy.description).toContain("someone@example.com");
  });

  it("should still read as a whole sentence with no address to name", () => {
    const copy = invitationFailureCopy("wrong-account");
    expect(copy.description).not.toContain("undefined");
    expect(copy.description).toMatch(/sign out/i);
  });

  /**
   * The point of the type: each failure has to send the reader somewhere
   * different. Identical copy across two of them is the bug this catches.
   */
  it("should give every failure its own title", () => {
    const titles = (
      ["dead", "wrong-account", "needs-verification", "org-full", "error"] as const
    ).map((failure) => invitationFailureCopy(failure).title);

    expect(new Set(titles).size).toBe(titles.length);
  });

  it("should not tell a reader with a transient error to fetch a new invitation", () => {
    expect(invitationFailureCopy("error").description).not.toMatch(/new one/i);
  });

  /**
   * The window is stated in three places — the server's `invitationExpiresIn`,
   * the invitation email, and this sentence. Deriving all three from one
   * constant is what stops the last two from outliving a change to the first.
   */
  it("should quote the configured expiry rather than a hardcoded one", () => {
    expect(invitationFailureCopy("dead").description).toContain(
      `${INVITATION_EXPIRES_IN_DAYS} days`,
    );
  });
});

/**
 * Which dead ends keep the invitation on their way out.
 *
 * The bug this pins: the wrong-account screen tells the reader to sign in as
 * somebody else, and the invitation is *still pending* the whole time. Sending
 * them to a bare `/login` drops it, so they follow the instruction, land on the
 * dashboard, and have to go back to their mailbox for a link that never
 * stopped working.
 */
describe("invitationSurvivesReauth", () => {
  it.each(["wrong-account", "needs-verification"] as const)(
    "should carry the invitation through a re-sign-in for %s",
    (failure) => {
      expect(invitationSurvivesReauth(failure)).toBe(true);
    },
  );

  /**
   * The deny half, and it is not symmetry for its own sake: promising a round
   * trip that cannot work is the same defect in the other direction. A `dead`
   * invitation has nothing to return to, `org-full` is not about the account,
   * and `error` is evidence of neither.
   */
  it.each(["dead", "org-full", "error"] as const)(
    "should not promise a round trip for %s",
    (failure) => {
      expect(invitationSurvivesReauth(failure)).toBe(false);
    },
  );
});
