import { describe, it, expect } from "vitest";

import { repoLinks } from "../components/landing/repo";

/**
 * What the landing page builds from a repository URL.
 *
 * The rule for *which* URLs are acceptable lives in `@starter/config/repo-url`
 * and is tested there, once, because `init:product` enforces the same one — so
 * this covers the linking behaviour rather than re-listing every rejected
 * scheme. The rendered consequences are in `landing-render.test.ts`.
 */
describe("repoLinks", () => {
  it("returns null when the product declares no repository", () => {
    expect(repoLinks("")).toBeNull();
  });

  it("builds both affordances from the canonical URL", () => {
    expect(repoLinks("https://github.com/acme/acme-cloud")).toEqual({
      url: "https://github.com/acme/acme-cloud",
      cloneCommand: "git clone https://github.com/acme/acme-cloud my-app",
    });
  });

  it("links the canonical form, not the string it was given", () => {
    // `https:example.com/a` parses but is not what belongs in an href.
    expect(repoLinks("https:example.com/a")?.url).toBe("https://example.com/a");
    expect(repoLinks(" https://github.com/acme/acme\n")?.cloneCommand).toBe(
      "git clone https://github.com/acme/acme my-app",
    );
  });

  it("declines a URL the shared rule rejects, rather than rendering it", () => {
    for (const url of [
      "javascript:alert(1)",
      "https://user:token@github.com/acme/acme",
      "https://github.com/acme/$(whoami)",
    ]) {
      expect(repoLinks(url)).toBeNull();
    }
  });

  /**
   * The clone command is interpolated unquoted, and this is what makes that
   * safe rather than lucky: nothing that survives `repoLinks` carries shell
   * meaning, so the command a visitor copies is the command they run.
   */
  it("never produces a command needing shell quoting", () => {
    const commands = [
      "https://github.com/acme/acme",
      "http://git.internal:9000/team/repo.git",
      "https://h.dev/a b",
      "https://h.dev/a`b",
    ]
      .map((u) => repoLinks(u)?.cloneCommand)
      .filter((c): c is string => c !== undefined);

    expect(commands.length).toBe(4);
    for (const command of commands) {
      expect(command).toMatch(/^git clone \S+ my-app$/);
      expect(command).not.toMatch(/["'`$&;|<>(){}[\]*?!#\\]/);
    }
  });
});
