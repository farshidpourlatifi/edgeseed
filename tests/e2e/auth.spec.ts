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
    // Generous first-load timeout: Vite compiles the route on first hit
    await expect(page.locator("text=Create an account")).toBeVisible({ timeout: 15000 });

    await page.fill("#name", TEST_USER.name);
    await page.fill("#email", TEST_USER.email);
    await page.fill("#password", TEST_USER.password);
    await page.fill("#confirmPassword", TEST_USER.password);
    await page.click('button[type="submit"]');

    await page.waitForURL("**/dashboard", { timeout: 10000 });
    await expect(page.getByRole("heading", { name: "Welcome to your dashboard" })).toBeVisible();
  });

  test("should sign out from dashboard", async ({ page }) => {
    // Login first
    await page.goto("/login");
    await page.fill("#email", TEST_USER.email);
    await page.fill("#password", TEST_USER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 10000 });

    // Sign out via the sidebar user menu
    await page.getByRole("button", { name: TEST_USER.name }).click();
    await page.getByRole("menuitem", { name: "Sign Out" }).click();

    await page.waitForURL("/", { timeout: 10000 });
    await expect(page.locator("h1")).toContainText("SaaS product");
  });

  test("should login with existing account", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("text=Welcome back")).toBeVisible({ timeout: 15000 });

    await page.fill("#email", TEST_USER.email);
    await page.fill("#password", TEST_USER.password);
    await page.click('button[type="submit"]');

    await page.waitForURL("**/dashboard", { timeout: 10000 });
    await expect(page.getByRole("heading", { name: "Welcome to your dashboard" })).toBeVisible();
  });

  test("should show error with wrong password", async ({ page }) => {
    await page.goto("/login");

    await page.fill("#email", TEST_USER.email);
    await page.fill("#password", "wrongpassword");
    await page.click('button[type="submit"]');

    // Error alert should appear
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/.*login/);
  });

  test("should redirect to login when accessing dashboard unauthenticated", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login", { timeout: 10000 });
    await expect(page.locator("text=Welcome back")).toBeVisible({ timeout: 15000 });
  });
});
