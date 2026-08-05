import { test, expect } from "@playwright/test";

test("landing page renders marketing content", async ({ page }) => {
  await page.goto("/");
  // Generous first-load timeout: Vite compiles the route on first hit
  await expect(page.getByRole("heading", { level: 1 })).toContainText("SaaS product", {
    timeout: 15000,
  });
  await expect(page.getByRole("link", { name: "Get Started" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign In" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Everything wired up on day one" })).toBeVisible();
});

test("terminal demo animates on the landing page", async ({ page }) => {
  await page.goto("/");
  // #quality / #terminal-demo are stable navigation anchors, used only to scope;
  // the terminal elements are selected by testid because the animated body is
  // aria-hidden (the accessible transcript is a separate element).
  // Static summary terminals render their full transcript immediately
  const summary = page.locator("#quality").getByTestId("terminal").first();
  await summary.scrollIntoViewIfNeeded();
  await expect(summary).toContainText("7 gates passed — deploy unlocked", { timeout: 15000 });
  // The animated one types the command, then reveals gate results over time
  const body = page.locator("#terminal-demo").getByTestId("terminal-body");
  await expect(body).toContainText("pnpm verify", { timeout: 15000 });
  await expect(body).toContainText("lint — eslint . clean", { timeout: 10000 });
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
