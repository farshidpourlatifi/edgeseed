import { describe, it, expect } from "vitest";
import { parseSpecArgs, specState } from "../lib/api-spec";

describe("parseSpecArgs", () => {
  it("should select write mode with no arguments", () => {
    expect(parseSpecArgs([])).toEqual({ ok: true, check: false });
  });

  it("should select check mode for --check", () => {
    expect(parseSpecArgs(["--check"])).toEqual({ ok: true, check: true });
  });

  /** A typo must not fall through to write mode: that would rewrite the file it was asked to check. */
  it.each([
    [["--chekc"], "--chekc"],
    [["--check", "extra"], "extra"],
    [["extra", "--check"], "extra"],
    [["--check", "--check"], "--check"],
  ])("should refuse %j and name the offending argument", (argv, offending) => {
    const result = parseSpecArgs(argv);

    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("error", expect.stringContaining(offending));
  });

  it("should say a repeated --check was given twice", () => {
    expect(parseSpecArgs(["--check", "--check"])).toEqual({
      ok: false,
      error: "--check was given twice",
    });
  });
});

describe("specState", () => {
  it("should report equal strings as current", () => {
    expect(specState('{"a":1}', '{"a":1}')).toBe("current");
  });

  it("should report a one-byte difference as stale", () => {
    expect(specState('{"a":1}', '{"a":2}')).toBe("stale");
  });

  it("should report a trailing newline alone as stale", () => {
    expect(specState('{"a":1}', '{"a":1}\n')).toBe("stale");
  });

  it("should report an absent file as missing", () => {
    expect(specState('{"a":1}', null)).toBe("missing");
  });
});
