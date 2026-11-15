import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The lockup's accessible name. The mark is `aria-hidden`, so a link around a
 * lockup that drops the name has none: the name has to stay in the markup
 * when it is visually hidden, and it has to be the product's, not a literal.
 *
 * `.test.ts` with `createElement`: the root vitest config collects no `.tsx`.
 */
async function renderLogo(props: { showName?: boolean } = {}): Promise<string> {
  vi.resetModules();
  vi.doMock("@starter/config/product", () => ({ PRODUCT_NAME: "Acme Cloud" }));

  const { BrandLogo } = await import("../components/brand/brand-logo");
  return renderToStaticMarkup(createElement(BrandLogo, props));
}

afterEach(() => {
  vi.doUnmock("@starter/config/product");
  vi.resetModules();
});

describe("the brand lockup", () => {
  it("shows the configured product name beside a decorative mark", async () => {
    const html = await renderLogo();

    expect(html).toContain("Acme Cloud");
    expect(html).not.toContain("sr-only");
    expect(html).toContain('aria-hidden="true"');
  });

  it("keeps the name in the accessibility tree when it is hidden", async () => {
    const html = await renderLogo({ showName: false });

    expect(html).toContain('<span class="sr-only">Acme Cloud</span>');
  });
});
