import { test as setup } from "@playwright/test";

/**
 * Warm the Vite dev server before the suite runs.
 *
 * On the first browser hit to a route Vite compiles it and pre-bundles any
 * dependency it has not seen yet. That second step ends with "optimized
 * dependencies changed. reloading" — a full page reload that detaches every
 * node Playwright has already resolved. When it lands mid-test the symptom is
 * a `fill` that retries against a detached element until the test times out.
 *
 * Loading each route here, with nothing asserting against it, moves that cost
 * out of the tests. Each route is loaded twice: the first pass triggers the
 * compile and any re-optimization, the second confirms it has settled.
 */
const ROUTES = ["/", "/login", "/register", "/dashboard", "/dashboard/settings"];

setup("warm dev server routes", async ({ page }) => {
  setup.setTimeout(180_000);

  for (const route of ROUTES) {
    for (let pass = 0; pass < 2; pass++) {
      await page.goto(route, { waitUntil: "load" });
      await page.waitForLoadState("networkidle");
    }
  }
});
