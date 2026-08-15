import { describe, it, expect } from "vitest";
import { OWNER_MUST_BE_PROMOTED } from "@starter/auth/roles";
import { RATE_LIMIT_RULES } from "@starter/auth/rate-limit";
import { memberActionMessage, type MemberAction } from "~/lib/member-action-errors";

const ACTIONS: MemberAction[] = ["invite", "resend", "revoke", "changeRole", "remove", "leave"];

/**
 * The code the plugin hook throws is the code this module matches on, because
 * both import it from `@starter/auth/roles`. Asserted anyway: the import proves
 * they are the same string, not that the mapping reaches the right sentence.
 */
describe("the refusal codes match the server", () => {
  it("names the promotion path when an invitation asked for owner", () => {
    expect(memberActionMessage("invite", { code: OWNER_MUST_BE_PROMOTED, status: 403 })).toContain(
      "promote them once they have joined",
    );
  });
});

describe("memberActionMessage — rate limiting", () => {
  /**
   * The limiter refuses inside better-auth's router hook, before the handler
   * runs, so a 429 carries no organization error code. Matching on the code
   * first would drop every one of these into the fallback.
   */
  it("reads a 429 before it looks at the code", () => {
    expect(memberActionMessage("invite", { status: 429 })).toContain("Wait a minute");
  });

  it("quotes the real mail limit for invitations, so the copy cannot drift", () => {
    for (const action of ["invite", "resend"] as const) {
      expect(memberActionMessage(action, { status: 429 })).toContain(
        `${RATE_LIMIT_RULES.mail.max} a minute`,
      );
    }
  });

  /**
   * Everything else sits in the loose `default` bucket, which somebody clicking
   * buttons will not reach — naming a number there would be a promise about a
   * limit the copy has no reason to know.
   */
  it("stays generic for the actions outside the mail class", () => {
    for (const action of ["revoke", "changeRole", "remove", "leave"] as const) {
      expect(memberActionMessage(action, { status: 429 })).not.toContain("Invitations are limited");
    }
  });
});

describe("memberActionMessage — the last-owner rule", () => {
  /**
   * One rule, one sentence, and the verb comes from the action. Better Auth
   * says "leave" for what may have been a removal or a demotion, which reads as
   * a non-sequitur next to a "Change role" dialog.
   */
  it("names the action rather than always saying leave", () => {
    const demote = memberActionMessage("changeRole", {
      code: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER",
      status: 400,
    });
    const remove = memberActionMessage("remove", {
      code: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER",
      status: 400,
    });

    expect(demote).toContain("change the last owner's role");
    expect(remove).toContain("remove the last owner");
    expect(demote).not.toContain("leave as");
  });

  it("tells them the way out, not just the refusal", () => {
    expect(
      memberActionMessage("leave", {
        code: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER",
        status: 400,
      }),
    ).toContain("Make somebody else an owner first");
  });

  /** Both of better-auth's two codes are the same rule and must not diverge. */
  it("treats the two codes as one rule", () => {
    expect(
      memberActionMessage("remove", {
        code: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER",
      }),
    ).toBe(
      memberActionMessage("remove", {
        code: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER",
      }),
    );
  });
});

describe("memberActionMessage — the recoverable refusals", () => {
  /**
   * The one refusal with a control attached. Retrying the invite cannot work —
   * the pending row and its Resend button are what the reader actually wants.
   */
  it("points an already-invited address at Resend instead of at retrying", () => {
    const message = memberActionMessage("invite", {
      code: "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION",
      status: 400,
    });

    expect(message).toContain("Resend");
    expect(message).not.toContain("Try again");
  });

  it("distinguishes an existing member from an existing invitation", () => {
    expect(
      memberActionMessage("invite", { code: "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION" }),
    ).not.toBe(
      memberActionMessage("invite", { code: "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION" }),
    );
  });

  /**
   * Reachable with no bug: the loader decided what to render when the page was
   * served, and a demotion in another tab makes that stale. So it explains
   * rather than accuses, and names the reload that fixes it.
   */
  it("explains a permission that has gone stale since the page loaded", () => {
    expect(
      memberActionMessage("changeRole", { code: "YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER" }),
    ).toContain("Reload the page");
  });

  it("reads a vanished member as a stale page, not as an error", () => {
    expect(memberActionMessage("remove", { code: "MEMBER_NOT_FOUND" })).toContain(
      "Reload the page",
    );
  });
});

/**
 * The rule both sibling modules record having got wrong once: an unrecognised
 * failure is **not** evidence about what the reader did, and a fallback that
 * claims otherwise sends them around a loop that cannot terminate.
 */
describe("memberActionMessage — the default", () => {
  it("does not claim to know what happened", () => {
    for (const action of ACTIONS) {
      const message = memberActionMessage(action, { code: "SOMETHING_NEW", status: 500 });

      expect(message).toContain("Try again");
      expect(message).not.toMatch(/permission|owner|already|limit/i);
    }
  });

  it("names the action that failed, so a toast is legible on its own", () => {
    expect(memberActionMessage("invite", {})).toContain("invitation");
    expect(memberActionMessage("leave", {})).toContain("leave the organization");
    expect(memberActionMessage("remove", {})).toContain("remove that person");
  });

  it("answers every action, with no empty string", () => {
    for (const action of ACTIONS) {
      expect(memberActionMessage(action, {}).length).toBeGreaterThan(0);
    }
  });
});
