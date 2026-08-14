import { test, expect } from "@playwright/test";

/**
 * The branded 404 (issue #48), asserted on the two things a browser render
 * cannot tell you apart from a working page.
 *
 * **The status code is the assertion that matters.** A page that says "not
 * found" and answers 200 looks identical in a browser and is wrong for every
 * crawler, monitor and link checker — and it is the exact regression a splat
 * route invites, because the route renders happily whether or not its loader
 * carries `data(null, { status: 404 })`. Dropping that call leaves the visual
 * assertions below green.
 *
 * The path is unique per run so it can never collide with a route somebody
 * adds later, which would turn this into a test of that page instead.
 */
const UNKNOWN_PATH = `/no-such-page-${Date.now().toString(36)}`;

test("an unknown URL answers 404", async ({ request }) => {
  const res = await request.get(UNKNOWN_PATH);

  expect(res.status()).toBe(404);
  // HTML, not the Worker's plain-text origin refusal — that one is a security
  // boundary and deliberately stays unbranded (server/origins.ts).
  expect(res.headers()["content-type"]).toContain("text/html");
});

test("an unknown URL renders the branded page with a working way home", async ({ page }) => {
  await page.goto(UNKNOWN_PATH);

  await expect(page.getByRole("heading", { name: "Page not found", level: 1 })).toBeVisible();
  await expect(page.getByText("404", { exact: true })).toBeVisible();

  const goHome = page.getByRole("link", { name: "Go home" });
  await expect(goHome).toBeVisible();

  await goHome.click();
  await page.waitForURL("**/");
  // The landing page, reached through a document request — `reloadDocument` is
  // what makes this link correct in split-origin mode too (docs/domains.md).
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
});

test("the 404 page asks not to be indexed", async ({ page }) => {
  await page.goto(UNKNOWN_PATH);

  await expect(page).toHaveTitle(/^404 — /);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
});
