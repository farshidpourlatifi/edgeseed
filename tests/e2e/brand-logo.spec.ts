import { test, expect } from "@playwright/test";

import { PRODUCT_NAME } from "@starter/config/product";

/**
 * Every logo link has an accessible name, and it is the product's.
 *
 * On these pages the lockup shows the mark alone or sits in a bare header. The
 * mark is `aria-hidden`, so a link around it is nameless unless the lockup
 * keeps the name in the accessibility tree — which a role locator can see and
 * a screenshot cannot. The name is imported rather than written out, so a
 * clone that stamps its own runs these unchanged.
 *
 * These load pages and call no `/api/auth/*` endpoint, so they need no client
 * address of their own.
 */
const PAGES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/accept-invitation",
  "/no-such-page",
] as const;

for (const path of PAGES) {
  test(`the logo on ${path} is a named link to the landing page`, async ({ page }) => {
    await page.goto(path);

    const logo = page.getByRole("link", { name: PRODUCT_NAME, exact: true });
    await expect(logo).toBeVisible({ timeout: 15000 });
    await expect(logo).toHaveAttribute("href", "/");
  });
}
