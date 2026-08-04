import { test, expect } from "@playwright/test";

test("landing page renders marketing content", async ({ page }) => {
  await page.goto("/");
  // Generous first-load timeout: Vite compiles the route on first hit
  await expect(page.locator("h1")).toContainText("SaaS product", { timeout: 15000 });
  await expect(page.locator("text=Get Started").first()).toBeVisible();
  await expect(page.locator("text=Sign In").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Everything wired up on day one" })).toBeVisible();
});

test("terminal demo animates on the landing page", async ({ page }) => {
  await page.goto("/");
  const body = page.locator("#terminal-demo .tw-body");
  await body.scrollIntoViewIfNeeded();
  // The scripted typewriter should type the command, then reveal gate results
  await expect(body).toContainText("pnpm verify", { timeout: 15000 });
  await expect(body).toContainText("lint — no errors", { timeout: 10000 });
});

test("health endpoint returns ok", async ({ request }) => {
  const response = await request.get("/api/v1/health");
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.status).toBe("ok");
});

test("OpenAPI doc endpoint returns spec", async ({ request }) => {
  const response = await request.get("/api/v1/doc");
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.openapi).toBe("3.1.0");
  expect(body.paths["/health"]).toBeDefined();
});
