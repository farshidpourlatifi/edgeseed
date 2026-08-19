import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  currentProductDemoVideo,
  currentProductRepo,
  currentProductSlug,
  deriveDisplayName,
  isValidProductSlug,
  isValidRepoUrl,
  parseInitArgs,
  redactForMessage,
  UNVERIFIABLE_VALUE,
  stampProductDemoVideo,
  stampProductIdentity,
  stampProductRepo,
  stampWranglerConfig,
} from "../lib/init-product";

describe("currentProductSlug", () => {
  it("reads the slug the script will rename from", () => {
    const source = [
      'export const PRODUCT_NAME = "EdgeSeed";',
      'export const PRODUCT_SLUG = "edgeseed";',
    ].join("\n");
    expect(currentProductSlug(source)).toBe("edgeseed");
  });

  it("reads a slug a clone has already stamped", () => {
    expect(currentProductSlug('export const PRODUCT_SLUG = "acme-cloud";')).toBe("acme-cloud");
  });

  it("returns null when the declaration is missing", () => {
    expect(currentProductSlug('export const PRODUCT_NAME = "EdgeSeed";')).toBeNull();
  });

  it("returns null when the declaration has been reformatted", () => {
    // The script exits rather than writing a broken repo — silently matching
    // nothing here is what would turn every later rewrite into a no-op.
    expect(currentProductSlug("export const PRODUCT_SLUG = 'edgeseed';")).toBeNull();
  });

  it("round-trips with stampProductIdentity", () => {
    const stamped = stampProductIdentity('export const PRODUCT_SLUG = "edgeseed";', {
      slug: "acme",
      displayName: "Acme",
    });
    expect(currentProductSlug(stamped)).toBe("acme");
  });
});

describe("isValidProductSlug", () => {
  it.each(["acme", "acme-cloud", "a1", "x-9-y"])("accepts %s", (slug) => {
    expect(isValidProductSlug(slug)).toBe(true);
  });

  it.each(["", "Acme", "1acme", "-acme", "acme_cloud", "acme cloud", "acme."])(
    "rejects %s",
    (slug) => {
      expect(isValidProductSlug(slug)).toBe(false);
    },
  );
});

describe("deriveDisplayName", () => {
  it("title-cases each hyphenated word", () => {
    expect(deriveDisplayName("my-product")).toBe("My Product");
    expect(deriveDisplayName("acme")).toBe("Acme");
  });

  it("does not lowercase the rest of a word", () => {
    expect(deriveDisplayName("acme-iot")).toBe("Acme Iot");
  });
});

describe("stampProductIdentity", () => {
  // Synthetic, for the same reason as the wrangler fixtures below: a clone that
  // has run `init:product` no longer has "Starter" in this file.
  const source = [
    'export const PRODUCT_NAME = "Starter";',
    'export const PRODUCT_SLUG = "starter";',
    "export const MCP_SERVER_NAME = `${PRODUCT_NAME} MCP`;",
  ].join("\n");

  it("rewrites both constants", () => {
    const out = stampProductIdentity(source, { slug: "acme", displayName: "Acme Cloud" });

    expect(out).toContain('export const PRODUCT_NAME = "Acme Cloud"');
    expect(out).toContain('export const PRODUCT_SLUG = "acme"');
    expect(out).not.toContain('PRODUCT_NAME = "Starter"');
  });

  // A brand name with a quote would otherwise produce a file that does not parse.
  it.each([
    ['Acme "Cloud"', 'Acme \\"Cloud\\"'],
    ["Acme\\Cloud", "Acme\\\\Cloud"],
    ["Acme\nCloud", "Acme\\nCloud"],
  ])("escapes %j into a valid TS literal", (displayName, expectedFragment) => {
    const out = stampProductIdentity(source, { slug: "acme", displayName });

    expect(out).toContain(expectedFragment);
    // The rewritten line must still be a single, well-formed literal.
    const line = out.split("\n").find((l) => l.startsWith("export const PRODUCT_NAME"));
    expect(line).toBe(`export const PRODUCT_NAME = ${JSON.stringify(displayName)};`);
  });

  // `$&`, `$1`, "$`" are special in a String.replace *replacement string* — using
  // a replacement function is what keeps them literal.
  it.each(["Acme $& Co", "Acme $1 Co", "Acme $` Co", "Acme $$ Co"])(
    "keeps regex replacement patterns literal: %s",
    (displayName) => {
      const out = stampProductIdentity(source, { slug: "acme", displayName });

      expect(out).toContain(`export const PRODUCT_NAME = ${JSON.stringify(displayName)}`);
    },
  );

  it("round-trips through JSON.parse for any of these names", () => {
    for (const displayName of ['A "B"', "A\\B", "A\nB", "A $& B"]) {
      const out = stampProductIdentity(source, { slug: "acme", displayName });
      const literal = out
        .split("\n")
        .find((l) => l.startsWith("export const PRODUCT_NAME"))!
        .replace(/^export const PRODUCT_NAME = /, "")
        .replace(/;$/, "");

      expect(JSON.parse(literal)).toBe(displayName);
    }
  });
});

describe("isValidRepoUrl", () => {
  it.each(["https://github.com/acme/acme", "http://git.internal/acme", "https://gitlab.com/a/b"])(
    "accepts %s",
    (url) => {
      expect(isValidRepoUrl(url)).toBe(true);
    },
  );

  // The value reaches an href and a copy-to-clipboard command on the landing
  // page, so a non-http(s) scheme is a scripted link on the most-visited page
  // the product has.
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "ftp://example.com/acme",
    "github.com/acme/acme",
    "not a url",
    "",
  ])("refuses %j", (url) => {
    expect(isValidRepoUrl(url)).toBe(false);
  });
});

describe("currentProductRepo", () => {
  it("reads the URL the script will verify against", () => {
    expect(
      currentProductRepo('export const PRODUCT_REPO_URL = "https://github.com/acme/acme";'),
    ).toBe("https://github.com/acme/acme");
  });

  it("reads the empty default a clone is left with", () => {
    expect(currentProductRepo('export const PRODUCT_REPO_URL = "";')).toBe("");
  });

  it("returns null when the declaration is missing", () => {
    expect(currentProductRepo('export const PRODUCT_SLUG = "acme";')).toBeNull();
  });

  // Distinguishing "" from null is what lets the script tell a successful clear
  // from a rewrite that silently matched nothing.
  it("returns null rather than empty when the declaration is reformatted", () => {
    expect(currentProductRepo("export const PRODUCT_REPO_URL = '';")).toBeNull();
  });
});

describe("stampProductRepo", () => {
  const source = 'export const PRODUCT_REPO_URL = "https://github.com/upstream/starter";';

  it("clears the upstream URL when no repo is given", () => {
    const out = stampProductRepo(source, "");

    expect(out).toBe('export const PRODUCT_REPO_URL = "";');
    expect(out).not.toContain("upstream/starter");
  });

  it("stamps the product's own repository", () => {
    expect(stampProductRepo(source, "https://github.com/acme/acme-cloud")).toBe(
      'export const PRODUCT_REPO_URL = "https://github.com/acme/acme-cloud";',
    );
  });

  it("round-trips with currentProductRepo", () => {
    for (const url of ["", "https://github.com/acme/acme"]) {
      expect(currentProductRepo(stampProductRepo(source, url))).toBe(url);
    }
  });

  // Same hazard as the display name: `$&` in a replacement *string* would splice
  // the whole match back in. A URL can carry one in a query or fragment.
  it("keeps regex replacement patterns literal", () => {
    const url = "https://git.example.com/acme?ref=$&";

    expect(stampProductRepo(source, url)).toBe(
      `export const PRODUCT_REPO_URL = ${JSON.stringify(url)};`,
    );
  });

  it("composes with stampProductIdentity without either undoing the other", () => {
    const product = [
      'export const PRODUCT_NAME = "Starter";',
      'export const PRODUCT_SLUG = "starter";',
      'export const PRODUCT_REPO_URL = "https://github.com/upstream/starter";',
    ].join("\n");

    const out = stampProductRepo(
      stampProductIdentity(product, { slug: "acme", displayName: "Acme" }),
      "",
    );

    expect(currentProductSlug(out)).toBe("acme");
    expect(currentProductRepo(out)).toBe("");
  });
});

describe("currentProductDemoVideo", () => {
  it("reads the path the script will verify against", () => {
    expect(currentProductDemoVideo('export const PRODUCT_DEMO_VIDEO = "/demo.mp4";')).toBe(
      "/demo.mp4",
    );
  });

  it("reads the empty default a clone is left with", () => {
    expect(currentProductDemoVideo('export const PRODUCT_DEMO_VIDEO = "";')).toBe("");
  });

  it("returns null when the declaration is missing", () => {
    expect(currentProductDemoVideo('export const PRODUCT_SLUG = "acme";')).toBeNull();
  });

  // Distinguishing "" from null is what lets the script tell a successful clear
  // from a rewrite that silently matched nothing — the check that keeps the
  // starter's branded film off a clone's landing page.
  it("returns null rather than empty when the declaration is reformatted", () => {
    expect(currentProductDemoVideo("export const PRODUCT_DEMO_VIDEO = '';")).toBeNull();
  });
});

describe("stampProductDemoVideo", () => {
  const source = 'export const PRODUCT_DEMO_VIDEO = "/demo.mp4";';

  it("clears the starter's film so a clone ships no section", () => {
    const out = stampProductDemoVideo(source);

    expect(out).toBe('export const PRODUCT_DEMO_VIDEO = "";');
    expect(out).not.toContain("/demo.mp4");
  });

  it("is idempotent on an already-cleared declaration", () => {
    const cleared = 'export const PRODUCT_DEMO_VIDEO = "";';
    expect(stampProductDemoVideo(cleared)).toBe(cleared);
  });

  it("round-trips to empty through currentProductDemoVideo", () => {
    expect(currentProductDemoVideo(stampProductDemoVideo(source))).toBe("");
  });

  it("composes with the identity and repo stamps without either undoing another", () => {
    const product = [
      'export const PRODUCT_NAME = "Starter";',
      'export const PRODUCT_SLUG = "starter";',
      'export const PRODUCT_REPO_URL = "https://github.com/upstream/starter";',
      'export const PRODUCT_DEMO_VIDEO = "/demo.mp4";',
    ].join("\n");

    const out = stampProductDemoVideo(
      stampProductRepo(stampProductIdentity(product, { slug: "acme", displayName: "Acme" }), ""),
    );

    expect(currentProductSlug(out)).toBe("acme");
    expect(currentProductRepo(out)).toBe("");
    expect(currentProductDemoVideo(out)).toBe("");
  });
});

describe("redactForMessage", () => {
  // The leak this exists to stop: parseInitArgs quotes the rejected value, and
  // init-product.ts prints that to stderr, where CI keeps it.
  it.each([
    "https://oauth2:ghp_realtokenvalue@github.com/acme/acme",
    "https://ghp_realtokenvalue@github.com/acme/acme",
    "https://:ghp_realtokenvalue@github.com/acme/acme",
  ])("strips the credential out of %j", (url) => {
    const out = redactForMessage(url);

    expect(out).not.toContain("ghp_realtokenvalue");
    expect(out).toContain("***@github.com/acme/acme");
  });

  it("redacts before truncating, so a long credential cannot survive the cut", () => {
    const out = redactForMessage(`https://user:${"t".repeat(400)}@github.com/acme`);

    expect(out).not.toContain("tttt");
    expect(out.length).toBeLessThanOrEqual(121);
  });

  /**
   * A URL parser splits the authority on its **last** `@`, so redaction has to
   * as well. `https://user:tok@en@github.com/a` has the password `tok@en`;
   * stopping at the first `@` printed `https://***@en@github.com/a` and leaked
   * its tail.
   */
  it.each([
    ["https://user:tok@en@github.com/acme", "https://***@github.com/acme"],
    ["https://a@b@c@github.com/x", "https://***@github.com/x"],
    ["https://user:p@ss@w@rd@github.com/x", "https://***@github.com/x"],
  ])("redacts %j through the authority's last @", (url, expected) => {
    expect(redactForMessage(url)).toBe(expected);
  });

  it("leaks no fragment of a multi-@ password", () => {
    const out = redactForMessage("https://user:tok@en@github.com/acme");

    expect(out).not.toContain("tok");
    expect(out).not.toContain("@en");
    // The host survives, or the message stops being useful.
    expect(out).toContain("github.com/acme");
  });

  // Scheme and `//` are both optional, so a credential typed without either is
  // still caught — the shape someone reaches for when they forget the scheme.
  it.each([
    ["ghp_realtokenvalue@github.com/acme", "***@github.com/acme"],
    ["user:ghp_realtokenvalue@github.com/acme", "user:***@github.com/acme"],
  ])("redacts the schemeless %j", (value, expected) => {
    const out = redactForMessage(value);

    expect(out).toBe(expected);
    expect(out).not.toContain("ghp_realtokenvalue");
  });

  it.each([
    "https://github.com/acme/a@b",
    "https://github.com/acme?x=a@b",
    "https://github.com/acme#a@b",
  ])("leaves an @ outside the authority alone: %j", (url) => {
    expect(redactForMessage(url)).toBe(url);
  });

  it("leaves an @ that is not userinfo alone", () => {
    expect(redactForMessage("https://github.com/acme/a@b")).toBe("https://github.com/acme/a@b");
  });

  /**
   * Malformed credentials, which the authority-bounded pattern cannot reach.
   *
   * An unencoded `/` in the password ends the authority before the `@`, so the
   * pattern never matches — and the value does not parse either, so nothing
   * establishes the tail is not a secret. Base64-shaped tokens contain `/`.
   */
  it.each([
    "https://user:tok/en@github.com/acme",
    "https://user:abc/def+ghi@host/repo",
    "https://user:tok?x@github.com/acme",
    "https://user:tok#x@github.com/acme",
  ])("refuses to echo %j at all", (value) => {
    expect(redactForMessage(value)).toBe(UNVERIFIABLE_VALUE);
  });

  /**
   * A leading space stops the anchored pattern firing, yet the URL still parses
   * *with* credentials — so the userinfo check, not the pattern, is what keeps
   * the token out of the message here.
   */
  it("refuses a credential the anchored pattern cannot reach", () => {
    const out = redactForMessage(" https://user:ghp_realtokenvalue@github.com/a");

    expect(out).toBe(UNVERIFIABLE_VALUE);
    expect(out).not.toContain("ghp_realtokenvalue");
  });

  // The other side of that: trimming is what lets a benign wrapped URL still
  // parse, so it is echoed rather than needlessly reduced to the placeholder.
  // Non-breaking space specifically — `new URL` strips a plain leading space
  // itself, so only this shape actually exercises the trim.
  it("still echoes a harmless @ on a value wrapped in non-breaking spaces", () => {
    const out = redactForMessage("\u00A0https://github.com/acme/a@b\u00A0");

    expect(out).not.toBe(UNVERIFIABLE_VALUE);
    expect(out).toContain("github.com/acme/a@b");
  });

  /**
   * Userinfo with only one half present. Both leak if the check asks for
   * *either* field to be empty rather than both — and a password-only URL
   * (`https://:token@host`) is exactly how a token-in-URL is usually written.
   */
  it.each([
    " https://:ghp_realtokenvalue@github.com/a",
    " https://ghp_realtokenvalue@github.com/a",
  ])("refuses %j, which carries only one half of a credential", (value) => {
    const out = redactForMessage(value);

    expect(out).toBe(UNVERIFIABLE_VALUE);
    expect(out).not.toContain("ghp_realtokenvalue");
  });

  it("names what it withheld, so the reader knows why", () => {
    expect(UNVERIFIABLE_VALUE).toContain("redacted");
    expect(UNVERIFIABLE_VALUE.length).toBeGreaterThan(0);
  });

  it("leaks no part of a malformed credential", () => {
    expect(redactForMessage("https://user:ghp_realtokenvalue/x@github.com/a")).not.toContain(
      "ghp_realtokenvalue",
    );
  });

  // The four branches, so none of them is unreachable: redaction fired; no `@`
  // at all; an `@` proven harmless by parsing; and everything else.
  it.each([
    ["redaction fired", "https://u:p@h/r", "https://***@h/r"],
    ["no @ at all", "htps://github.com/acme", "htps://github.com/acme"],
    ["@ proven to be a path", "https://github.com/acme/a@b", "https://github.com/acme/a@b"],
    ["unverifiable", "https://u:p/q@h/r", UNVERIFIABLE_VALUE],
  ])("%s: %j", (_label, value, expected) => {
    expect(redactForMessage(value)).toBe(expected);
  });

  it("keeps an ordinary rejected value readable, since that is the point", () => {
    expect(redactForMessage("htps://github.com/acme")).toBe("htps://github.com/acme");
  });

  // An argument is arbitrary bytes. ANSI escapes echoed to a terminal can
  // rewrite what the reader sees, including hiding the rest of the message.
  it("replaces control characters rather than emitting them", () => {
    const out = redactForMessage("https://h.dev/\u001B[2J\u001B[1;31mFAKE\u0007");

    // eslint-disable-next-line no-control-regex -- asserting their absence
    expect(out).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
    expect(out).toContain("\uFFFD");
  });

  it("truncates a value pasted by mistake", () => {
    const out = redactForMessage("https://h.dev/" + "a".repeat(500));

    expect(out.length).toBe(121);
    expect(out.endsWith("\u2026")).toBe(true);
  });

  it("passes a value at the limit through untouched", () => {
    const exact = "h".repeat(120);
    expect(redactForMessage(exact)).toBe(exact);
  });
});

describe("parseInitArgs", () => {
  const ok = (argv: string[]) => {
    const parsed = parseInitArgs(argv);
    if (!parsed.ok) throw new Error(`expected success, got: ${parsed.error}`);
    return parsed.args;
  };

  it("derives the display name and defaults the repo to empty", () => {
    expect(ok(["acme"])).toEqual({ slug: "acme", displayName: "Acme", repoUrl: "" });
  });

  it("takes an explicit display name", () => {
    expect(ok(["acme", "Acme Cloud"]).displayName).toBe("Acme Cloud");
  });

  it.each([
    [["acme", "--repo", "https://github.com/acme/acme"]],
    [["acme", "--repo=https://github.com/acme/acme"]],
    [["--repo", "https://github.com/acme/acme", "acme"]],
  ])("reads --repo from %j wherever it sits", (argv) => {
    expect(ok(argv)).toEqual({
      slug: "acme",
      displayName: "Acme",
      repoUrl: "https://github.com/acme/acme",
    });
  });

  // The reason flags are extracted before positionals are read: `argv[1]` here
  // is the literal string "--repo", which a positional read stamps into
  // PRODUCT_NAME as the product's display name.
  it("does not mistake a flag for the display name", () => {
    expect(ok(["acme", "--repo", "https://github.com/acme/acme"]).displayName).toBe("Acme");
  });

  it("keeps a display name that follows the flag's value", () => {
    expect(ok(["acme", "--repo=https://github.com/acme/acme", "Acme Cloud"]).displayName).toBe(
      "Acme Cloud",
    );
  });

  /**
   * What is stamped is the canonical URL, never the string typed at the prompt.
   *
   * Both of these *parse*, so a check that validated and then kept the input
   * accepted them. The first renders as a broken link; the second is worse —
   * `JSON.stringify` escapes the newline, the read-back regex then sees two
   * characters where one was written, and the script exits on its own stamp
   * check having already rewritten package.json.
   */
  it.each([
    ["https:example.com/a", "https://example.com/a"],
    ["https://github.com/acme/acme\n", "https://github.com/acme/acme"],
    ["  https://github.com/acme/acme  ", "https://github.com/acme/acme"],
    ["https://github.com", "https://github.com/"],
  ])("canonicalises %j to %j before stamping", (input, expected) => {
    expect(ok(["acme", "--repo", input]).repoUrl).toBe(expected);
  });

  it("stamps a canonical URL that survives the write/read-back round trip", () => {
    const { repoUrl } = ok(["acme", "--repo", "https://github.com/acme/acme\n"]);
    const stamped = stampProductRepo('export const PRODUCT_REPO_URL = "x";', repoUrl);

    // The exact comparison init-product.ts makes before declaring success.
    expect(currentProductRepo(stamped)).toBe(repoUrl);
  });

  it.each([
    "https://user:token@github.com/acme/acme",
    "https://github.com/acme/acme?x=1&y=2",
    "https://github.com/acme/acme#frag",
    "https://github.com/acme/$(whoami)",
    "https://github.com/acme/a;rm",
  ])("refuses %j, which cannot be published or pasted safely", (url) => {
    expect(parseInitArgs(["acme", "--repo", url]).ok).toBe(false);
  });

  it.each([
    [[], "A product name is required."],
    [["Acme"], "Not a kebab-case product name: Acme"],
    [["acme_cloud"], "Not a kebab-case product name: acme_cloud"],
    [["acme", "--repo"], "--repo needs a URL."],
    [["acme", "--repo", "javascript:alert(1)"], "Not a usable repository URL: javascript:alert(1)"],
    [["acme", "--repo", "github.com/acme"], "Not a usable repository URL: github.com/acme"],
    [["acme", "--repos", "x"], "Unknown option: --repos"],
    [["acme", "-r", "x"], "Unknown option: -r"],
  ])("refuses %j", (argv, error) => {
    const parsed = parseInitArgs(argv);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.error).toBe(error);
  });

  // Without this, `pnpm init:product acme Acme Cloud` stamps "Acme" and drops
  // "Cloud" without a word.
  it("refuses an unquoted multi-word display name rather than truncating it", () => {
    const parsed = parseInitArgs(["acme", "Acme", "Cloud"]);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.error).toContain("quote a display name");
  });
});

describe("stampWranglerConfig", () => {
  // Synthetic fixtures, NOT the live wrangler files. `init:product` is run by
  // downstream clones as their first step, which rewrites those files — reading
  // them here would make these tests fail permanently in exactly the repos this
  // tool exists to serve, taking `pnpm verify` and `pnpm deploy:web` with them.
  const fixture = (workerName: string) => `{
  "name": "${workerName}",
  "main": "worker.ts",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "starter-db",
      "database_id": "510ae3cb-6a46-4409-a1db-b07b59cd504b",
    },
  ],
}`;

  const web = fixture("starter-web");
  const mcp = fixture("starter-mcp");

  it("renames the web Worker and localises its database", () => {
    const out = stampWranglerConfig(web, { fromSlug: "starter", toSlug: "acme", worker: "web" });

    expect(out).toContain('"name": "acme-web"');
    expect(out).toContain('"database_id": "local"');
    expect(out).not.toContain("starter-web");
  });

  // The bug this exists to prevent: localising only web left a clone's MCP
  // Worker bound to the starter's real D1 id — a cross-product data boundary,
  // and a silently broken shared login.
  it("localises the MCP database too, not just the Worker name", () => {
    const out = stampWranglerConfig(mcp, { fromSlug: "starter", toSlug: "acme", worker: "mcp" });

    expect(out).toContain('"name": "acme-mcp"');
    expect(out).toContain('"database_id": "local"');
  });

  it("leaves both Workers pointing at the same database", () => {
    const outWeb = stampWranglerConfig(web, { fromSlug: "starter", toSlug: "acme", worker: "web" });
    const outMcp = stampWranglerConfig(mcp, { fromSlug: "starter", toSlug: "acme", worker: "mcp" });

    const idOf = (s: string) => /"database_id": "([^"]*)"/.exec(s)?.[1];
    expect(idOf(outWeb)).toBe(idOf(outMcp));
  });

  it("carries no starter database id into a clone", () => {
    for (const [source, worker] of [
      [web, "web"],
      [mcp, "mcp"],
    ] as const) {
      expect(
        stampWranglerConfig(source, { fromSlug: "starter", toSlug: "acme", worker }),
      ).not.toMatch(/"database_id": "[0-9a-f-]{36}"/);
    }
  });

  // Stamped rather than left as a printed instruction, because following that
  // instruction used to break the clone: the db:* scripts addressed D1 by name,
  // so renaming it made `db:migrate`, `db:seed`, `db:reset` and the e2e helpers
  // resolve nothing — and `d1 migrations apply` misreported it as "No migrations
  // present". Found by the #17 clean-clone exercise.
  it("stamps the database name so no upstream identity survives", () => {
    for (const [source, worker] of [
      [web, "web"],
      [mcp, "mcp"],
    ] as const) {
      const out = stampWranglerConfig(source, { fromSlug: "starter", toSlug: "acme", worker });

      expect(out).toContain('"database_name": "acme-db"');
      expect(out).not.toContain("starter-db");
    }
  });

  /**
   * A `wrangler d1` command addressing an existing database by name — the shape
   * that breaks a clone, since `init:product` stamps the name to `<slug>-db`.
   *
   * Quotes are optional in the match because they are optional in the shell:
   * without `["']?` the guard passes on `wrangler d1 execute "acme-db"`, which
   * is exactly the regression it exists to catch, written slightly differently.
   *
   * `create` is excluded because it *names* a database that does not exist yet
   * and so has no binding to address — `init:product` prints one on purpose.
   */
  const NAME_LITERAL_D1_COMMAND = /wrangler d1 (?!create\b)\S+(?: \S+)* ["']?[a-z][a-z0-9-]*-db\b/;

  // The other half of that fix, asserted here because this is the file that
  // knows why: the name is only safe to stamp while nothing resolves the
  // database by it. A script reverting to a name literal fails this.
  it.each([
    ["packages/cli/src/db-migrate.ts"],
    ["packages/cli/src/db-reset.ts"],
    ["packages/cli/src/db-seed.ts"],
    ["tests/e2e/helpers.ts"],
  ])("%s addresses the binding, not the database name", (path) => {
    const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");
    const source = readFileSync(join(repoRoot, path), "utf8");

    expect(source).toContain("D1_BINDING");
    expect(source).not.toMatch(NAME_LITERAL_D1_COMMAND);
  });

  // The guard above is only worth what its pattern catches, and the first
  // version silently missed a quoted name — a green test that proved nothing.
  describe("the name-literal guard itself", () => {
    it.each([
      "wrangler d1 execute acme-db --local",
      'wrangler d1 execute "acme-db" --local',
      "wrangler d1 execute 'acme-db' --local",
      "wrangler d1 migrations apply edgeseed-db --remote",
    ])("catches %s", (command) => {
      expect(command).toMatch(NAME_LITERAL_D1_COMMAND);
    });

    it.each([
      "wrangler d1 execute DB --local",
      "wrangler d1 migrations apply DB --remote",
      // `create` names a database that does not exist yet; there is no binding
      // to address, and `init:product` prints exactly this.
      "cd apps/web && npx wrangler d1 create acme-db",
    ])("allows %s", (command) => {
      expect(command).not.toMatch(NAME_LITERAL_D1_COMMAND);
    });
  });

  // Same class of bug as the database id, different currency: a clone that
  // inherited the starter's hostname would have its first deploy try to claim a
  // zone somebody else owns.
  describe("custom domains", () => {
    const withRoutes = `{
  "name": "starter-web",
  "main": "worker.ts",
  // Comment above the routes block, which must go with it.
  "routes": [{ "pattern": "app.edgeseed.dev", "custom_domain": true }],
  "d1_databases": [
    {
      "binding": "DB",
      "database_id": "510ae3cb-6a46-4409-a1db-b07b59cd504b",
    },
  ],
}`;

    it("strips the starter's custom domain from a clone", () => {
      const out = stampWranglerConfig(withRoutes, {
        fromSlug: "starter",
        toSlug: "acme",
        worker: "web",
      });

      expect(out).not.toContain("routes");
      expect(out).not.toContain("app.edgeseed.dev");
    });

    it("takes the routes comment with it rather than orphaning it", () => {
      const out = stampWranglerConfig(withRoutes, {
        fromSlug: "starter",
        toSlug: "acme",
        worker: "web",
      });
      expect(out).not.toContain("Comment above the routes block");
    });

    it("leaves the rest of the config intact when stripping routes", () => {
      const out = stampWranglerConfig(withRoutes, {
        fromSlug: "starter",
        toSlug: "acme",
        worker: "web",
      });

      expect(out).toContain('"name": "acme-web"');
      expect(out).toContain('"main": "worker.ts"');
      expect(out).toContain('"binding": "DB"');
      expect(out).toContain('"database_id": "local"');
    });

    it("still produces parseable config after stripping", () => {
      const out = stampWranglerConfig(withRoutes, {
        fromSlug: "starter",
        toSlug: "acme",
        worker: "web",
      });
      const stripped = out.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/,(\s*[}\]])/g, "$1");

      expect(() => JSON.parse(stripped)).not.toThrow();
    });

    it("is a no-op on a config that declares no routes", () => {
      // apps/mcp has no custom domain — stripping must not mangle it.
      expect(stampWranglerConfig(mcp, { fromSlug: "starter", toSlug: "acme", worker: "mcp" })).toBe(
        mcp
          .replace('"name": "starter-mcp"', '"name": "acme-mcp"')
          .replace('"database_name": "starter-db"', '"database_name": "acme-db"')
          .replace(/"database_id": "[^"]*"/, '"database_id": "local"'),
      );
    });
  });
});
