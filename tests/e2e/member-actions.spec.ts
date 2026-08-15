import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { OWNER_MUST_BE_PROMOTED } from "@starter/auth/roles";
import {
  awaitRateLimitWindow,
  clientIp,
  giveMembership,
  giveOrganization,
  invitationRow,
  markEmailVerified,
  memberRole,
  membershipCount,
  readInvitationId,
  setActiveOrganization,
  shortenInvitation,
  waitForHydration,
} from "./helpers";

/**
 * Membership writes on `/dashboard/members` — issue #37.
 *
 * The matrix under test lives in `ORG_CAPABILITIES`
 * (`packages/auth/src/helpers/roles.ts`) and is enforced in two places at once:
 * the page renders from it, and `ORGANIZATION_ROLES` narrows Better Auth's own
 * role table so the endpoints refuse the same things. **The deny cases here go
 * at the endpoint, not at the UI**, and that is the point rather than a
 * shortcut — the page does not render a control the reader lacks the role for,
 * so clicking proves nothing. What has to be proven is that a session cookie
 * and `curl` get the same answer, because the browser holds that cookie and the
 * page is not the boundary.
 *
 * Two of these cases fail against **stock better-auth**, whose `adminAc` grants
 * `member: ["update", "delete"]`: an admin changing a role, and an admin
 * removing somebody. They were seen red against the defaults before the
 * narrowing was kept.
 *
 * **Rate limits.** `/organization/invite-member` sits in the strict `mail`
 * class at three per minute per IP+path, and **refused attempts count too** —
 * the limiter runs in better-auth's router hook, ahead of the handler. So every
 * describe carries its own `clientIp()`, no describe sends more than three, and
 * the one that deliberately provokes a 429 mints an address *inside the test*
 * so that a Playwright retry gets a fresh bucket instead of inheriting a spent
 * one.
 */

const PASSWORD = "actionspassword123";
const RUN = Date.now();

const user = (slug: string, name: string) => ({
  name,
  email: `e2e-act-${slug}-${RUN}@example.com`,
});

/*
 * Named for people, never for roles — an address of `e2e-act-owner-…` satisfies
 * `toContainText("owner")` on its own, and the badge could be missing entirely.
 * The same trap `members.spec.ts` documents.
 */

/** Owns `ORG`. Does the promoting and the removing. */
const NIA = user("nia", "E2E Actions Nia");
/** Admin of `ORG` — may invite and revoke, may not touch membership. */
const OMAR = user("omar", "E2E Actions Omar");
/** Plain member of `ORG`. The deny path for inviting. */
const PIA = user("pia", "E2E Actions Pia");
/** Plain member of `ORG`, and the one who gets promoted then demoted. */
const RAJ = user("raj", "E2E Actions Raj");
/** Plain member of `ORG`, and the one who gets removed. */
const SAM = user("sam", "E2E Actions Sam");
/** Member of `LEAVE_ORG`, alongside its owner. Leaves under their own steam. */
const TOM = user("tom", "E2E Actions Tom");
/** Owns `LEAVE_ORG`, so Tom is never its last owner. */
const UNA = user("una", "E2E Actions Una");
/** Sole owner of `SOLO_ORG`. Every last-owner protection is about them. */
const VIC = user("vic", "E2E Actions Vic");
/** Owns `OTHER_ORG` and nothing else. Every cross-tenant attempt is theirs. */
const WYN = user("wyn", "E2E Actions Wyn");

const ORG = { slug: `actions-org-${RUN}`, name: "Actions Trading" };
const OTHER_ORG = { slug: `actions-other-${RUN}`, name: "Unrelated Holdings" };
const SOLO_ORG = { slug: `actions-solo-${RUN}`, name: "Solo Concern" };
const LEAVE_ORG = { slug: `actions-leave-${RUN}`, name: "Departure Lounge" };

/** `giveOrganization` derives the row id from the slug; restated rather than guessed. */
const orgId = (slug: string) => `e2e-org-${slug}`;

/** An address that is invited and never registers — it only has to be listed. */
const invitee = (label: string) => `e2e-act-inv-${label}-${RUN}@example.com`;

/* --------------------------------- helpers -------------------------------- */

const membersList = (page: Page) => page.getByRole("list", { name: "Members" });
const invitationsList = (page: Page) => page.getByRole("list", { name: "Pending invitations" });
const memberRow = (page: Page, email: string) =>
  membersList(page).getByRole("listitem").filter({ hasText: email });

/**
 * The `Origin` a browser would send, which Playwright's API context does not.
 * Better Auth validates it on any cookie-bearing request, so without it every
 * session-authenticated call answers `403 MISSING_OR_NULL_ORIGIN` — a refusal
 * that would make each deny case below pass for entirely the wrong reason.
 */
const appOrigin = () => new URL(test.info().project.use.baseURL!).origin;

async function createAccount(browser: Browser, account: { name: string; email: string }) {
  const context = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": clientIp() },
  });

  const response = await context.request.post("/api/auth/sign-up/email", {
    data: { name: account.name, email: account.email, password: PASSWORD },
  });
  expect(response.ok(), await response.text()).toBe(true);

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
 * Contexts minted by `signedInRequest`, closed after every test.
 *
 * **Not optional bookkeeping.** Each call opens a real browser context, and a
 * context that is never closed stays open for the whole run — this file makes
 * a dozen of them. Leaked, they exhaust the browser and the *next* spec file
 * fails in its `beforeAll` with "Target page, context or browser has been
 * closed", which reads as a flake in somebody else's test rather than as a leak
 * in this one. It did exactly that before this array existed.
 */
const openContexts: BrowserContext[] = [];

test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close()));
});

/** An API context holding `email`'s session, for the calls a browser would make. */
async function signedInRequest(browser: Browser, email: string): Promise<APIRequestContext> {
  const context = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": clientIp() },
  });
  openContexts.push(context);

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

/**
 * The `member.id` of `email` in a seeded organization, read through the API.
 *
 * **Not derived from the seed helper's id format.** `giveMembership` builds
 * `<org>-member-<role>-<userId>`, so a hand-built id would be wrong the moment
 * a role changes — and better-auth answers an unknown member id with
 * `MEMBER_NOT_FOUND`, which is a 400 that looks enough like a refusal to let a
 * deny-path test pass while proving nothing about permissions at all.
 */
async function findMemberId(
  request: APIRequestContext,
  slug: string,
  email: string,
): Promise<string> {
  const response = await request.get(
    `/api/auth/organization/list-members?organizationId=${orgId(slug)}`,
    { headers: { Origin: appOrigin() } },
  );
  expect(response.ok(), await response.text()).toBe(true);

  const found = (await response.json()).members.find(
    (member: { user: { email: string } }) => member.user.email === email,
  );
  if (!found) throw new Error(`${email} is not a member of ${slug}.`);

  return found.id;
}

test.beforeAll(async ({ browser }) => {
  for (const account of [NIA, OMAR, PIA, RAJ, SAM, TOM, UNA, VIC, WYN]) {
    await createAccount(browser, account);
  }

  giveOrganization(NIA.email, ORG.slug, ORG.name);
  giveMembership(OMAR.email, ORG.slug, "admin");
  giveMembership(PIA.email, ORG.slug, "member");
  giveMembership(RAJ.email, ORG.slug, "member");
  giveMembership(SAM.email, ORG.slug, "member");

  giveOrganization(UNA.email, LEAVE_ORG.slug, LEAVE_ORG.name);
  giveMembership(TOM.email, LEAVE_ORG.slug, "member");

  giveOrganization(VIC.email, SOLO_ORG.slug, SOLO_ORG.name);
  giveOrganization(WYN.email, OTHER_ORG.slug, OTHER_ORG.name);
});

/* ------------------------------- allow paths ------------------------------ */

test.describe("an owner runs the roster from the page", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  /**
   * Promoting twice, and the second step is not padding: `owner` is the role
   * whose toast read "a owner" until the article stopped being a ternary on
   * `admin`. Promoting to owner is also the way out of the last-owner state, so
   * it is the one role change that has to work from somebody else's row.
   */
  test("promotes somebody, and the badge and the sentence both follow", async ({ page }) => {
    await signIn(page, NIA.email);
    await page.goto("/dashboard/members");

    const row = memberRow(page, RAJ.email);
    await expect(row).toContainText("member", { timeout: 15000 });

    async function setRole(to: "Admin" | "Owner") {
      await memberRow(page, RAJ.email)
        .getByRole("button", { name: `Actions for ${RAJ.name}` })
        .click();
      await page.getByRole("menuitem", { name: "Change role" }).click();

      const dialog = page.getByRole("dialog");
      await dialog.getByRole("combobox", { name: "Role" }).click();
      await page.getByRole("option", { name: to }).click();
      await dialog.getByRole("button", { name: "Save role" }).click();
    }

    await setRole("Admin");
    await expect(page.getByText(`${RAJ.name} is now an admin`)).toBeVisible({ timeout: 15000 });
    // The column, not just the pixel — a badge can render from stale props.
    await expect(memberRow(page, RAJ.email)).toContainText("admin");
    expect(memberRole(RAJ.email, ORG.slug)).toBe("admin");

    await setRole("Owner");
    // "an owner", never "a owner".
    await expect(page.getByText(`${RAJ.name} is now an owner`)).toBeVisible({ timeout: 15000 });
    await expect(memberRow(page, RAJ.email)).toContainText("owner");
    expect(memberRole(RAJ.email, ORG.slug)).toBe("owner");
  });

  test("removes somebody, and the row goes with them", async ({ page }) => {
    await signIn(page, NIA.email);
    await page.goto("/dashboard/members");

    const row = memberRow(page, SAM.email);
    await expect(row).toBeVisible({ timeout: 15000 });

    await row.getByRole("button", { name: `Actions for ${SAM.name}` }).click();
    await page.getByRole("menuitem", { name: "Remove from organization" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(SAM.name);
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();

    await expect(memberRow(page, SAM.email)).toHaveCount(0, { timeout: 15000 });
    expect(memberRole(SAM.email, ORG.slug)).toBeNull();
  });

  /**
   * The distinction the whole menu is built on: **rank is omitted, state is
   * explained.**
   *
   * The sole owner is shown both controls that their own row could act on, both
   * disabled, under one shared reason — because being the last owner is a state
   * they can change, and "Change role" is the very control that changes it from
   * somebody else's row. "Remove" stays absent because self-removal is
   * `leave`, which is the third item.
   *
   * Asserting `toBeDisabled` rather than `toHaveCount(0)` is the point: an
   * absent control and a disabled one are both "not clickable", and only this
   * tells them apart.
   */
  test("is told why it cannot demote or leave, rather than shown nothing", async ({ page }) => {
    await signIn(page, VIC.email);
    await page.goto("/dashboard/members");

    const row = memberRow(page, VIC.email);
    await expect(row).toContainText("owner", { timeout: 15000 });
    await row.getByRole("button", { name: `Actions for ${VIC.name}` }).click();

    for (const name of ["Change role", "Leave organization"]) {
      const item = page.getByRole("menuitem", { name });
      await expect(item).toBeVisible();
      await expect(item).toBeDisabled();
    }

    // Self-removal is "leave", so this one is genuinely absent rather than off.
    await expect(page.getByRole("menuitem", { name: "Remove from organization" })).toHaveCount(0);

    // One reason, once — not one per disabled item.
    await expect(page.getByText(/only owner\. Make somebody else an owner first/i)).toHaveCount(1);
  });
});

test.describe("an admin invites and revokes", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  /** One invitation, well inside the `mail` class's three per minute. */
  test("sends an invitation from the page, then withdraws it", async ({ page }) => {
    const email = invitee("omar");

    await signIn(page, OMAR.email);
    await page.goto("/dashboard/members");
    await expect(page.getByRole("heading", { name: "Pending invitations" })).toBeVisible({
      timeout: 15000,
    });

    const invite = page.getByRole("button", { name: /Invite/ }).first();
    await waitForHydration(invite);
    await invite.click();

    const dialog = page.getByRole("dialog");
    const field = dialog.getByRole("textbox", { name: "Email" });
    await waitForHydration(field);
    await field.fill(email);
    await dialog.getByRole("button", { name: "Send invitation" }).click();

    await expect(invitationsList(page)).toContainText(email, { timeout: 15000 });
    const id = readInvitationId(email);
    expect(invitationRow(id).status).toBe("pending");

    // …and back out again.
    const row = invitationsList(page).getByRole("listitem").filter({ hasText: email });
    await row.getByRole("button", { name: `Actions for the invitation to ${email}` }).click();
    await page.getByRole("menuitem", { name: "Revoke invitation" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Revoke", exact: true })
      .click();

    await expect(page.getByText(email)).toHaveCount(0, { timeout: 15000 });
    expect(invitationRow(id).status).toBe("canceled");
  });
});

test.describe("a member who is not the last owner may leave", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  test("leaving drops the membership", async ({ page }) => {
    await signIn(page, TOM.email);
    setActiveOrganization(TOM.email, LEAVE_ORG.slug);
    await page.goto("/dashboard/members");

    const row = memberRow(page, TOM.email);
    await expect(row).toContainText("You", { timeout: 15000 });

    await row.getByRole("button", { name: `Actions for ${TOM.name}` }).click();
    await page.getByRole("menuitem", { name: "Leave organization" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Leave organization" }).click();

    // Leaving reloads rather than revalidating, because it changes which tenant
    // every loader on the page is about.
    await expect.poll(() => memberRole(TOM.email, LEAVE_ORG.slug), { timeout: 15000 }).toBeNull();
    expect(membershipCount(TOM.email)).toBe(0);
  });
});

/* ------------------------------- deny paths ------------------------------- */

/**
 * The matrix, asserted where it is enforced.
 *
 * Every call below carries a real session cookie and goes straight at
 * `/api/auth/organization/*`, which is exactly what a page-less caller does.
 * The UI never offers these, so a click-driven version of this block would
 * assert that a button is missing — true, and no evidence at all about what the
 * server would have done.
 */
test.describe("the endpoint refuses what the matrix refuses", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  test("a plain member cannot invite", async ({ browser }) => {
    const request = await signedInRequest(browser, PIA.email);

    const response = await request.post("/api/auth/organization/invite-member", {
      data: { email: invitee("denied"), role: "member", organizationId: orgId(ORG.slug) },
      headers: { Origin: appOrigin() },
    });

    expect(response.status()).toBe(403);
    expect(await errorCode(response)).toBe(
      "YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION",
    );
  });

  /**
   * Nobody is invited as an owner — and better-auth only closes half of this,
   * refusing a *non*-owner who asks. The caller here is the owner, so the
   * refusal is the `beforeCreateInvitation` hook's and nothing else's.
   */
  test("even an owner cannot invite somebody straight to owner", async ({ browser }) => {
    const request = await signedInRequest(browser, NIA.email);

    const response = await request.post("/api/auth/organization/invite-member", {
      data: { email: invitee("asowner"), role: "owner", organizationId: orgId(ORG.slug) },
      headers: { Origin: appOrigin() },
    });

    expect(response.status()).toBe(403);
    expect(await errorCode(response)).toBe(OWNER_MUST_BE_PROMOTED);
  });

  test("an admin cannot promote anyone to owner", async ({ browser }) => {
    const request = await signedInRequest(browser, OMAR.email);
    const target = await findMemberId(request, ORG.slug, PIA.email);

    const response = await request.post("/api/auth/organization/update-member-role", {
      data: { memberId: target, role: "owner", organizationId: orgId(ORG.slug) },
      headers: { Origin: appOrigin() },
    });

    expect(response.status()).toBe(403);
    expect(await errorCode(response)).toBe("YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER");
    expect(memberRole(PIA.email, ORG.slug)).toBe("member");
  });

  /**
   * The narrowing in `ORGANIZATION_ROLES`, at the only place it can be seen.
   * Stock better-auth grants `adminAc` `member: ["update"]`, so this answers
   * 200 and Pia becomes an admin — it was watched doing exactly that before the
   * override was kept.
   */
  test("an admin cannot change a plain member's role either", async ({ browser }) => {
    const request = await signedInRequest(browser, OMAR.email);
    const target = await findMemberId(request, ORG.slug, PIA.email);

    const response = await request.post("/api/auth/organization/update-member-role", {
      data: { memberId: target, role: "admin", organizationId: orgId(ORG.slug) },
      headers: { Origin: appOrigin() },
    });

    expect(response.status()).toBe(403);
    expect(await errorCode(response)).toBe("YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER");
    expect(memberRole(PIA.email, ORG.slug)).toBe("member");
  });

  /** The other half of the narrowing: `adminAc` grants `member: ["delete"]` too. */
  test("an admin cannot remove a member", async ({ browser }) => {
    const request = await signedInRequest(browser, OMAR.email);
    const target = await findMemberId(request, ORG.slug, PIA.email);

    const response = await request.post("/api/auth/organization/remove-member", {
      data: { memberIdOrEmail: target, organizationId: orgId(ORG.slug) },
      headers: { Origin: appOrigin() },
    });

    expect(response.ok()).toBe(false);
    expect(await errorCode(response)).toBe("YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER");
    expect(memberRole(PIA.email, ORG.slug)).toBe("member");
  });
});

test.describe("the last owner cannot leave the organization without one", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  test("cannot leave, demote themselves, or remove themselves", async ({ browser }) => {
    const request = await signedInRequest(browser, VIC.email);
    const self = await findMemberId(request, SOLO_ORG.slug, VIC.email);

    const leave = await request.post("/api/auth/organization/leave", {
      data: { organizationId: orgId(SOLO_ORG.slug) },
      headers: { Origin: appOrigin() },
    });
    expect(leave.status()).toBe(400);
    expect(await errorCode(leave)).toBe("YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER");

    const demote = await request.post("/api/auth/organization/update-member-role", {
      data: { memberId: self, role: "admin", organizationId: orgId(SOLO_ORG.slug) },
      headers: { Origin: appOrigin() },
    });
    expect(demote.status()).toBe(400);
    expect(await errorCode(demote)).toBe("YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER");

    const remove = await request.post("/api/auth/organization/remove-member", {
      data: { memberIdOrEmail: self, organizationId: orgId(SOLO_ORG.slug) },
      headers: { Origin: appOrigin() },
    });
    expect(remove.ok()).toBe(false);

    // Still there, still an owner, after all three.
    expect(memberRole(VIC.email, SOLO_ORG.slug)).toBe("owner");
  });
});

/**
 * The tenant comes from the caller's own membership, never from the id they
 * sent. Wyn is an owner — of somewhere else — so every refusal below is about
 * the target rather than about their rank.
 */
test.describe("one tenant's owner cannot act on another's", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  test("cannot change a role, remove a member, or revoke an invitation elsewhere", async ({
    browser,
  }) => {
    // Read the targets as somebody who is allowed to see them…
    const insider = await signedInRequest(browser, NIA.email);
    const target = await findMemberId(insider, ORG.slug, PIA.email);

    const email = invitee("crosstenant");
    const invited = await insider.post("/api/auth/organization/invite-member", {
      data: { email, role: "member", organizationId: orgId(ORG.slug) },
      headers: { Origin: appOrigin() },
    });
    expect(invited.ok(), await invited.text()).toBe(true);
    const invitationId = readInvitationId(email);

    // …then try to act on them as somebody who is not.
    const outsider = await signedInRequest(browser, WYN.email);

    const role = await outsider.post("/api/auth/organization/update-member-role", {
      data: { memberId: target, role: "admin", organizationId: orgId(ORG.slug) },
      headers: { Origin: appOrigin() },
    });
    expect(role.ok()).toBe(false);

    const remove = await outsider.post("/api/auth/organization/remove-member", {
      data: { memberIdOrEmail: target, organizationId: orgId(ORG.slug) },
      headers: { Origin: appOrigin() },
    });
    expect(remove.ok()).toBe(false);

    const revoke = await outsider.post("/api/auth/organization/cancel-invitation", {
      data: { invitationId },
      headers: { Origin: appOrigin() },
    });
    expect(revoke.ok()).toBe(false);

    // Nothing moved.
    expect(memberRole(PIA.email, ORG.slug)).toBe("member");
    expect(invitationRow(invitationId).status).toBe("pending");
  });
});

/* --------------------------------- resend --------------------------------- */

test.describe("resending reuses the invitation", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  /**
   * The claim being checked is better-auth's own: `resend: true` on
   * `/organization/invite-member` finds the pending row, updates `expiresAt`
   * and hands the **same id** back to `sendInvitationEmail`. So the link
   * already sitting in somebody's mailbox keeps working, and no second token
   * exists to go stale.
   *
   * The expiry is pulled in to an hour first, and that is what makes the second
   * half an assertion at all: the window is seven days and SQLite stores whole
   * seconds, so creating and resending inside one second leaves `expiresAt`
   * byte-identical and a strict comparison fails on a resend that worked.
   * Pulling it *in* rather than past — `shortenInvitation`, never
   * `expireInvitation` — because better-auth filters expired rows out of
   * `findPendingInvitation` and would mint a second invitation instead.
   */
  test("keeps the id and pushes the expiry out", async ({ browser }) => {
    const email = invitee("resend");
    const request = await signedInRequest(browser, NIA.email);

    const created = await request.post("/api/auth/organization/invite-member", {
      data: { email, role: "member", organizationId: orgId(ORG.slug) },
      headers: { Origin: appOrigin() },
    });
    expect(created.ok(), await created.text()).toBe(true);

    const id = readInvitationId(email);
    shortenInvitation(id);
    const before = invitationRow(id).expiresAt;

    const resent = await request.post("/api/auth/organization/invite-member", {
      data: { email, role: "member", organizationId: orgId(ORG.slug), resend: true },
      headers: { Origin: appOrigin() },
    });
    expect(resent.ok(), await resent.text()).toBe(true);

    // The same row, not a second one — which is what makes the emailed link
    // byte-for-byte the one already sent.
    expect(readInvitationId(email)).toBe(id);
    expect((await resent.json()).id).toBe(id);
    // Strictly later, and back out to the full window rather than nudged.
    expect(invitationRow(id).expiresAt).toBeGreaterThan(before);
    expect(invitationRow(id).status).toBe("pending");
  });
});

/**
 * The `mail` class, seen doing its job.
 *
 * Not an edge case to route around: three invitations a minute is the policy,
 * inviting and resending share the endpoint, and a person sending a handful in
 * one sitting reaches it. What matters is that the refusal is legible rather
 * than looking like a broken feature — the copy comes from
 * `member-action-errors.ts`, which reads the real number out of
 * `RATE_LIMIT_RULES` so it cannot drift from the binding that produced the 429.
 *
 * **The address is minted inside the test**, unlike every other describe here.
 * `retries: 1` would otherwise re-run this against a bucket the first attempt
 * had already spent, and the calls expected to succeed would 429 instead.
 */
test.describe("the mail class bounds invitations", () => {
  test("the fourth invitation in a minute is refused", async ({ browser }) => {
    // Only sleeps in the last seconds of a window. Miniflare's limiter is a
    // fixed window that clears every bucket on the minute boundary, so a
    // sequence straddling one counts from zero and the 429 never arrives.
    await awaitRateLimitWindow(20_000);

    const ip = clientIp();
    const request = await signedInRequest(browser, NIA.email);
    const send = (label: string) =>
      request.post("/api/auth/organization/invite-member", {
        data: { email: invitee(label), role: "member", organizationId: orgId(ORG.slug) },
        headers: { Origin: appOrigin(), "cf-connecting-ip": ip },
      });

    for (const label of ["rate-1", "rate-2", "rate-3"]) {
      const response = await send(label);
      expect(response.ok(), `${label}: ${await response.text()}`).toBe(true);
    }

    expect((await send("rate-4")).status()).toBe(429);
  });
});
