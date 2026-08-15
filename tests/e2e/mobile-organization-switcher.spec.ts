import { test, expect, type Browser, type Page } from "@playwright/test";
import {
  clearActiveOrganization,
  clientIp,
  giveOrganization,
  markEmailVerified,
  setActiveOrganization,
  waitForHydration,
} from "./helpers";

/**
 * Changing the active organization on a phone — issue #54.
 *
 * The switcher lives in `Sidebar`, and `DashboardLayout` renders that sidebar
 * inside a `hidden md:block` wrapper, so at this width it is not on the page at
 * all. Before #54 the mobile topbar's hamburger carried only the navigation
 * links and Sign Out, which meant a phone had **no** control for this anywhere
 * in the dashboard — including on the members page's "not a member of this
 * organization" state, whose entire answer is to switch to another one.
 *
 * **The viewport is the assertion.** Every test in this file passes at desktop
 * width against the broken implementation, because the sidebar is there to
 * satisfy it — which is exactly why the gap survived #34's own e2e coverage.
 * The first thing each test does is assert the sidebar is absent, so the file
 * cannot quietly start testing the desktop control instead.
 *
 * Seeded rather than created through the dialog: the creation path is
 * `organizations.spec.ts`'s subject and is deliberately unseeded there. Here two
 * organizations are scenery for the switch, so writing the rows is the faster
 * way in.
 *
 * **Rate limits.** Each account is registered behind its own `cf-connecting-ip`
 * because `/sign-up/email` sits in the strict `mail` class (3/60s), and the file
 * carries one address of its own for the three sign-ins.
 */

const PASSWORD = "mobileswitchpassword123";
const RUN = Date.now();

/** Owns both organizations below. */
const USER = { name: "E2E Mobile Mo", email: `e2e-mob-mo-${RUN}@example.com` };
/** Belongs to no organization at all — the create path from the same menu. */
const NEWCOMER = { name: "E2E Mobile Nia", email: `e2e-mob-nia-${RUN}@example.com` };

/** Where the session starts… */
const FIRST = { slug: `mobile-first-${RUN}`, name: "Harbour Freight Co" };
/** …and where it is switched to. Names share no word, so a regex cannot match both. */
const SECOND = { slug: `mobile-second-${RUN}`, name: "Beacon Optics" };

/** iPhone-ish, and comfortably below Tailwind's `md` (768px) — the whole point. */
const PHONE = { width: 375, height: 812 };

test.use({ viewport: PHONE, extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

/* --------------------------------- helpers -------------------------------- */

/** The hamburger, which at this width is the only way into any of this. */
const menuButton = (page: Page) => page.getByRole("button", { name: "Open menu" });

/**
 * The row for `organization` in the open menu. The marker it may carry is
 * `VisuallyHidden` text, not the tick — the tick is `aria-hidden`, so a locator
 * that could see it would have to be a CSS selector.
 */
const orgItem = (page: Page, name: string) =>
  page.getByRole("menuitem", { name: new RegExp(name) });
const currentOrgItem = (page: Page, name: string) =>
  page.getByRole("menuitem", { name: new RegExp(`${name}.*current organization`, "i") });

/**
 * Create a verified account through the API, behind an address of its own.
 *
 * Same seam as `members.spec.ts`: the registration form is `auth.spec.ts`'s
 * subject, and these accounts only need to exist.
 */
async function createAccount(browser: Browser, account: { name: string; email: string }) {
  const context = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": clientIp() },
  });

  const response = await context.request.post("/api/auth/sign-up/email", {
    data: { name: account.name, email: account.email, password: PASSWORD },
  });
  expect(response.ok(), await response.text()).toBe(true);

  // `requireEmailVerification` withholds the session, so nothing was minted.
  markEmailVerified(account.email);
  await context.close();
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  const field = page.getByRole("textbox", { name: "Email", exact: true });
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible({ timeout: 15000 });
  await waitForHydration(field);

  await field.fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL("**/dashboard", { timeout: 15000 });
}

/**
 * Assert that the sidebar — and with it the desktop switcher — is genuinely not
 * on the page, so what follows can only be exercising the mobile control.
 *
 * `<aside>` is the `complementary` landmark, and Playwright's role engine skips
 * anything hidden from the accessibility tree, which `display: none` is.
 */
async function expectNoSidebar(page: Page) {
  await expect(page.getByRole("complementary")).toHaveCount(0);
}

test.beforeAll(async ({ browser }) => {
  for (const account of [USER, NEWCOMER]) {
    await createAccount(browser, account);
  }

  giveOrganization(USER.email, FIRST.slug, FIRST.name);
  giveOrganization(USER.email, SECOND.slug, SECOND.name);
});

/* ---------------------------------- specs --------------------------------- */

test.describe("a phone can change the active organization", () => {
  test("the switch happens in the topbar menu, and outlives a reload", async ({ page }) => {
    await signIn(page, USER.email);

    /*
     * `sessionDatabaseHooks` picks the *oldest* membership at sign-in, and two
     * rows seeded in the same second are tied — so this says which organization
     * the session starts in rather than betting on the tie-break.
     */
    setActiveOrganization(USER.email, FIRST.slug);
    await page.reload();

    await expectNoSidebar(page);

    await menuButton(page).click();
    await expect(currentOrgItem(page, FIRST.name)).toBeVisible({ timeout: 15000 });
    await expect(currentOrgItem(page, SECOND.name)).toHaveCount(0);

    /*
     * `switchOrganization` awaits `setActive`, then calls
     * `window.location.reload()`. Waiting for that load before touching the
     * page again is what keeps the next click off a document that is on its way
     * out — and it is also the first proof of persistence, since everything
     * rendered afterwards came back out of the session row in D1.
     */
    const switched = page.waitForEvent("load", { timeout: 15000 });
    await orgItem(page, SECOND.name).click();
    await switched;

    await menuButton(page).click();
    await expect(currentOrgItem(page, SECOND.name)).toBeVisible({ timeout: 15000 });
    await expect(currentOrgItem(page, FIRST.name)).toHaveCount(0);
    // Both are still offered — switching moves the marker, it does not consume
    // the organization that was active.
    await expect(orgItem(page, FIRST.name)).toBeVisible();
    await page.keyboard.press("Escape");

    // An unforced read, on a navigation the switch did not initiate.
    await page.reload();
    await menuButton(page).click();
    await expect(currentOrgItem(page, SECOND.name)).toBeVisible({ timeout: 15000 });
    await page.keyboard.press("Escape");

    /*
     * And the tenant moved, not merely the label. `/dashboard/members` resolves
     * its organization from `session.activeOrganizationId` through
     * `resolveMembership` — a different loader, on a different route, reading
     * the column this wrote.
     */
    await page.goto("/dashboard/members");
    await expect(page.getByText(`Who belongs to ${SECOND.name}`)).toBeVisible({ timeout: 15000 });
  });

  /**
   * The residual state on the surface that has no trigger label to carry it.
   * The sidebar answers this in its button ("Select organization"); the topbar's
   * hamburger is an icon, so the menu is the only place that can be honest — and
   * the thing it must not do is mark a row the session never selected.
   */
  test("a session with no active organization is asked to pick, not given a guess", async ({
    page,
  }) => {
    await signIn(page, USER.email);
    clearActiveOrganization(USER.email);
    await page.reload();

    await expectNoSidebar(page);

    await menuButton(page).click();
    await expect(orgItem(page, FIRST.name)).toBeVisible({ timeout: 15000 });
    await expect(orgItem(page, SECOND.name)).toBeVisible();
    // Read from the accessibility tree, not from the icon: the tick is
    // `aria-hidden` and `VisuallyHidden` carries the meaning.
    await expect(page.getByRole("menuitem", { name: /current organization/i })).toHaveCount(0);
  });
});

/**
 * The Radix trap, on the second surface that can fall into it.
 *
 * `DropdownMenuContent` unmounts on close, so a dialog mounted inside the menu
 * item that opens it goes with the menu and the control opens nothing — a
 * visible control that does not work (issue #16). The dialog is a sibling of the
 * menu in both surfaces; this is the deny path for the mobile one.
 */
test.describe("an account with no organization gets the create path from the same menu", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  test("the menu item opens the dialog, and the dialog survives the menu closing", async ({
    page,
  }) => {
    await signIn(page, NEWCOMER.email);

    await expectNoSidebar(page);

    await menuButton(page).click();
    // No organizations, so no rows and no "Organizations" label to head them —
    // the create item is the whole of that section.
    await expect(page.getByRole("menuitem", { name: /current organization/i })).toHaveCount(0);

    await page.getByRole("menuitem", { name: "Create organization" }).click();

    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("dialog").getByLabel("Name", { exact: true })).toBeVisible();
  });
});
