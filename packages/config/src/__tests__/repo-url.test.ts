import { describe, it, expect } from "vitest";

import { canonicalRepoUrl } from "../repo-url";

describe("canonicalRepoUrl", () => {
  it.each([
    "https://github.com/acme/acme-cloud",
    "http://git.internal/acme",
    "https://git.example.com:8443/acme/repo",
    "https://github.com/acme/repo.git",
  ])("accepts %s unchanged", (url) => {
    expect(canonicalRepoUrl(url)).toBe(url);
  });

  it.each([
    ["", null],
    ["   ", null],
    ["not a url", null],
    ["github.com/acme/acme", null],
    ["javascript:alert(1)", null],
    ["data:text/html,<script>alert(1)</script>", null],
    ["file:///etc/passwd", null],
    ["ftp://example.com/acme", null],
  ])("rejects %j", (value) => {
    expect(canonicalRepoUrl(value)).toBeNull();
  });

  /**
   * Validating with `new URL()` and keeping the input is the bug this function
   * exists to prevent. Every one of these parses, so a boolean check accepts
   * them and stores something that renders wrong or round-trips wrong.
   */
  describe("returns the canonical form, not the input", () => {
    it.each([
      ["https:example.com/a", "https://example.com/a"],
      ["https://github.com/acme/acme\n", "https://github.com/acme/acme"],
      ["\thttps://github.com/acme/acme ", "https://github.com/acme/acme"],
      // The URL parser strips C0-or-space itself; a non-breaking space is
      // neither, so without the explicit trim this is a parse error. It is what
      // a URL copied out of a rendered page routinely arrives wrapped in.
      ["\u00A0https://github.com/acme/acme\u00A0", "https://github.com/acme/acme"],
      ["https://github.com", "https://github.com/"],
      ["HTTPS://GitHub.com/acme", "https://github.com/acme"],
    ])("%j -> %j", (input, expected) => {
      expect(canonicalRepoUrl(input)).toBe(expected);
    });
  });

  /**
   * Credentials are the case normalisation cannot help with: the URL is
   * *already* its own href, so only an explicit refusal keeps a token out of an
   * anchor on the landing page and out of a command the reader is told to copy.
   */
  it.each([
    "https://user:token@github.com/acme/acme",
    "https://token@github.com/acme/acme",
    "https://:token@github.com/acme/acme",
  ])("refuses %j rather than publishing the credential", (url) => {
    expect(canonicalRepoUrl(url)).toBeNull();
  });

  /**
   * The clone command is interpolated unquoted, so the accepted set must
   * contain nothing a shell would act on. Two mechanisms share that job, and
   * the split is the whole reason normalisation alone is not the answer.
   *
   * First: `href` encodes some of them itself, and the result is safe to keep.
   */
  it.each([
    ["space", "https://h.dev/a b", "https://h.dev/a%20b"],
    ["backtick", "https://h.dev/a`b", "https://h.dev/a%60b"],
    ["braces", "https://h.dev/a{b}", "https://h.dev/a%7Bb%7D"],
    ["a quote", 'https://h.dev/a"b', "https://h.dev/a%22b"],
  ])("percent-encodes %s and keeps the URL", (_label, url, expected) => {
    expect(canonicalRepoUrl(url)).toBe(expected);
  });

  /**
   * Second: these survive `href` untouched, so only the allowlist stops them.
   * This is the group a normalise-only fix would have missed entirely.
   */
  it.each([
    ["$", "https://h.dev/a/$(whoami)"],
    ["&", "https://h.dev/a&b"],
    [";", "https://h.dev/a;rm"],
    ["|", "https://h.dev/a|b"],
    ["*", "https://h.dev/a*"],
    ["(", "https://h.dev/a(b)"],
    ["!", "https://h.dev/a!b"],
    ["[", "https://h.dev/a[b]"],
    ["~", "https://h.dev/~a"],
    ["query", "https://h.dev/a?x=1&y=2"],
    ["fragment", "https://h.dev/a#frag"],
  ])("refuses a URL carrying %s, which href normalisation leaves alone", (_label, url) => {
    expect(canonicalRepoUrl(url)).toBeNull();
  });

  // The property the two callers actually depend on, stated once.
  it("never returns a string needing shell quoting", () => {
    const accepted = [
      "https://github.com/acme/acme",
      "http://git.internal:9000/team/repo.git",
      "https://h.dev/a%20b",
      "https://h.dev/a+b,c@d",
    ]
      .map(canonicalRepoUrl)
      .filter((v): v is string => v !== null);

    expect(accepted.length).toBeGreaterThan(0);
    for (const url of accepted) {
      expect(url).not.toMatch(/[\s"'`$&;|<>(){}[\]*?!#\\]/);
    }
  });
});
