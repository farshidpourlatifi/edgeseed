import { test, expect } from "@playwright/test";

/**
 * The favicon has to *decode*, not merely respond.
 *
 * `apps/web/public/favicon.svg` shipped for two days with `--primary` written
 * inside an XML comment. A comment may not contain a double hyphen and SVG is
 * parsed as strict XML, so the file was not well-formed and browsers dropped
 * the icon — showing the default globe on the landing page and every app page.
 *
 * Every signal available short of a browser said it was fine: the asset
 * answered 200 with `content-type: image/svg+xml` and the right byte length,
 * and `<link rel="icon">` was present in the served HTML. Only an image decoder
 * disagrees, and it does so without logging anything. So this asserts on
 * `naturalWidth` after a real load, which is the one observation that failed.
 *
 * Both surfaces are checked because they are separate origins in split-origin
 * mode (`docs/domains.md`) — the landing page and the app do not share a host
 * in production, and `/favicon.svg` is not an app path prefix.
 */

const PAGES = [
  { name: "the landing page", path: "/" },
  { name: "an app page", path: "/login" },
] as const;

for (const { name, path } of PAGES) {
  test(`${name} declares an icon that the browser can decode`, async ({ page }) => {
    await page.goto(path);

    const href = await page.locator('link[rel="icon"]').first().getAttribute("href");
    expect(href).toBeTruthy();

    // A malformed SVG fires `error`, never `load`, so the width stays 0. An
    // intrinsic size is also what Chromium needs to rasterise a tab icon at all.
    const width = await page.evaluate(
      (src) =>
        new Promise<number>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img.naturalWidth);
          img.onerror = () => resolve(0);
          img.src = src;
        }),
      href!,
    );

    expect(width).toBeGreaterThan(0);
  });
}
