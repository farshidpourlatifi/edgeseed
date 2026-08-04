import { test, expect } from "@playwright/test";
import { waitForHydration } from "./helpers";

const TEST_USER = {
  name: "E2E Test User",
  email: `e2e-${Date.now()}@example.com`,
  password: "testpassword123",
};

test.describe("auth flow", () => {
  test.describe.configure({ mode: "serial" });

  test("should register a new account", async ({ page }) => {
    await page.goto("/register");

    const name = page.getByRole("textbox", { name: "Name", exact: true });
    const email = page.getByRole("textbox", { name: "Email", exact: true });
    // Password inputs have no implicit ARIA role, so they are reached by label.
    const password = page.getByLabel("Password", { exact: true });
    const confirmPassword = page.getByLabel("Confirm Password", { exact: true });
    const submit = page.getByRole("button", { name: "Create Account" });

    // Generous first-load timeout: Vite compiles the route on first hit
    await expect(submit).toBeVisible({ timeout: 15000 });
    // Filling before React attaches loses the values or detaches the input
    await waitForHydration(name);

    await name.fill(TEST_USER.name);
    await email.fill(TEST_USER.email);
    await password.fill(TEST_USER.password);
    await confirmPassword.fill(TEST_USER.password);
    await submit.click();

    await page.waitForURL("**/dashboard", { timeout: 10000 });
    await expect(page.getByRole("heading", { name: "Welcome to your dashboard" })).toBeVisible();
  });

  test("should sign out from dashboard", async ({ page }) => {
    // Login first
    await page.goto("/login");

    const email = page.getByRole("textbox", { name: "Email", exact: true });
    const password = page.getByLabel("Password", { exact: true });

    await waitForHydration(email);
    await email.fill(TEST_USER.email);
    await password.fill(TEST_USER.password);
    await page.getByRole("button", { name: "Sign In" }).click();
    await page.waitForURL("**/dashboard", { timeout: 10000 });

    // Sign out via the sidebar user menu
    await page.getByRole("button", { name: TEST_USER.name }).click();
    await page.getByRole("menuitem", { name: "Sign Out" }).click();

    await page.waitForURL("/", { timeout: 10000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("SaaS product");
  });

  test("should login with existing account", async ({ page }) => {
    await page.goto("/login");

    const email = page.getByRole("textbox", { name: "Email", exact: true });
    const password = page.getByLabel("Password", { exact: true });
    const submit = page.getByRole("button", { name: "Sign In" });

    // Generous first-load timeout: Vite compiles the route on first hit
    await expect(submit).toBeVisible({ timeout: 15000 });
    await waitForHydration(email);

    await email.fill(TEST_USER.email);
    await password.fill(TEST_USER.password);
    await submit.click();

    await page.waitForURL("**/dashboard", { timeout: 10000 });
    await expect(page.getByRole("heading", { name: "Welcome to your dashboard" })).toBeVisible();
  });

  test("should show error with wrong password", async ({ page }) => {
    await page.goto("/login");

    const email = page.getByRole("textbox", { name: "Email", exact: true });
    const password = page.getByLabel("Password", { exact: true });

    await waitForHydration(email);
    await email.fill(TEST_USER.email);
    await password.fill("wrongpassword");
    await page.getByRole("button", { name: "Sign In" }).click();

    // Error alert should appear
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/.*login/);
  });

  test("should redirect to login when accessing dashboard unauthenticated", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login", { timeout: 10000 });
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible({ timeout: 15000 });
  });
});
