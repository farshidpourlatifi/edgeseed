import { describe, it, expect } from "vitest";
import {
  currentProductSlug,
  deriveDisplayName,
  isValidProductSlug,
  stampProductIdentity,
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
    const out = stampWranglerConfig(web, { from: "starter-web", to: "acme-web" });

    expect(out).toContain('"name": "acme-web"');
    expect(out).toContain('"database_id": "local"');
    expect(out).not.toContain("starter-web");
  });

  // The bug this exists to prevent: localising only web left a clone's MCP
  // Worker bound to the starter's real D1 id — a cross-product data boundary,
  // and a silently broken shared login.
  it("localises the MCP database too, not just the Worker name", () => {
    const out = stampWranglerConfig(mcp, { from: "starter-mcp", to: "acme-mcp" });

    expect(out).toContain('"name": "acme-mcp"');
    expect(out).toContain('"database_id": "local"');
  });

  it("leaves both Workers pointing at the same database", () => {
    const outWeb = stampWranglerConfig(web, { from: "starter-web", to: "acme-web" });
    const outMcp = stampWranglerConfig(mcp, { from: "starter-mcp", to: "acme-mcp" });

    const idOf = (s: string) => /"database_id": "([^"]*)"/.exec(s)?.[1];
    expect(idOf(outWeb)).toBe(idOf(outMcp));
  });

  it("carries no starter database id into a clone", () => {
    for (const [source, from, to] of [
      [web, "starter-web", "acme-web"],
      [mcp, "starter-mcp", "acme-mcp"],
    ] as const) {
      expect(stampWranglerConfig(source, { from, to })).not.toMatch(
        /"database_id": "[0-9a-f-]{36}"/,
      );
    }
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
      const out = stampWranglerConfig(withRoutes, { from: "starter-web", to: "acme-web" });

      expect(out).not.toContain("routes");
      expect(out).not.toContain("app.edgeseed.dev");
    });

    it("takes the routes comment with it rather than orphaning it", () => {
      const out = stampWranglerConfig(withRoutes, { from: "starter-web", to: "acme-web" });
      expect(out).not.toContain("Comment above the routes block");
    });

    it("leaves the rest of the config intact when stripping routes", () => {
      const out = stampWranglerConfig(withRoutes, { from: "starter-web", to: "acme-web" });

      expect(out).toContain('"name": "acme-web"');
      expect(out).toContain('"main": "worker.ts"');
      expect(out).toContain('"binding": "DB"');
      expect(out).toContain('"database_id": "local"');
    });

    it("still produces parseable config after stripping", () => {
      const out = stampWranglerConfig(withRoutes, { from: "starter-web", to: "acme-web" });
      const stripped = out.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/,(\s*[}\]])/g, "$1");

      expect(() => JSON.parse(stripped)).not.toThrow();
    });

    it("is a no-op on a config that declares no routes", () => {
      // apps/mcp has no custom domain — stripping must not mangle it.
      expect(stampWranglerConfig(mcp, { from: "starter-mcp", to: "acme-mcp" })).toBe(
        mcp
          .replace('"name": "starter-mcp"', '"name": "acme-mcp"')
          .replace(/"database_id": "[^"]*"/, '"database_id": "local"'),
      );
    });
  });
});
