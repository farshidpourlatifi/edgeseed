import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import {
  clientIp,
  expireInvitation,
  fillOrganization,
  giveMembership,
  giveOrganization,
  markEmailVerified,
  readInvitationId,
  removeMembership,
  setActiveOrganization,
  waitForHydration,
} from "./helpers";

/**
 * The organization members page — issue #36.
 *
 * Read-only: invite, resend, revoke, change-role, remove and leave are #37, so
 * nothing here clicks anything that mutates. What it does assert is the three
 * properties the page has to hold on its own.
 *
 * **Bounded.** Every list is one page of at most `PAGE_SIZE` rows, because D1
 * bills rows scanned. An organization is filled past that boundary with
 * synthetic members precisely so the assertion is not vacuous — with three
 * people in it, an unbounded list and a paginated one look identical.
 *
 * **Org-scoped.** Every query is keyed on the caller's own membership, never on
 * anything they sent. The isolation block signs in as a second tenant's owner
 * and asserts the first tenant's people and invited addresses are absent —
 * absent from the page, not merely from the visible portion of it.
 *
 * **Invited addresses are admin-only.** A plain member sees the roster and no
 * invitations section at all. That is the deny path for the one piece of data
 * here that is not already common knowledge inside the organization.
 *
 * **Pending means usable.** One of the two invitations is pushed past its
 * expiry, and nothing in better-auth flips `status` when that happens — so the
 * row is still `pending` in D1 and has to be filtered out on `expiresAt`.
 *
 * The unauthenticated deny path lives in `loader-guards.spec.ts`, where the
 * child-only `?_routes=` vector already has its harness.
 *
 * **Rate limits.** Every describe carries its own client address and signs in
 * no more than three times, since `/sign-in/email` allows ten per minute per
 * IP+path. Account creation gets an address *per account*: `/sign-up/email`
 * sits in the strict `mail` class at three per minute, and this file creates
 * five. Both invitations are minted in `beforeAll` rather than per test, so the
 * `mail` bucket for `/organization/invite-member` stays at two of its three.
 */

const PASSWORD = "memberspassword123";
const RUN = Date.now();

const user = (slug: string, name: string) => ({
  name,
  email: `e2e-mem-${slug}-${RUN}@example.com`,
});

/*
 * Named for people rather than for their roles, deliberately. A row asserted to
 * contain "owner" proves nothing when the address in it is
 * `e2e-mem-owner-…@example.com` — the assertion passes on the email and the
 * badge could be missing entirely. No name or address below contains a role
 * word, so `toContainText("owner")` can only be satisfied by the badge.
 */

/** Owns `ORG`, and the only account here that sends anything. */
const ANA = user("ana", "E2E Members Ana");
/** Admin of `ORG` — sees invitations, as the owner does. */
const BEN = user("ben", "E2E Members Ben");
/** Plain member of `ORG` — the deny path for the invitations list. */
const CAI = user("cai", "E2E Members Cai");
/** Owns `OTHER_ORG` and belongs to nothing else. The second tenant. */
const DIA = user("dia", "E2E Members Dia");
/** Belongs to no organization at all — the first-run empty state. */
const EWA = user("ewa", "E2E Members Ewa");
/** Removed from their **only** organization, mid-session. Belongs nowhere after. */
const HAL = user("hal", "E2E Members Hal");
/** Removed from the organization their session names, but still in another. */
const IVY = user("ivy", "E2E Members Ivy");

/** Invited, never registered: an address on `ORG`'s pending list and nothing more. */
const INVITEE = `e2e-mem-fin-${RUN}@example.com`;
/** Invited and left to go stale. Still `status = 'pending'` in D1, and unusable. */
const EXPIRED_INVITEE = `e2e-mem-gus-${RUN}@example.com`;

const ORG = { slug: `members-org-${RUN}`, name: "Members Trading" };
const OTHER_ORG = { slug: `members-other-${RUN}`, name: "Unrelated Holdings" };
/** `HAL`'s only organization, and the one they are removed from. */
const SOLE_ORG = { slug: `members-sole-${RUN}`, name: "Sole Concern" };
/** `IVY` is removed from this one… */
const LEFT_ORG = { slug: `members-left-${RUN}`, name: "Departed Devices" };
/** …and keeps this one. */
const KEPT_ORG = { slug: `members-kept-${RUN}`, name: "Retained Robotics" };

/** `giveOrganization` derives the row id from the slug; restated rather than guessed. */
const orgId = (slug: string) => `e2e-org-${slug}`;

/**
 * Synthetic members, enough to push `ORG` past one page.
 *
 * `PAGE_SIZE` is 20 (`app/lib/pagination.ts`). Twenty fillers plus the three
 * real accounts is 23 — two pages, with a short second one, which is the shape
 * that catches an off-by-one at the boundary.
 */
const FILLERS = 20;
const REAL_MEMBERS = 3;
const TOTAL_MEMBERS = FILLERS + REAL_MEMBERS;

/* --------------------------------- helpers -------------------------------- */

const membersList = (page: Page) => page.getByRole("list", { name: "Members" });
const invitationsList = (page: Page) => page.getByRole("list", { name: "Pending invitations" });
const memberRow = (page: Page, email: string) =>
  membersList(page).getByRole("listitem").filter({ hasText: email });

/** The heading of the invitations card, which is absent for a plain member. */
const invitationsHeading = (page: Page) =>
  page.getByRole("heading", { name: "Pending invitations" });

/**
 * Create a verified account through the API, behind an address of its own.
 *
 * The registration form is `auth.spec.ts`'s subject; these accounts only need
 * to exist. Each gets its own `cf-connecting-ip` because `/sign-up/email` is
 * rate-limited in the `mail` class.
 */
async function createAccount(browser: Browser, account: { name: string; email: string }) {
  const context = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": clientIp() },
  });

  const response = await context.request.post("/api/auth/sign-up/email", {
    data: { name: account.name, email: account.email, password: PASSWORD },
  });
  expect(response.ok(), await response.text()).toBe(true);

  // `requireEmailVerification` withholds the session, so no session was minted.
  markEmailVerified(account.email);
  await context.close();
}

/**
 * The `Origin` a browser would send, which Playwright's API context does not.
 * Better Auth validates it on any cookie-bearing request, so without it every
 * session-authenticated call answers `403 MISSING_OR_NULL_ORIGIN`.
 */
const appOrigin = () => new URL(test.info().project.use.baseURL!).origin;

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

/** Mint an invitation through Better Auth's own endpoint, and return its id. */
async function invite(request: APIRequestContext, email: string, organizationSlug: string) {
  const response = await request.post("/api/auth/organization/invite-member", {
    data: { email, role: "member", organizationId: orgId(organizationSlug) },
    headers: { Origin: appOrigin() },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return readInvitationId(email);
}

test.beforeAll(async ({ browser }) => {
  for (const account of [ANA, BEN, CAI, DIA, EWA, HAL, IVY]) {
    await createAccount(browser, account);
  }

  giveOrganization(ANA.email, ORG.slug, ORG.name);
  giveMembership(BEN.email, ORG.slug, "admin");
  giveMembership(CAI.email, ORG.slug, "member");
  fillOrganization(ORG.slug, `e2e-mem-fill-${RUN}`, FILLERS);

  giveOrganization(DIA.email, OTHER_ORG.slug, OTHER_ORG.name);

  // The two removal cases get organizations of their own, so removing a
  // membership below cannot disturb what any other block is asserting on.
  giveOrganization(HAL.email, SOLE_ORG.slug, SOLE_ORG.name);
  giveOrganization(IVY.email, LEFT_ORG.slug, LEFT_ORG.name);
  giveOrganization(IVY.email, KEPT_ORG.slug, KEPT_ORG.name);

  // Two invitations, sent once and read by every block below — well inside the
  // `mail` class's three per minute, and behind an address of their own.
  const context = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": clientIp() },
  });
  const signedIn = await context.request.post("/api/auth/sign-in/email", {
    data: { email: ANA.email, password: PASSWORD },
    headers: { Origin: appOrigin() },
  });
  expect(signedIn.ok(), await signedIn.text()).toBe(true);

  await invite(context.request, INVITEE, ORG.slug);

  /*
   * The second one is pushed past its expiry. Nothing ever flips `status` —
   * better-auth re-checks `expiresAt` on accept and refuses there — so this row
   * stays `pending` in D1 forever, and a list filtered on status alone would go
   * on offering a link that cannot be used.
   */
  expireInvitation(await invite(context.request, EXPIRED_INVITEE, ORG.slug));
  await context.close();
});

/* ---------------------------------- specs --------------------------------- */

test.describe("an admin reads the organization's people", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  test("the owner sees members with their roles, and the pending invitation", async ({ page }) => {
    await signIn(page, ANA.email);
    await page.goto("/dashboard/members");

    await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible({
      timeout: 15000,
    });

    // Roles come from the `member` rows, so each badge is a fact about the
    // organization rather than about whoever is looking.
    await expect(memberRow(page, ANA.email)).toContainText("owner");
    await expect(memberRow(page, BEN.email)).toContainText("admin");
    await expect(memberRow(page, CAI.email)).toContainText("member");

    // And the viewer can find themselves in a list of similar names.
    await expect(memberRow(page, ANA.email)).toContainText("You");

    await expect(invitationsList(page).getByRole("listitem")).toHaveCount(1);
    await expect(invitationsList(page)).toContainText(INVITEE);
  });

  /**
   * An expired invitation is still `status = 'pending'` in D1 — better-auth
   * never writes the column, it re-checks `expiresAt` on accept and refuses
   * there. So a list filtered on status alone shows a link nobody can use, and
   * pages a tail of them that only ever grows. The count above is half of this
   * assertion; the absence below is the other half.
   */
  test("an expired invitation is neither listed nor counted", async ({ page }) => {
    await signIn(page, ANA.email);
    await page.goto("/dashboard/members");

    await expect(invitationsList(page)).toContainText(INVITEE, { timeout: 15000 });
    await expect(page.getByText(EXPIRED_INVITEE)).toHaveCount(0);
    await expect(invitationsList(page).getByRole("listitem")).toHaveCount(1);
  });

  test("an admin sees the same page as the owner", async ({ page }) => {
    await signIn(page, BEN.email);
    await page.goto("/dashboard/members");

    await expect(memberRow(page, ANA.email)).toContainText("owner", { timeout: 15000 });
    await expect(invitationsList(page)).toContainText(INVITEE);
  });

  test("the sidebar offers the page from anywhere in the dashboard", async ({ page }) => {
    await signIn(page, ANA.email);

    await page.getByRole("complementary").getByRole("link", { name: "Members" }).click();

    await page.waitForURL(/\/dashboard\/members$/, { timeout: 15000 });
    await expect(membersList(page)).toBeVisible();
  });
});

/**
 * The deny path for the one piece of data on this page that is not already
 * visible to everyone in the organization. A plain member gets no invitations
 * section — the loader does not read the rows at all, so there is nothing on
 * the page to hide.
 */
test.describe("a plain member sees the roster and no invited addresses", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  test("the invitations section is absent, not empty", async ({ page }) => {
    await signIn(page, CAI.email);
    await page.goto("/dashboard/members");

    await expect(memberRow(page, ANA.email)).toContainText("owner", { timeout: 15000 });

    await expect(invitationsHeading(page)).toHaveCount(0);
    await expect(invitationsList(page)).toHaveCount(0);
    // The address itself, not just the section that would frame it.
    await expect(page.getByText(INVITEE)).toHaveCount(0);
  });
});

test.describe("the member list is bounded", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  test("a page holds at most PAGE_SIZE rows, and the rest are a click away", async ({ page }) => {
    await signIn(page, ANA.email);
    await page.goto("/dashboard/members");

    // The whole point: 23 members, 20 rows. An unbounded list renders 23 here
    // and this file would otherwise pass with the `limit` deleted.
    await expect(membersList(page).getByRole("listitem")).toHaveCount(20, { timeout: 15000 });
    await expect(page.getByText(`Page 1 of 2 · ${TOTAL_MEMBERS} members`)).toBeVisible();

    await page.getByRole("link", { name: "Next page of members" }).click();

    await page.waitForURL(/\/dashboard\/members\?members=2$/, { timeout: 15000 });
    await expect(membersList(page).getByRole("listitem")).toHaveCount(TOTAL_MEMBERS - 20);
    await expect(page.getByText(`Page 2 of 2 · ${TOTAL_MEMBERS} members`)).toBeVisible();

    // The link back drops the parameter rather than writing `members=1`.
    await page.getByRole("link", { name: "Previous page of members" }).click();
    await page.waitForURL(/\/dashboard\/members$/, { timeout: 15000 });
    await expect(membersList(page).getByRole("listitem")).toHaveCount(20);
  });

  test("a page number past the end corrects the URL instead of rendering a lie", async ({
    page,
  }) => {
    await signIn(page, ANA.email);
    await page.goto("/dashboard/members?members=99");

    await page.waitForURL(/\/dashboard\/members\?members=2$/, { timeout: 15000 });
    await expect(page.getByText(`Page 2 of 2 · ${TOTAL_MEMBERS} members`)).toBeVisible();
  });
});

test.describe("one tenant's page never shows another's", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  test("a second tenant's owner sees only their own organization", async ({ page }) => {
    await signIn(page, DIA.email);
    await page.goto("/dashboard/members");

    // Their own membership, and nothing else — `OTHER_ORG` has exactly one.
    await expect(membersList(page).getByRole("listitem")).toHaveCount(1, { timeout: 15000 });
    await expect(memberRow(page, DIA.email)).toContainText("owner");

    // None of the other tenant's people, and none of its invited addresses.
    for (const other of [ANA.email, BEN.email, CAI.email, INVITEE]) {
      await expect(page.getByText(other)).toHaveCount(0);
    }

    // They are an owner, so the invitations section is theirs to see — empty,
    // because the pending invitation belongs to the other organization.
    await expect(invitationsHeading(page)).toBeVisible();
    await expect(page.getByText("No pending invitations")).toBeVisible();
  });

  /**
   * The organization is read from the session, so naming another one in the
   * URL has to be inert. Nothing on the page takes an organization id — this
   * asserts that a plausible-looking parameter stays that way.
   */
  test("an organization id in the query string is ignored", async ({ page }) => {
    await signIn(page, DIA.email);
    await page.goto(`/dashboard/members?organizationId=${orgId(ORG.slug)}`);

    await expect(membersList(page).getByRole("listitem")).toHaveCount(1, { timeout: 15000 });
    await expect(page.getByText(ANA.email)).toHaveCount(0);
  });
});

/**
 * Dates are the one thing on this page rendered from a value rather than read
 * from one, and `toLocaleDateString(undefined, …)` asks the *runtime* for its
 * locale — of which a server-rendered page has two. The Worker answers `en-US`
 * and a British reader's browser answers `en-GB`, so React finds text it did
 * not render and throws away the server's markup for that subtree.
 *
 * **The locale here is the assertion.** Under the default `en-US` this test
 * passes against the broken implementation as surely as against the fixed one,
 * which is exactly why the original bug reached a browser before anything
 * noticed: CI's Chromium and the Worker agree. It was seen red against
 * `toLocaleDateString(undefined, …)` before `app/lib/format-date.ts` existed.
 */
test.describe("a reader outside en-US gets the same page the server rendered", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() }, locale: "en-GB" });

  test("no hydration mismatch, and the date keeps the pinned format", async ({ page }) => {
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") failures.push(message.text());
    });

    await signIn(page, ANA.email);
    await page.goto("/dashboard/members");
    await expect(memberRow(page, ANA.email)).toContainText("owner", { timeout: 15000 });

    // "Aug 15, 2026", never "15 Aug 2026" — the browser's own locale would
    // produce the second, and the server cannot know about it.
    await expect(memberRow(page, ANA.email)).toContainText(/joined [A-Z][a-z]{2} \d{1,2}, \d{4}/);

    expect(failures.filter((text) => /hydrat/i.test(text))).toEqual([]);
  });
});

/**
 * Which empty state a miss produces, and the two cases that split it.
 *
 * Better Auth's `removeMember` clears the active organization of the person
 * *doing* the removing and never of the person removed, so a removed member
 * keeps a session naming an organization they can no longer read. Keying the
 * choice on "the session named something" rather than "they still belong
 * somewhere" sends the first case below to the switcher — which has nothing in
 * it, on a page that offers no way to create one.
 *
 * Both states are written straight into D1: the UI that removes a member is
 * #37, so neither is reachable through the product inside one run.
 */
test.describe("a removed member is told which of the two things happened", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  test("removed from their only organization, they are offered a new one", async ({ page }) => {
    await signIn(page, HAL.email);
    setActiveOrganization(HAL.email, SOLE_ORG.slug);
    removeMembership(HAL.email, SOLE_ORG.slug);

    await page.goto("/dashboard/members");

    // They belong nowhere, so this is the first-run state however they got
    // here — and the control is in `<main>`, which every breakpoint reaches
    // without opening anything, the sidebar being `hidden md:block`.
    await expect(page.getByText(/create your first organization/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/not a member of this organization/i)).toHaveCount(0);
    await expect(
      page.getByRole("main").getByRole("button", { name: "Create organization" }),
    ).toBeVisible();
  });

  test("removed from one of several, they are told to switch", async ({ page }) => {
    await signIn(page, IVY.email);
    setActiveOrganization(IVY.email, LEFT_ORG.slug);
    removeMembership(IVY.email, LEFT_ORG.slug);

    await page.goto("/dashboard/members");

    // A membership remains, so "create your first" would be the wrong answer.
    await expect(page.getByText(/not a member of this organization/i)).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(/create your first organization/i)).toHaveCount(0);

    // And the roster of the organization they still belong to is *not* quietly
    // rendered in its place — the session named one, and the page says so
    // rather than guessing another.
    await expect(membersList(page)).toHaveCount(0);
    await expect(page.getByText(KEPT_ORG.name)).toHaveCount(0);
  });
});

test.describe("an account with no organization is offered one", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  test("the empty state opens the create-organization dialog", async ({ page }) => {
    await signIn(page, EWA.email);
    await page.goto("/dashboard/members");

    const create = page.getByRole("main").getByRole("button", { name: "Create organization" });
    await expect(page.getByText(/create your first organization/i)).toBeVisible({ timeout: 15000 });
    await waitForHydration(create);

    // The control works, rather than describing something that would work
    // elsewhere (issue #16).
    await create.click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});
