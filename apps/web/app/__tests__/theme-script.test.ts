import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { THEME_SCRIPT, THEME_SCRIPT_CSP_HASH } from "../lib/theme-script";

/**
 * The theme script is admitted by CSP hash, so the hash and the script must
 * agree exactly — including the leading and trailing newlines of the template
 * literal. Editing one without the other blocks the script, and a blocked theme
 * script does not throw: it paints the wrong theme, which no status assertion
 * would catch. This test is the guard.
 */
describe("theme script CSP hash", () => {
  it("matches the script it admits", () => {
    const expected = `sha256-${createHash("sha256").update(THEME_SCRIPT, "utf8").digest("base64")}`;

    expect(
      THEME_SCRIPT_CSP_HASH,
      `THEME_SCRIPT changed. Set THEME_SCRIPT_CSP_HASH in app/lib/theme-script.ts to:\n  ${expected}`,
    ).toBe(expected);
  });

  it("is a sha256 source expression CSP will accept", () => {
    expect(THEME_SCRIPT_CSP_HASH).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/);
  });

  // Guards the thing that makes the script worth inlining at all.
  it("still applies the theme before paint", () => {
    expect(THEME_SCRIPT).toContain("document.documentElement.classList.add");
    expect(THEME_SCRIPT).toContain("prefers-color-scheme: dark");
  });
});
