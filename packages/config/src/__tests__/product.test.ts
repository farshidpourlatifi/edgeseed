import { describe, it, expect } from "vitest";
import { MCP_SERVER_NAME, PRODUCT_NAME, PRODUCT_REPO_URL, PRODUCT_SLUG } from "../product";

describe("product identity", () => {
  it("exposes a display name and a kebab-case slug", () => {
    expect(PRODUCT_NAME).toBeTruthy();
    expect(PRODUCT_SLUG).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  // Holds in a clone too, where the value is "" — that is the stamped default,
  // and the landing page renders without its GitHub affordances rather than
  // linking the starter (issue #32). Anything in between is a value that would
  // reach an href: `repoLinks()` drops it, and this says so at the source.
  it("declares a repository that is empty or an http(s) URL", () => {
    expect(PRODUCT_REPO_URL === "" || /^https?:\/\/\S+$/.test(PRODUCT_REPO_URL)).toBe(true);
  });

  // The MCP server name is what clients display. Deriving it means
  // `init:product` renames it for free; hardcoding it would ship "Starter"
  // in every downstream repo.
  it("derives the MCP server name from the product name", () => {
    expect(MCP_SERVER_NAME).toContain(PRODUCT_NAME);
    expect(MCP_SERVER_NAME).toBe(`${PRODUCT_NAME} MCP`);
  });

  // These exact declaration shapes are what init-product.ts rewrites with a
  // regex — a reformat here silently breaks `pnpm init:product`.
  it("keeps the literal declaration shape init:product rewrites", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../product.ts", import.meta.url), "utf8"),
    );

    expect(source).toMatch(/export const PRODUCT_NAME = "[^"]*"/);
    expect(source).toMatch(/export const PRODUCT_SLUG = "[^"]*"/);
    // Reformatting this one does more than break the rename: init-product.ts
    // verifies its own stamp through the same regex and exits non-zero, rather
    // than leaving a clone silently pointed at the starter's repository.
    expect(source).toMatch(/export const PRODUCT_REPO_URL = "[^"]*"/);
  });
});
