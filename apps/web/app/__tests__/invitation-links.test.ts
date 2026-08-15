import { describe, it, expect } from "vitest";
import {
  INVITATION_ACCEPT_PATH,
  INVITATION_PARAM,
  invitationAcceptPath,
  invitationAuthPath,
} from "~/lib/auth-redirects";

/**
 * The round-trip an invitee takes when they arrive signed out.
 *
 * Deliberately **not** a general `redirectTo`: these carry an id, and the only
 * path either can produce is one this module owns. That is what makes the
 * open-redirect question moot rather than answered — there is no caller-supplied
 * destination to validate. The tests below are what keep it that way.
 */
describe("invitationAcceptPath", () => {
  it("should build the accept path from the shared constant", () => {
    expect(invitationAcceptPath("inv_1")).toBe(`${INVITATION_ACCEPT_PATH}?id=inv_1`);
  });

  it("should stay relative, so it works on localhost and in a split deployment alike", () => {
    expect(invitationAcceptPath("inv_1").startsWith("/")).toBe(true);
    expect(invitationAcceptPath("inv_1").startsWith("//")).toBe(false);
  });

  /**
   * The id reaches these functions straight off a query string the reader
   * controls. A raw `&` would truncate the parameter and a raw `/` would not,
   * but neither can change the *path* — encoding keeps the id an id.
   */
  it("should encode an id that would otherwise add parameters", () => {
    expect(invitationAcceptPath("a&b=c")).toBe(`${INVITATION_ACCEPT_PATH}?id=a%26b%3Dc`);
  });
});

describe("invitationAuthPath", () => {
  it.each(["/login", "/register"] as const)("should carry the invitation to %s", (page) => {
    expect(invitationAuthPath(page, "inv_1")).toBe(`${page}?${INVITATION_PARAM}=inv_1`);
  });

  /**
   * The deny path for the shape that was chosen over a generic `redirectTo`.
   * Whatever the id contains, the result is still a path on this origin — a
   * value that would be an open redirect in the general design cannot leave the
   * query string here.
   */
  it.each([
    "//evil.example.com",
    "https://evil.example.com",
    "/\\evil.example.com",
    "?next=https://evil.example.com",
  ])("should keep %s inside the query string rather than changing the destination", (hostile) => {
    const path = invitationAuthPath("/login", hostile);

    expect(path.startsWith(`/login?${INVITATION_PARAM}=`)).toBe(true);
    expect(new URL(path, "https://app.test").origin).toBe("https://app.test");
    expect(new URL(path, "https://app.test").pathname).toBe("/login");
  });
});
