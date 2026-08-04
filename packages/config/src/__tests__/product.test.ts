import { describe, it, expect } from "vitest";
import { MCP_SERVER_NAME, PRODUCT_NAME, PRODUCT_SLUG } from "../product";

describe("product identity", () => {
  it("exposes a display name and a kebab-case slug", () => {
    expect(PRODUCT_NAME).toBeTruthy();
    expect(PRODUCT_SLUG).toMatch(/^[a-z][a-z0-9-]*$/);
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
  });
});
