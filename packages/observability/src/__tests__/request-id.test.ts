import { describe, it, expect } from "vitest";
import { REQUEST_ID_HEADER, resolveRequestId } from "../request-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("resolveRequestId", () => {
  it("reuses a well-formed inbound x-request-id", () => {
    const headers = new Headers({ [REQUEST_ID_HEADER]: "abc-123" });
    expect(resolveRequestId(headers)).toBe("abc-123");
  });

  it("falls back to cf-ray", () => {
    const headers = new Headers({ "cf-ray": "8f1a2b3c4d5e6f70-LHR" });
    expect(resolveRequestId(headers)).toBe("8f1a2b3c4d5e6f70-LHR");
  });

  it("prefers x-request-id over cf-ray", () => {
    const headers = new Headers({ [REQUEST_ID_HEADER]: "mine", "cf-ray": "theirs" });
    expect(resolveRequestId(headers)).toBe("mine");
  });

  it("mints a uuid when no id is supplied", () => {
    expect(resolveRequestId(new Headers())).toMatch(UUID);
  });

  it("trims surrounding whitespace", () => {
    const headers = new Headers({ [REQUEST_ID_HEADER]: "  padded  " });
    expect(resolveRequestId(headers)).toBe("padded");
  });

  // Inbound ids are attacker-controlled: anything that could forge a field
  // separator downstream must be replaced, not sanitised in place.
  // (CRLF is not covered here — `Headers` rejects those values outright.)
  it.each([
    ["a space", "spaces"],
    ['x","level":"error', "json injection"],
    ["a\tb", "tab"],
    ["", "empty"],
    ["   ", "whitespace only"],
  ])("replaces a hostile id (%s — %s)", (value) => {
    const headers = new Headers({ [REQUEST_ID_HEADER]: value });
    expect(resolveRequestId(headers)).toMatch(UUID);
  });

  it("caps an over-long id at the length limit", () => {
    const headers = new Headers({ [REQUEST_ID_HEADER]: `${"a".repeat(128)} tail` });
    expect(resolveRequestId(headers)).toMatch(/^a{128}$/);
  });
});
