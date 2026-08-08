import { test, expect } from "@playwright/test";
import { clientIp, markEmailVerified, waitForHydration } from "./helpers";

const TEST_USER = {
  name: "E2E Test User",
  email: `e2e-${Date.now()}@example.com`,
  password: "testpassword123",
};

/**
 * Its own client address. This file signs in four times and registers once, and
 * auth rate limiting keys on `cf-connecting-ip` — without a header of its own
 * every spec would draw on one shared budget and a retry could tip the suite
 * into 429s that look like auth regressions. See `clientIp` in `helpers.ts`.
 */
test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

async function fillSignIn(page: import("@playwright/test").Page, password: string) {
  await page.goto("/login");

  const email = page.getByRole("textbox", { name: "Email", exact: true });
  // Password inputs have no implicit ARIA role, so they are reached by label.
  const passwordField = page.getByLabel("Password", { exact: true });
  const submit = page.getByRole("button", { name: "Sign In" });

  // Generous first-load timeout: Vite compiles the route on first hit
  await expect(submit).toBeVisible({ timeout: 15000 });
  await waitForHydration(email);

  await email.fill(TEST_USER.email);
  await passwordField.fill(password);
  await submit.click();
}

test.describe("auth flow", () => {
  test.describe.configure({ mode: "serial" });

  test("should ask the new account to check its email rather than sign it in", async ({ page }) => {
    await page.goto("/register");

    const name = page.getByRole("textbox", { name: "Name", exact: true });
    const email = page.getByRole("textbox", { name: "Email", exact: true });
    const password = page.getByLabel("Password", { exact: true });
    const confirmPassword = page.getByLabel("Confirm Password", { exact: true });
    const submit = page.getByRole("button", { name: "Create Account" });

    await expect(submit).toBeVisible({ timeout: 15000 });
    // Filling before React attaches loses the values or detaches the input
    await waitForHydration(name);

    await name.fill(TEST_USER.name);
    await email.fill(TEST_USER.email);
    await password.fill(TEST_USER.password);
    await confirmPassword.fill(TEST_USER.password);
    await submit.click();

    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
      timeout: 10000,
    });
    // The session is the thing being withheld — assert it, not just the copy.
    await expect(page).not.toHaveURL(/.*dashboard/);
  });

  test("should refuse the dashboard while the address is unverified", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login", { timeout: 10000 });
  });

  test("should refuse sign-in with correct credentials while unverified", async ({ page }) => {
    await fillSignIn(page, TEST_USER.password);

    // Not an error alert: the credentials were right, the address is not proven,
    // so the page offers a resend instead of a dead end.
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
      timeout: 10000,
    });
    await expect(page).toHaveURL(/.*login/);
  });

  test("should sign in once the address is verified", async ({ page }) => {
    markEmailVerified(TEST_USER.email);

    await fillSignIn(page, TEST_USER.password);

    await page.waitForURL("**/dashboard", { timeout: 10000 });
    await expect(page.getByRole("heading", { name: "Welcome to your dashboard" })).toBeVisible();
  });

  test("should sign out from dashboard", async ({ page }) => {
    await fillSignIn(page, TEST_USER.password);
    await page.waitForURL("**/dashboard", { timeout: 10000 });

    // Sign out via the sidebar user menu
    await page.getByRole("button", { name: TEST_USER.name }).click();
    await page.getByRole("menuitem", { name: "Sign Out" }).click();

    await page.waitForURL("/", { timeout: 10000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("SaaS product");
  });

  test("should show error with wrong password", async ({ page }) => {
    await fillSignIn(page, "wrongpassword");

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
