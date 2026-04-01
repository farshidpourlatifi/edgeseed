import { test, expect } from "@playwright/test";

test("landing page renders marketing content", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("h1")).toContainText("SaaS product");
  await expect(page.locator("text=Get Started").first()).toBeVisible();
  await expect(page.locator("text=Sign In").first()).toBeVisible();
  await expect(page.locator("text=Everything you need to ship faster")).toBeVisible();
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
