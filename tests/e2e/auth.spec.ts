import { test, expect } from "@playwright/test";

const TEST_USER = {
  name: "E2E Test User",
  email: `e2e-${Date.now()}@example.com`,
  password: "testpassword123",
};

test.describe("auth flow", () => {
  test.describe.configure({ mode: "serial" });

  test("should register a new account", async ({ page }) => {
    await page.goto("/register");
    await expect(page.locator("h1")).toContainText("Sign Up");

    await page.fill('input[placeholder="Name"]', TEST_USER.name);
    await page.fill('input[placeholder="Email"]', TEST_USER.email);
    await page.fill('input[placeholder="Password"]', TEST_USER.password);
    await page.click('button[type="submit"]');

    await page.waitForURL("**/dashboard", { timeout: 10000 });
    await expect(page.locator("text=" + TEST_USER.name)).toBeVisible();
  });

  test("should sign out from dashboard", async ({ page }) => {
    // Login first
    await page.goto("/login");
    await page.fill('input[placeholder="Email"]', TEST_USER.email);
    await page.fill('input[placeholder="Password"]', TEST_USER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 10000 });

    // Sign out
    await page.click("text=Sign Out");

    await page.waitForURL("/", { timeout: 10000 });
    await expect(page.locator("h1")).toContainText("Ship Cloudflare-native products");
  });

  test("should login with existing account", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("h1")).toContainText("Sign In");

    await page.fill('input[placeholder="Email"]', TEST_USER.email);
    await page.fill('input[placeholder="Password"]', TEST_USER.password);
    await page.click('button[type="submit"]');

    await page.waitForURL("**/dashboard", { timeout: 10000 });
    await expect(page.locator("text=" + TEST_USER.name)).toBeVisible();
  });

  test("should show error with wrong password", async ({ page }) => {
    await page.goto("/login");

    await page.fill('input[placeholder="Email"]', TEST_USER.email);
    await page.fill('input[placeholder="Password"]', "wrongpassword");
    await page.click('button[type="submit"]');

    // Should stay on login page with an error message
    await expect(page.locator('[class*="destructive"]')).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/.*login/);
  });

  test("should redirect to login when accessing dashboard unauthenticated", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login", { timeout: 10000 });
    await expect(page.locator("h1")).toContainText("Sign In");
  });
});
