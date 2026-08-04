import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  deriveDisplayName,
  isValidProductSlug,
  stampProductIdentity,
  stampWranglerConfig,
} from "../lib/init-product";

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
  const source = readFileSync(new URL("../../../config/src/product.ts", import.meta.url), "utf8");

  it("rewrites both constants in the real product.ts", () => {
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
  const web = readFileSync(new URL("../../../../apps/web/wrangler.jsonc", import.meta.url), "utf8");
  const mcp = readFileSync(new URL("../../../../apps/mcp/wrangler.jsonc", import.meta.url), "utf8");

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
});
