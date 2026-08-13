import { describe, it, expect } from "vitest";
import { resetLinkState } from "../lib/reset-password-link";

/**
 * The deny paths are the point. A reset screen that renders its form on a
 * missing or refused token wastes the reader's time and then answers
 * `INVALID_TOKEN` from the server, which reads as "my new password was
 * rejected" rather than "this link has expired".
 */

const state = (query: string) => resetLinkState(new URLSearchParams(query));

describe("resetLinkState", () => {
  it("accepts the token better-auth redirects with", () => {
    expect(state("token=abc123")).toEqual({ kind: "ready", token: "abc123" });
  });

  it("refuses the INVALID_TOKEN redirect", () => {
    expect(state("error=INVALID_TOKEN")).toEqual({ kind: "invalid" });
  });

  it("refuses any error code, not just the one better-auth sends today", () => {
    expect(state("error=SOMETHING_NEW")).toEqual({ kind: "invalid" });
  });

  it("refuses a bare visit with no query at all", () => {
    expect(state("")).toEqual({ kind: "invalid" });
  });

  it("refuses a truncated link whose token is present but empty", () => {
    expect(state("token=")).toEqual({ kind: "invalid" });
  });

  it("refuses a whitespace-only token", () => {
    expect(state("token=%20%20")).toEqual({ kind: "invalid" });
  });

  /**
   * Fails closed. The pair is not something better-auth emits, so this pins
   * the direction the branch resolves in rather than a behaviour anyone
   * depends on — the alternative reading hands a form to someone whose token
   * has already been refused once.
   */
  it("refuses a token that arrives alongside an error", () => {
    expect(state("token=abc123&error=INVALID_TOKEN")).toEqual({ kind: "invalid" });
  });

  it("ignores an empty error, so it cannot mask a usable token", () => {
    expect(state("error=&token=abc123")).toEqual({ kind: "ready", token: "abc123" });
  });

  it("trims a token that picked up surrounding whitespace", () => {
    expect(state("token=%20abc123%20")).toEqual({ kind: "ready", token: "abc123" });
  });
});
