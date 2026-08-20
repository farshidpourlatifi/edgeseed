import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { invitationAcceptPath } from "../../apps/web/app/lib/auth-redirects";
import {
  awaitRateLimitWindow,
  clientIp,
  markEmailVerified,
  memberRoleIn,
  membershipCount,
  organizationIdOf,
  readInvitationId,
  waitForHydration,
} from "./helpers";
import { grantMcpAccess, startMcpWorker, stopMcpWorker } from "./mcp-client";

/**
 * Two people, one organization, from empty database to last-owner refusal —
 * issue #40, the acceptance test for the organizations epic (#24).
 *
 * **Nothing is seeded.** No `giveOrganization`, no `giveMembership`. Both
 * accounts register through the product, both organizations are created in the
 * dialog, the invitation is minted from the members page and spent from the
 * link a mailbox would have carried. That is the difference between this file
 * and every other organization spec in the suite: `members.spec.ts`,
 * `member-actions.spec.ts` and `organization-api.spec.ts` all write their
 * tenants straight into D1 because seeding is faster than driving a dialog, and
 * each is narrow on purpose. None of them proves the pieces compose.
 *
 * Only three D1 seams are used, and each is one a browser genuinely cannot
 * reach: `markEmailVerified` (the link is emailed, and with no `RESEND_API_KEY`
 * the message only reaches the dev server's log), `readInvitationId` (same
 * reason — the same seam `password-reset.spec.ts` reads its token through), and
 * the read-only assertions that check a column rather than a pixel.
 *
 * **The deny paths are the point, not the epilogue.** They sit in the middle of
 * the story rather than at the end, because they are only meaningful while B is
 * a real, current, plain member of one organization and a stranger to the
 * other — which is a state that exists between accepting and being removed. All
 * three surfaces are asked the same question:
 *
 * - the **UI loader**, fetched as a child on its own with `?_routes=`, because
 *   single fetch would otherwise let the dashboard layout answer for it
 * - the **API**, which takes no organization id at all, so the assertion is
 *   that naming one changes nothing
 * - **MCP**, which is the one surface where an organization id *is* a legal
 *   argument (`apps/mcp/CLAUDE.md`), so it is the one that has to prove a
 *   foreign id and an absent id are indistinguishable
 *
 * **Rate limits.** `/organization/invite-member` is `mail` class, three per
 * minute per IP+path, and refused attempts count too. This file mints two
 * invitations, both from the page, and opens each with `awaitRateLimitWindow`
 * so a send cannot straddle a wall-clock minute boundary.
 */

const PASSWORD = "lifecyclepassword123";
const RUN = Date.now();

/*
 * Named for people, never for roles: an address of `e2e-life-owner-…` satisfies
 * `toContainText("owner")` on its own, so the badge could be missing entirely
 * and the assertion would still pass. Same trap `members.spec.ts` documents.
 */

/** User A. Creates both organizations, and runs the roster. */
const MAYA = { name: "E2E Lifecycle Maya", email: `e2e-life-maya-${RUN}@example.com` };
/** User B. Invited, joins, is promoted, demoted, leaves, returns, is removed. */
const NOAH = { name: "E2E Lifecycle Noah", email: `e2e-life-noah-${RUN}@example.com` };

/** The organization the two share. */
const HOME = { name: `Lifecycle Home ${RUN}`, slug: `lifecycle-home-${RUN}` };
/** Maya's other organization. Noah is never in it — every deny path aims here. */
const PRIVATE = { name: `Lifecycle Private ${RUN}`, slug: `lifecycle-private-${RUN}` };

/** Resolved once both organizations exist; better-auth mints these, not the suite. */
let homeId: string;
let privateId: string;

/* --------------------------------- helpers -------------------------------- */

const sidebar = (page: Page) => page.getByRole("complementary");
const content = (page: Page) => page.getByRole("main");
const membersList = (page: Page) => page.getByRole("list", { name: "Members" });
const memberRow = (page: Page, email: string) =>
  membersList(page).getByRole("listitem").filter({ hasText: email });

/**
 * The `Origin` a browser would send, which Playwright's API context does not.
 * Better Auth validates it on any cookie-bearing request, and the API's own
 * CSRF guard wants a same-origin signal on every unsafe method — without it the
 * reads below would answer 403 and every assertion would hold for the wrong
 * reason.
 */
const appOrigin = () => new URL(test.info().project.use.baseURL!).origin;

async function register(page: Page, account: { name: string; email: string }) {
  await page.goto("/register");
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(name).toBeVisible({ timeout: 15000 });
  await waitForHydration(name);

  await name.fill(account.name);
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create Account" }).click();

  // No session yet — `requireEmailVerification` withholds it until the address
  // is proven, which is the gate standing concern #1 rests on.
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
    timeout: 15000,
  });
  markEmailVerified(account.email);
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

/** Create an organization from the dialog, wherever the account's current one opens it. */
async function createOrganization(page: Page, org: { name: string; slug: string }) {
  const dialog = page.getByRole("dialog");
  const nameField = dialog.getByLabel("Name", { exact: true });
  const slugField = dialog.getByLabel("Slug", { exact: true });

  await nameField.fill(org.name);
  // Stated rather than trusted to the suggestion: the slug is this suite's
  // handle on an id better-auth mints, so it is the one field that must not
  // drift with however `slugify` treats a name.
  await slugField.fill(org.slug);
  await dialog.getByRole("button", { name: "Create organization" }).click();

  await expect(dialog).toBeHidden({ timeout: 15000 });
  await expect(sidebar(page).getByRole("button", { name: new RegExp(org.name) })).toBeVisible({
    timeout: 15000,
  });
}

/**
 * Make `org` the session's active organization, through the switcher.
 *
 * **Selecting is a navigation, not a revalidation.** `switchOrganization` ends
 * in `window.location.reload()` rather than `revalidate()`, because changing
 * tenant changes what every loader on the page is about. So the click has to be
 * awaited as a load: without that, the very next `page.goto` is issued while
 * the reload is in flight, the browser cancels it, and Playwright reports
 * `net::ERR_ABORTED` — which reads like a server fault and is not one.
 *
 * Waiting on the switcher's label alone is not enough, since the trigger
 * already carries the new name before the reload lands.
 */
async function switchTo(page: Page, org: { name: string }) {
  const trigger = sidebar(page).getByRole("button", { name: /Lifecycle (Home|Private)/ });
  await waitForHydration(trigger);
  await trigger.click();

  await Promise.all([
    page.waitForEvent("load", { timeout: 15000 }),
    page.getByRole("menuitem", { name: org.name }).click(),
  ]);

  await expect(sidebar(page).getByRole("button", { name: new RegExp(org.name) })).toBeVisible({
    timeout: 15000,
  });
}

/**
 * Send an invitation from the members page, as a reader does.
 *
 * Opens the `mail` window first: locally the limiter is a **fixed** 60s window
 * that clears every bucket when the minute ticks over, so a send that straddles
 * the boundary is charged to a window the next assertion no longer shares.
 */
async function invite(page: Page, email: string) {
  await awaitRateLimitWindow();

  const open = page.getByRole("button", { name: /Invite/ }).first();
  await waitForHydration(open);
  await open.click();

  const dialog = page.getByRole("dialog");
  const field = dialog.getByRole("textbox", { name: "Email" });
  await waitForHydration(field);
  await field.fill(email);
  await dialog.getByRole("button", { name: "Send invitation" }).click();

  await expect(page.getByRole("list", { name: "Pending invitations" })).toContainText(email, {
    timeout: 15000,
  });

  return readInvitationId(email);
}

/** Spend an invitation as its real recipient, from the link a mailbox carried. */
async function accept(page: Page, invitationId: string) {
  await page.goto(invitationAcceptPath(invitationId));
  await expect(page.getByRole("heading", { name: `Join ${HOME.name}` })).toBeVisible({
    timeout: 15000,
  });

  await page.getByRole("button", { name: "Accept invitation" }).click();
  await page.waitForURL("**/dashboard", { timeout: 15000 });
}

/** A request context holding `email`'s session, for the calls a page-less client makes. */
async function signedInRequest(browser: Browser, email: string): Promise<APIRequestContext> {
  const context = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": clientIp() },
  });

  const response = await context.request.post("/api/auth/sign-in/email", {
    data: { email, password: PASSWORD },
    headers: { Origin: appOrigin() },
  });
  expect(response.ok(), await response.text()).toBe(true);

  return context.request;
}

/** The refusal's code, for asserting on *why* rather than only on the status. */
async function errorCode(response: { text(): Promise<string> }): Promise<string | undefined> {
  try {
    return JSON.parse(await response.text())?.code;
  } catch {
    return undefined;
  }
}

/* ---------------------------------- spec ---------------------------------- */

test.describe("two people run an organization from an empty database", () => {
  // Every step depends on the one before it: this is one story told in named
  // pieces, not a set of independent cases.
  test.describe.configure({ mode: "serial" });
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  /*
   * Playwright's 30s default is a budget for *one* interaction, and no step in
   * this file is one interaction: the shortest drives a sign-in, a tenant
   * switch that reloads the page, and a dialog round trip, while the invite
   * steps register a second account in a second browser context and spend an
   * invitation on top. Several also open with `awaitRateLimitWindow`, which
   * sleeps up to five seconds by design.
   *
   * At 30s they pass on an idle machine and time out on a loaded one — a flake
   * that reads as a product regression and is not. Raised for the whole
   * describe rather than sprinkled per test, because the reason is the same
   * everywhere; the MCP case raises it further still, for a reason of its own.
   */
  test.beforeEach(() => {
    test.setTimeout(90_000);
  });

  test("A registers and creates the organization the two will share", async ({ page }) => {
    await register(page, MAYA);
    await signIn(page, MAYA.email);

    // The zero-organization state: a card that offers the path rather than a
    // blank switcher. `organizations.spec.ts` owns this screen's detail; here
    // it is the starting line.
    await expect(content(page).getByText(/create your first organization/i)).toBeVisible({
      timeout: 15000,
    });
    const firstRun = content(page).getByRole("button", { name: "Create organization" });
    await waitForHydration(firstRun);
    await firstRun.click();

    await createOrganization(page, HOME);

    homeId = organizationIdOf(HOME.slug)!;
    expect(homeId, `no organization row for ${HOME.slug}`).toBeTruthy();
    // Created it, therefore owns it — better-auth writes the owner membership,
    // and the whole last-owner half of this file rests on that being true.
    expect(memberRoleIn(MAYA.email, homeId)).toBe("owner");
  });

  test("A creates a second organization B will never belong to", async ({ page }) => {
    await signIn(page, MAYA.email);

    // With one organization already, the create action lives in the switcher.
    await sidebar(page)
      .getByRole("button", { name: new RegExp(HOME.name) })
      .click();
    await page.getByRole("menuitem", { name: /create organization/i }).click();
    await createOrganization(page, PRIVATE);

    privateId = organizationIdOf(PRIVATE.slug)!;
    expect(privateId, `no organization row for ${PRIVATE.slug}`).toBeTruthy();
    expect(privateId).not.toBe(homeId);
    expect(memberRoleIn(MAYA.email, privateId)).toBe("owner");
  });

  test("A invites B, and B accepts through the link from the invitation mail", async ({
    browser,
    page,
  }) => {
    await signIn(page, MAYA.email);
    // Creating `PRIVATE` made it active (better-auth's own create path does
    // that), so the invitation would otherwise land in the wrong tenant.
    await switchTo(page, HOME);
    await page.goto("/dashboard/members");

    const invitationId = await invite(page, NOAH.email);

    // B arrives with no account at all, which is the state a real invitee is in.
    const context = await browser.newContext({
      extraHTTPHeaders: { "cf-connecting-ip": clientIp() },
    });
    const noah = await context.newPage();
    await register(noah, NOAH);
    await signIn(noah, NOAH.email);

    await accept(noah, invitationId);

    // Joining set it active — nothing in the app calls `setActive` here, so the
    // switcher rendering it means better-auth's accept path did.
    await expect(sidebar(noah).getByRole("button", { name: new RegExp(HOME.name) })).toBeVisible({
      timeout: 15000,
    });
    expect(memberRoleIn(NOAH.email, homeId)).toBe("member");
    expect(membershipCount(NOAH.email)).toBe(1);

    await context.close();
  });

  /* ------------------------------ tenant isolation ----------------------------- */

  test("B's own dashboard loader never answers with A's other organization", async ({
    browser,
  }) => {
    const noah = await signedInRequest(browser, NOAH.email);

    /*
     * `?_routes=` asks for the members loader **alone**. Without it single
     * fetch resolves the dashboard layout too, and the layout's own scoping
     * would satisfy the assertion while the child was wide open — the shape of
     * audit #10, applied to tenancy instead of authentication.
     *
     * The query string names the other organization on purpose. The loader
     * takes its tenant from the session and nothing else, so a caller who
     * *does* know a foreign id must get exactly the answer they would have got
     * without it.
     */
    const body = await (
      await noah.get(
        `/dashboard/members.data?_routes=routes%2Fdashboard.members&organizationId=${privateId}`,
      )
    ).text();

    expect(body).toContain(homeId);
    expect(body).toContain(MAYA.email);
    expect(body).not.toContain(privateId);
    expect(body).not.toContain(PRIVATE.name);
  });

  test("B's API reads are scoped to their organization, and naming another changes nothing", async ({
    browser,
  }) => {
    const noah = await signedInRequest(browser, NOAH.email);

    // The route takes no organization id — the tenant is the principal's — so
    // sending one is the sharpest way to state that it is not an input.
    const scoped = await noah.get(`/api/v1/organization?organizationId=${privateId}`);
    expect(scoped.ok(), await scoped.text()).toBe(true);

    const organization = await scoped.json();
    expect(organization.id).toBe(homeId);
    expect(organization.role).toBe("member");

    const listed = await noah.get(`/api/v1/organization/members?organizationId=${privateId}`);
    expect(listed.ok(), await listed.text()).toBe(true);

    // `/api/v1` flattens the member — `email` at the top level — where Better
    // Auth's own `list-members` nests it under `user`. Two shapes, and the API
    // is the one under test here.
    const { members } = await listed.json();
    expect(members.map((member: { email: string }) => member.email).sort()).toEqual(
      [MAYA.email, NOAH.email].sort(),
    );

    // A plain member may not read invited addresses — the capability, not the
    // tenant, and asserted here because the two refusals must not be confused.
    const invitations = await noah.get("/api/v1/organization/invitations");
    expect(invitations.status()).toBe(403);
  });

  test("B's MCP grant refuses A's other organization exactly as it refuses one that does not exist", async ({
    page,
  }) => {
    /*
     * Longer than Playwright's 30s default, and not because anything here is
     * slow to assert. Booting the MCP Worker compiles it and opens a Durable
     * Object namespace, and `wrangler dev` then spends a further stretch on the
     * first request it serves — measured at ~12s before a byte of the OAuth
     * flow moves. The grant itself is two page loads, a code exchange and an
     * `initialize` before the first tool call.
     */
    test.setTimeout(240_000);

    /*
     * Booted here rather than by `playwright.config.ts`, and only for this one
     * spec — `startMcpWorker` carries the reason. `afterAll` stops it.
     */
    await startMcpWorker();

    const mcp = await grantMcpAccess(page, { email: NOAH.email, password: PASSWORD });

    // The grant resolves to B, not to whoever the client says it is. Nothing
    // before this file proved that: the tool unit tests hand themselves a
    // `ctx.user`, so the step from an OAuth grant to a `userId` was untested.
    const who = await mcp.callTool("whoami");
    expect(who.isError).toBe(false);
    expect(who.json).toMatchObject({ email: NOAH.email });

    // The tool with no target, and the only place a client learns an id it may
    // legitimately aim at. A's other organization is not in it.
    const organizations = await mcp.callTool("list_organizations");
    expect(organizations.isError).toBe(false);
    const ids = (organizations.json as { organizations: { id: string }[] }).organizations.map(
      (org) => org.id,
    );
    expect(ids).toEqual([homeId]);

    // The allow path, so the two refusals below are not vacuous.
    const own = await mcp.callTool("list_members", { organizationId: homeId });
    expect(own.isError).toBe(false);
    expect(own.text).toContain(MAYA.email);

    /*
     * The property this whole test exists for. `reject.ts` gives a foreign
     * organization and a nonexistent one the **identical** sentence, so that an
     * id cannot be used as an oracle for probing another tenant — the same
     * collapse `/api/v1` performs with its 404s. Compared rather than matched
     * against a literal: two messages that merely both mention membership would
     * still leak the difference.
     */
    const foreign = await mcp.callTool("list_members", { organizationId: privateId });
    const absent = await mcp.callTool("list_members", {
      organizationId: `no-such-organization-${RUN}`,
    });

    expect(foreign.isError).toBe(true);
    expect(absent.isError).toBe(true);
    expect(foreign.text).toBe(absent.text);
    expect(foreign.text).not.toContain(PRIVATE.name);
    expect(foreign.text).not.toContain(MAYA.email);

    // And the same for the reader of invited addresses, which is gated twice —
    // once on membership, once on the role.
    const foreignInvitations = await mcp.callTool("list_invitations", {
      organizationId: privateId,
    });
    const absentInvitations = await mcp.callTool("list_invitations", {
      organizationId: `no-such-organization-${RUN}`,
    });
    expect(foreignInvitations.isError).toBe(true);
    expect(foreignInvitations.text).toBe(absentInvitations.text);
  });

  /* -------------------------------- the roster -------------------------------- */

  test("A promotes B to admin, then demotes them back to member", async ({ page }) => {
    await signIn(page, MAYA.email);
    await switchTo(page, HOME);
    await page.goto("/dashboard/members");

    async function setRole(to: "Admin" | "Member") {
      await memberRow(page, NOAH.email)
        .getByRole("button", { name: `Actions for ${NOAH.name}` })
        .click();
      await page.getByRole("menuitem", { name: "Change role" }).click();

      const dialog = page.getByRole("dialog");
      await dialog.getByRole("combobox", { name: "Role" }).click();
      await page.getByRole("option", { name: to }).click();
      await dialog.getByRole("button", { name: "Save role" }).click();

      // The write finishes before the dialog goes; a dialog still on screen
      // means the success path stopped short.
      await expect(dialog).toBeHidden({ timeout: 15000 });
    }

    await setRole("Admin");
    await expect(memberRow(page, NOAH.email)).toContainText("admin", { timeout: 15000 });
    expect(memberRoleIn(NOAH.email, homeId)).toBe("admin");

    await setRole("Member");
    await expect(memberRow(page, NOAH.email)).toContainText("member", { timeout: 15000 });
    expect(memberRoleIn(NOAH.email, homeId)).toBe("member");
  });

  test("B leaves under their own steam", async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { "cf-connecting-ip": clientIp() },
    });
    const noah = await context.newPage();

    await signIn(noah, NOAH.email);
    await noah.goto("/dashboard/members");

    const row = memberRow(noah, NOAH.email);
    await expect(row).toContainText("You", { timeout: 15000 });

    await row.getByRole("button", { name: `Actions for ${NOAH.name}` }).click();
    await noah.getByRole("menuitem", { name: "Leave organization" }).click();
    await noah.getByRole("alertdialog").getByRole("button", { name: "Leave organization" }).click();

    // Leaving reloads rather than revalidating, because it changes which tenant
    // every loader on the page is about — so the column is polled, not read once.
    await expect.poll(() => memberRoleIn(NOAH.email, homeId), { timeout: 15000 }).toBeNull();
    expect(membershipCount(NOAH.email)).toBe(0);

    await context.close();
  });

  test("A invites B back, and removes them from the roster", async ({ browser, page }) => {
    await signIn(page, MAYA.email);
    await switchTo(page, HOME);
    await page.goto("/dashboard/members");

    // A second invitation to the same address is legal precisely because they
    // left: better-auth refuses one aimed at a current member.
    const invitationId = await invite(page, NOAH.email);

    const context = await browser.newContext({
      extraHTTPHeaders: { "cf-connecting-ip": clientIp() },
    });
    const noah = await context.newPage();
    await signIn(noah, NOAH.email);
    await accept(noah, invitationId);
    expect(memberRoleIn(NOAH.email, homeId)).toBe("member");
    await context.close();

    await page.goto("/dashboard/members");
    const row = memberRow(page, NOAH.email);
    await expect(row).toBeVisible({ timeout: 15000 });

    await row.getByRole("button", { name: `Actions for ${NOAH.name}` }).click();
    await page.getByRole("menuitem", { name: "Remove from organization" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(NOAH.name);
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();

    // The row's absence, and the column's — a list re-rendering without somebody
    // could equally be a pagination accident.
    await expect(memberRow(page, NOAH.email)).toHaveCount(0, { timeout: 15000 });
    expect(memberRoleIn(NOAH.email, homeId)).toBeNull();
  });

  /* ---------------------------- last-owner protection --------------------------- */

  /**
   * The state is **reached**, not seeded, which is the whole reason this case
   * is worth having twice: `member-actions.spec.ts` asserts the same three
   * refusals against an organization written into D1 as a sole-owner tenant,
   * where being the last owner was true from the first row. Here it became true
   * because the other person left and then was removed — the path a real
   * organization takes to get there.
   *
   * Driven at the endpoint rather than through the menu on purpose: the page
   * disables those controls, so a click-driven version would assert that a
   * button is off and say nothing about what the server would have answered.
   */
  test("A is now the last owner, and is refused every way out", async ({ browser, page }) => {
    expect(memberRoleIn(MAYA.email, homeId)).toBe("owner");

    const maya = await signedInRequest(browser, MAYA.email);

    const listed = await maya.get(`/api/auth/organization/list-members?organizationId=${homeId}`, {
      headers: { Origin: appOrigin() },
    });
    expect(listed.ok(), await listed.text()).toBe(true);
    const self = (await listed.json()).members.find(
      (member: { user: { email: string } }) => member.user.email === MAYA.email,
    ).id;

    const leave = await maya.post("/api/auth/organization/leave", {
      data: { organizationId: homeId },
      headers: { Origin: appOrigin() },
    });
    expect(leave.status()).toBe(400);
    expect(await errorCode(leave)).toBe("YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER");

    const demote = await maya.post("/api/auth/organization/update-member-role", {
      data: { memberId: self, role: "admin", organizationId: homeId },
      headers: { Origin: appOrigin() },
    });
    expect(demote.status()).toBe(400);
    expect(await errorCode(demote)).toBe("YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER");

    const remove = await maya.post("/api/auth/organization/remove-member", {
      data: { memberIdOrEmail: self, organizationId: homeId },
      headers: { Origin: appOrigin() },
    });
    expect(remove.ok()).toBe(false);

    // Still there, still an owner, after all three.
    expect(memberRoleIn(MAYA.email, homeId)).toBe("owner");

    // And the page says why rather than silently offering nothing — the
    // distinction the menu is built on: rank is omitted, state is explained.
    await signIn(page, MAYA.email);
    await switchTo(page, HOME);
    await page.goto("/dashboard/members");

    await memberRow(page, MAYA.email)
      .getByRole("button", { name: `Actions for ${MAYA.name}` })
      .click();
    for (const name of ["Change role", "Leave organization"]) {
      await expect(page.getByRole("menuitem", { name })).toBeDisabled();
    }
    await expect(page.getByText(/only owner\. Make somebody else an owner first/i)).toHaveCount(1);
  });

  // Unconditional: `startMcpWorker` is a no-op when it never ran, and a Worker
  // left holding port 8788 and the shared D1 breaks the *next* run in a way
  // that looks nothing like a leak.
  test.afterAll(async () => {
    await stopMcpWorker();
  });
});
