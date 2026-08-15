import { test, expect, type Page } from "@playwright/test";
import { clientIp, giveOrganization, markEmailVerified, waitForHydration } from "./helpers";

/**
 * Every dashboard control either does what it says or says it cannot.
 *
 * The regression this guards is not a crash: the profile form used to sleep
 * 800ms and toast "Settings saved successfully" while writing nothing, and the
 * organization menu answered "coming soon". Both looked healthy from the
 * outside, which is exactly why only a test that reloads and re-reads the value
 * can tell the difference. See issue #16.
 */

const USER = {
  name: "E2E Dashboard User",
  renamed: "E2E Renamed User",
  email: `e2e-dashboard-${Date.now()}@example.com`,
  password: "testpassword123",
};

const ORG = { slug: `e2e-dash-${Date.now()}`, name: "Dashboard Org" };

/**
 * One address for the whole file, so registration in `beforeAll` and the
 * sign-ins in each test draw on the same budget without sharing one with the
 * other specs (`clientIp` in `helpers.ts` explains why the header is needed).
 * Applied to the `beforeAll` context by hand, because `test.use` options do not
 * reach a context created from the worker-scoped `browser` fixture.
 */
const IP = clientIp();
test.use({ extraHTTPHeaders: { "cf-connecting-ip": IP } });

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { "cf-connecting-ip": IP } });
  const page = await context.newPage();

  await page.goto("/register");
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(name).toBeVisible({ timeout: 15000 });
  await waitForHydration(name);

  await name.fill(USER.name);
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(USER.email);
  await page.getByLabel("Password", { exact: true }).fill(USER.password);
  await page.getByLabel("Confirm Password", { exact: true }).fill(USER.password);
  await page.getByRole("button", { name: "Create Account" }).click();

  // Verification gates the session, so prove the address before signing in.
  await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 15000 });
  markEmailVerified(USER.email);

  // Seeded rather than created through the dialog: this spec is about the other
  // dashboard controls, and writing the rows directly is faster than driving a
  // flow that `organizations.spec.ts` already owns end to end.
  giveOrganization(USER.email, ORG.slug, ORG.name);

  await context.close();
});

async function signIn(page: Page) {
  await page.goto("/login");
  const email = page.getByRole("textbox", { name: "Email", exact: true });
  await expect(email).toBeVisible({ timeout: 15000 });
  await waitForHydration(email);

  await email.fill(USER.email);
  await page.getByLabel("Password", { exact: true }).fill(USER.password);
  await page.getByRole("button", { name: "Sign In" }).click();

  // Wait for the session to land — otherwise `requireUser` on the settings
  // loader redirects straight back to /login.
  await page.waitForURL("**/dashboard", { timeout: 15000 });
}

test.describe("dashboard controls", () => {
  test("the profile form persists a name and reports a failure as a failure", async ({
    page,
    request,
  }) => {
    await signIn(page);
    await page.goto("/dashboard/settings");

    const nameInput = page.getByRole("textbox", { name: "Name", exact: true });
    await expect(nameInput).toBeVisible({ timeout: 15000 });
    await waitForHydration(nameInput);

    const save = page.getByRole("button", { name: "Save Changes" });

    // Nothing edited yet: the button says so rather than offering a no-op save.
    await expect(save).toBeDisabled();

    // --- The failure path. A rejected write must not read as a saved one. ---
    await page.route("**/api/auth/update-user", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "Storage unavailable" }),
      }),
    );

    await nameInput.fill("Name That Must Not Stick");
    await expect(save).toBeEnabled();
    await save.click();

    await expect(page.getByText(/storage unavailable|could not save/i)).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Profile saved")).toHaveCount(0);

    await page.unroute("**/api/auth/update-user");
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(USER.name);

    // --- The happy path, typed with padding the save has to strip. ---
    const reloadedName = page.getByRole("textbox", { name: "Name", exact: true });
    await waitForHydration(reloadedName);
    await reloadedName.fill(`  ${USER.renamed}  `);
    await page.getByRole("button", { name: "Save Changes" }).click();

    await expect(page.getByText("Profile saved")).toBeVisible({ timeout: 15000 });

    // The field shows what was stored, not what was typed — before any reload
    // papers over the difference.
    await expect(reloadedName).toHaveValue(USER.renamed);

    // Persisted, not merely echoed back: a full reload re-reads it from D1, and
    // the sidebar renders it from a *different* loader.
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
      USER.renamed,
    );
    await expect(page.getByRole("button", { name: new RegExp(USER.renamed) })).toBeVisible();

    // --- The deny path: no session, no write. ---
    const anonymous = await request.post("/api/auth/update-user", {
      headers: { "content-type": "application/json", origin: "http://localhost:5173" },
      data: { name: "Hijacked" },
      failOnStatusCode: false,
    });
    expect(anonymous.status()).toBe(401);

    await page.reload();
    await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
      USER.renamed,
    );
  });

  test("controls with nowhere to go are absent, or disabled and explained", async ({ page }) => {
    await signIn(page);
    await page.goto("/dashboard/settings");

    // Email is not editable anywhere yet — Better Auth refuses it on
    // /update-user — so the input says so instead of accepting keystrokes.
    const email = page.getByRole("textbox", { name: "Email", exact: true });
    await expect(email).toBeVisible({ timeout: 15000 });
    await expect(email).toBeDisabled();
    await expect(page.getByText(/changing your email is not supported yet/i)).toBeVisible();

    // The notification bell is gone rather than opening nothing.
    await expect(page.getByRole("button", { name: "View notifications" })).toHaveCount(0);

    // Organization creation is wired now (issue #34), so the item is enabled
    // and opens something. The full creation journey belongs to
    // `organizations.spec.ts`; what this asserts is that the control is no
    // longer the disabled placeholder it shipped as — and that the dialog
    // survives the menu closing, which is the Radix trap a nested mount hits.
    await page.getByRole("button", { name: new RegExp(ORG.name) }).click();
    const createOrg = page.getByRole("menuitem", { name: /create organization/i });
    await expect(createOrg).toBeVisible();
    await expect(createOrg).toBeEnabled();
    await expect(page.getByText(/organization management is still being built/i)).toHaveCount(0);

    await createOrg.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15000 });
  });
});
