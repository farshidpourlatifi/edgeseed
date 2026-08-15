import { test, expect, type Page } from "@playwright/test";
import { clearActiveOrganization, clientIp, markEmailVerified, waitForHydration } from "./helpers";

/**
 * A brand-new account creates its first organization, from the product surface.
 *
 * The epic's acceptance criterion is specifically **without seeded data**, so
 * this file deliberately does not call `giveOrganization` — that helper writes
 * `organization` + `member` rows straight into D1 and would skip the entire
 * path under test. Specs that only need an org to exist still use it, because
 * seeding is faster than driving a dialog.
 *
 * The two deny paths are the point of the second half: a colliding slug must
 * come back as a correction the user can act on rather than a 500 or a silent
 * failure, and an unauthenticated caller must not be able to create anything.
 */

const USER = {
  name: "E2E Org Owner",
  email: `e2e-org-${Date.now()}@example.com`,
  password: "testpassword123",
};

const ORG = { name: "Northwind Trading", slug: "northwind-trading" };
const SECOND_ORG = { name: "Northwind Labs", slug: "northwind-labs" };

/** Own address, or this spec and the other registering specs throttle each other. */
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

  await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 15000 });
  markEmailVerified(USER.email);

  // No `giveOrganization` — the account reaches the dashboard owning nothing,
  // which is the state this spec exists to exercise.
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
  await page.waitForURL("**/dashboard", { timeout: 15000 });
}

/**
 * The sidebar and the dashboard card both offer a "Create organization" button
 * to an account with none, so an unscoped locator is ambiguous. Scoping by
 * landmark keeps both reachable by role — `<aside>` is `complementary`,
 * `<main>` is `main` — rather than reaching for a test id.
 */
const sidebar = (page: Page) => page.getByRole("complementary");
const content = (page: Page) => page.getByRole("main");

/**
 * The switcher's trigger is labelled with whichever organization is active, and
 * which one that is depends on where in this file you are: better-auth sets
 * `activeOrganizationId` when an organization is created, and `#36`'s session
 * hook sets it at sign-in for an account that already has one — so an account
 * that creates a second organization mid-spec moves the label. Matching either
 * name keeps a spec that only needs to *open* the switcher from depending on
 * that, or on the order `listOrganizations` happens to return.
 */
const activeOrgName = new RegExp(`${ORG.name}|${SECOND_ORG.name}`);

test.describe("organization creation", () => {
  test("a new account creates its first organization with no seeded data", async ({ page }) => {
    await signIn(page);

    // --- First run: a card that offers the path, not a blank switcher. ---
    const firstRun = content(page).getByRole("button", { name: "Create organization" });
    await expect(content(page).getByText(/create your first organization/i)).toBeVisible({
      timeout: 15000,
    });
    await waitForHydration(firstRun);

    // Reachable from the sidebar too, so a zero-org account on any dashboard
    // page has a way in.
    await expect(sidebar(page).getByRole("button", { name: "Create organization" })).toBeVisible();

    await firstRun.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // --- The slug is suggested from the name, and is editable. ---
    const nameField = dialog.getByLabel("Name", { exact: true });
    const slugField = dialog.getByLabel("Slug", { exact: true });
    const submit = dialog.getByRole("button", { name: "Create organization" });

    // Nothing typed yet: no no-op submit on offer.
    await expect(submit).toBeDisabled();

    await nameField.fill(ORG.name);
    await expect(slugField).toHaveValue(ORG.slug);
    await expect(submit).toBeEnabled();

    await submit.click();

    // --- The organization exists, is active, and the switcher renders it. ---
    await expect(dialog).toBeHidden({ timeout: 15000 });
    await expect(sidebar(page).getByRole("button", { name: new RegExp(ORG.name) })).toBeVisible({
      timeout: 15000,
    });
    await expect(content(page).getByText(/create your first organization/i)).toHaveCount(0);

    // Persisted, not merely rendered: a full reload re-reads the organization
    // from D1 and the active id from the session row. The server sets the new
    // organization active itself (better-auth `crud-org.mjs`), so this also
    // proves that happened — nothing in the app calls `setActive` here.
    await page.reload();
    await expect(sidebar(page).getByRole("button", { name: new RegExp(ORG.name) })).toBeVisible({
      timeout: 15000,
    });
  });

  test("a colliding slug is a correction in the dialog, not a failure", async ({ page }) => {
    await signIn(page);

    // Now that the account owns one, the create action lives in the switcher.
    await sidebar(page)
      .getByRole("button", { name: new RegExp(ORG.name) })
      .click();
    await page.getByRole("menuitem", { name: /create organization/i }).click();

    // The dialog survives the menu closing — it is mounted as a sibling of the
    // dropdown, not inside the item that opens it. Mounted inside, Radix would
    // unmount it here and the control would open nothing.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const nameField = dialog.getByLabel("Name", { exact: true });
    const slugField = dialog.getByLabel("Slug", { exact: true });
    const submit = dialog.getByRole("button", { name: "Create organization" });

    await nameField.fill(SECOND_ORG.name);

    /**
     * Typed in a different case on purpose. The unique index is binary — no
     * `COLLATE NOCASE` — so a slug submitted as the user typed it would create
     * a second organization rather than collide, and the app would render two
     * that look identical. Every slug goes through `slugify` before it is sent,
     * so this must be refused exactly as the lowercase spelling is.
     */
    await slugField.fill(ORG.slug.toUpperCase());
    // Settles on blur to what will actually be sent, rather than showing the
    // typed casing back and quietly creating something else.
    await slugField.blur();
    await expect(slugField).toHaveValue(ORG.slug);

    await submit.click();

    // Surfaced against the field that is wrong, with the dialog still open and
    // both values intact — a toast-and-close would discard the typed name to
    // report that one field needs an edit.
    await expect(dialog.getByRole("alert")).toContainText(/already taken/i, { timeout: 15000 });
    await expect(dialog).toBeVisible();
    await expect(nameField).toHaveValue(SECOND_ORG.name);
    await expect(slugField).toHaveValue(ORG.slug);
    await expect(slugField).toHaveAttribute("aria-invalid", "true");

    // Recoverable: fixing the slug clears the error and the create goes through.
    await slugField.fill(SECOND_ORG.slug);
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(slugField).not.toHaveAttribute("aria-invalid", "true");
    await submit.click();

    await expect(dialog).toBeHidden({ timeout: 15000 });
    await expect(
      sidebar(page).getByRole("button", { name: new RegExp(SECOND_ORG.name) }),
    ).toBeVisible({ timeout: 15000 });
  });

  /**
   * The error belongs to a slug, not to the form. Editing the **name** moves
   * the suggested slug just as surely as editing the slug does, so a refusal
   * raised against the old suggestion must not go on describing the new one —
   * it named a slug that was no longer being submitted, while submit stayed
   * enabled. Only reachable on a still-suggested slug, so this collides
   * without touching the slug field at all.
   */
  test("a collision stops describing a slug the name has moved away from", async ({ page }) => {
    await signIn(page);

    await sidebar(page).getByRole("button", { name: activeOrgName }).click();
    await page.getByRole("menuitem", { name: /create organization/i }).click();

    const dialog = page.getByRole("dialog");
    const nameField = dialog.getByLabel("Name", { exact: true });
    const slugField = dialog.getByLabel("Slug", { exact: true });
    const submit = dialog.getByRole("button", { name: "Create organization" });

    // The name alone suggests a slug that is already taken.
    await nameField.fill(ORG.name);
    await expect(slugField).toHaveValue(ORG.slug);
    await submit.click();
    await expect(dialog.getByRole("alert")).toContainText(/already taken/i, { timeout: 15000 });

    // Renaming moves the suggestion to a free slug; the refusal must go with it.
    await nameField.fill("Southwind Freight");
    await expect(slugField).toHaveValue("southwind-freight");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(slugField).not.toHaveAttribute("aria-invalid", "true");

    // And it comes back if the name lands on the taken slug again, rather than
    // waiting for a submit to rediscover it.
    await nameField.fill(ORG.name);
    await expect(dialog.getByRole("alert")).toContainText(/already taken/i);
  });

  test("an unauthenticated caller cannot create an organization", async ({ request }) => {
    const anonymous = await request.post("/api/auth/organization/create", {
      headers: { "content-type": "application/json", origin: "http://localhost:5173" },
      data: { name: "Hijacked Org", slug: `hijacked-${Date.now()}` },
      failOnStatusCode: false,
    });

    expect(anonymous.status()).toBe(401);
  });

  /**
   * The residual state, and the one the switcher used to lie about.
   *
   * `sessionDatabaseHooks` gives a new session an organization, so this is rare
   * — but not impossible: a session minted before that hook shipped carries
   * `null`, and so does one whose organization was deleted. The switcher used
   * to answer by rendering `organizations[0]`, name **and checkmark**, which
   * claims an organization is active when the session has selected none. A
   * checkmark there means "this is where your writes go".
   *
   * Written straight into D1 because nothing in the product can produce it
   * inside one run — see `clearActiveOrganization`. Kept last in this file: it
   * mutates the session every test above signs into.
   */
  test("a session with no active organization is asked to pick, not given a guess", async ({
    page,
  }) => {
    await signIn(page);
    clearActiveOrganization(USER.email);
    await page.reload();

    const trigger = sidebar(page).getByRole("button", { name: /select organization/i });
    await expect(trigger).toBeVisible({ timeout: 15000 });
    // Not merely unlabelled — no organization's name is being presented as the
    // active one.
    await expect(sidebar(page).getByRole("button", { name: activeOrgName })).toHaveCount(0);

    // Both organizations are still offered, and neither is marked as current.
    // The marker is read from the accessibility tree, not from the icon: the
    // tick is `aria-hidden` and `VisuallyHidden` carries the meaning.
    await trigger.click();
    await expect(page.getByRole("menuitem", { name: new RegExp(ORG.name) })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: new RegExp(SECOND_ORG.name) })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /current organization/i })).toHaveCount(0);
  });
});
