import { test, expect } from "@playwright/test";

const TEST_USER = {
  name: "E2E Test User",
  email: `e2e-${Date.now()}@example.com`,
  password: "testpassword123",
};

test.describe("auth flow", () => {
  test.describe.configure({ mode: "serial" });

  test("should register a new account", async ({ page }) => {
    await page.goto("/register", { waitUntil: "networkidle" });
    await expect(page.locator("text=Create an account")).toBeVisible();

    await page.fill("#name", TEST_USER.name);
    await page.fill("#email", TEST_USER.email);
    await page.fill("#password", TEST_USER.password);
    await page.fill("#confirmPassword", TEST_USER.password);
    await page.click('button[type="submit"]');

    await page.waitForURL("**/dashboard", { timeout: 10000 });
    await expect(page.locator("text=Dashboard")).toBeVisible();
  });

  test("should sign out from dashboard", async ({ page }) => {
    // Login first
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.fill("#email", TEST_USER.email);
    await page.fill("#password", TEST_USER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 10000 });

    // Sign out via the mobile menu (more reliable in tests)
    // Click the hamburger/menu button to open dropdown
    await page.click('button[aria-label="Open menu"]');
    await page.click("text=Sign Out");

    await page.waitForURL("/", { timeout: 10000 });
    await expect(page.locator("h1")).toContainText("SaaS product");
  });

  test("should login with existing account", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" });
    await expect(page.locator("text=Welcome back")).toBeVisible();

    await page.fill("#email", TEST_USER.email);
    await page.fill("#password", TEST_USER.password);
    await page.click('button[type="submit"]');

    await page.waitForURL("**/dashboard", { timeout: 10000 });
    await expect(page.locator("text=Dashboard")).toBeVisible();
  });

  test("should show error with wrong password", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" });

    await page.fill("#email", TEST_USER.email);
    await page.fill("#password", "wrongpassword");
    await page.click('button[type="submit"]');

    // Error alert should appear
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/.*login/);
  });

  test("should redirect to login when accessing dashboard unauthenticated", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login", { timeout: 10000 });
    await expect(page.locator("text=Welcome back")).toBeVisible();
  });
});
