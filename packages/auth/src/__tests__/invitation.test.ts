import { describe, it, expect } from "vitest";
import {
  INVITATION_ACCEPT_PATH,
  INVITATION_EXPIRES_IN_DAYS,
  INVITATION_EXPIRES_IN_SECONDS,
  INVITATION_ID_PARAM,
  invitationAcceptUrl,
} from "../invitation";

/**
 * The one leg of the invitation flow no e2e can reach.
 *
 * The emailed link only ever reaches the dev server's log, so nothing driving a
 * browser can prove it points at the right origin — the same blind spot
 * `POST_VERIFICATION_REDIRECT` has, and the reason both are constants rather
 * than literals at their call sites.
 */
describe("invitationAcceptUrl", () => {
  const APP = "https://app.example.com";

  it("should resolve against the app origin, not a relative path", () => {
    expect(invitationAcceptUrl(APP, "inv_123")).toBe(
      "https://app.example.com/accept-invitation?id=inv_123",
    );
  });

  it("should build from the exported path and parameter so a rename cannot half-land", () => {
    const url = new URL(invitationAcceptUrl(APP, "inv_123"));

    expect(url.pathname).toBe(INVITATION_ACCEPT_PATH);
    expect(url.searchParams.get(INVITATION_ID_PARAM)).toBe("inv_123");
  });

  /**
   * The deny path for the split-origin trap this constant exists for. A reader
   * opening their mail on the marketing host must still be sent to the app
   * origin, which only holds while the URL is absolute — a relative one would
   * resolve against whatever host the mail client happened to be on.
   */
  it("should ignore the marketing origin entirely and keep the app one", () => {
    expect(invitationAcceptUrl("https://marketing.example.com", "inv_1")).not.toContain("app.");
    expect(new URL(invitationAcceptUrl(APP, "inv_1")).origin).toBe(APP);
  });

  it("should replace a path on the base url rather than nesting under it", () => {
    // `BETTER_AUTH_URL` is an origin, but a trailing path is a plausible typo
    // and must not produce `/some/prefix/accept-invitation`, which routes to the
    // branded 404 with nothing to say why.
    expect(invitationAcceptUrl("https://app.example.com/some/prefix", "inv_1")).toBe(
      "https://app.example.com/accept-invitation?id=inv_1",
    );
  });

  it("should encode an id that would otherwise break out of the query parameter", () => {
    const url = new URL(invitationAcceptUrl(APP, "a&b=c"));

    expect(url.searchParams.get(INVITATION_ID_PARAM)).toBe("a&b=c");
    expect(url.searchParams.get("b")).toBeNull();
  });
});

describe("invitation expiry", () => {
  it("should be seven days, not better-auth's 48 hours", () => {
    expect(INVITATION_EXPIRES_IN_SECONDS).toBe(604_800);
    expect(INVITATION_EXPIRES_IN_SECONDS).not.toBe(3600 * 48);
  });

  /**
   * The email says "seven days" by reading this. Restating the number in the
   * copy is what would let the sentence drift away from what the server
   * enforces, so the derivation is the thing worth asserting.
   */
  it("should express the same window in days for the email copy", () => {
    expect(INVITATION_EXPIRES_IN_DAYS).toBe(7);
    expect(INVITATION_EXPIRES_IN_DAYS * 24 * 60 * 60).toBe(INVITATION_EXPIRES_IN_SECONDS);
  });
});
