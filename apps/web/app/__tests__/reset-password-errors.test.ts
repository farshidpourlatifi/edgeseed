import { describe, it, expect } from "vitest";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  resetErrorMessage,
} from "../lib/reset-password-errors";

/**
 * The bug this guards is a wrong *sentence*, not a wrong status: answering a
 * rejected password with "your link is dead" sends the reader to fetch a new
 * link, paste the same password, and land here again. Codes verified against a
 * running dev server, not read off the types.
 */

const DEAD_LINK = /no longer valid/;

describe("resetErrorMessage", () => {
  it("tells a reader with a dead token to request a new link", () => {
    expect(resetErrorMessage({ code: "INVALID_TOKEN", status: 400 })).toMatch(DEAD_LINK);
  });

  it("does not blame the link when the password is too long", () => {
    const message = resetErrorMessage({ code: "PASSWORD_TOO_LONG", status: 400 });

    expect(message).not.toMatch(DEAD_LINK);
    expect(message).toContain(`no more than ${MAX_PASSWORD_LENGTH}`);
  });

  /**
   * The bound is matched with its preposition, not as a bare number: `"128"`
   * contains `"8"`, so a looser assertion here passed even when this case fell
   * through and returned the *too-long* sentence. A surviving mutant caught it.
   */
  it("does not blame the link when the password is too short", () => {
    const message = resetErrorMessage({ code: "PASSWORD_TOO_SHORT", status: 400 });

    expect(message).not.toMatch(DEAD_LINK);
    expect(message).toContain(`at least ${MIN_PASSWORD_LENGTH}`);
  });

  it("reports throttling as throttling", () => {
    expect(resetErrorMessage({ code: "INVALID_TOKEN", status: 429 })).toMatch(/Too many/);
  });

  /**
   * 429 wins over the code because better-auth's limiter answers before the
   * handler runs, so whatever `code` rides along describes nothing that was
   * evaluated.
   */
  it("prefers the throttle message over any code", () => {
    expect(resetErrorMessage({ code: "PASSWORD_TOO_SHORT", status: 429 })).toMatch(/Too many/);
  });

  /**
   * The important default. An unrecognised failure is not evidence the token
   * is bad, and saying so is the original defect in miniature.
   */
  it("does not blame the link for a failure it does not recognise", () => {
    expect(resetErrorMessage({ code: "SOMETHING_NEW", status: 500 })).not.toMatch(DEAD_LINK);
    expect(resetErrorMessage({})).not.toMatch(DEAD_LINK);
  });

  it("always says something", () => {
    for (const error of [{}, { status: 429 }, { code: "INVALID_TOKEN" }, { code: "" }]) {
      expect(resetErrorMessage(error).length).toBeGreaterThan(0);
    }
  });
});
