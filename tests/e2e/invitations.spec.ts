import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { INVITATION_PARAM, invitationAcceptPath } from "../../apps/web/app/lib/auth-redirects";
import {
  clientIp,
  expireInvitation,
  giveOrganization,
  markEmailVerified,
  membershipCount,
  readInvitationId,
  revokeInvitation,
  waitForHydration,
} from "./helpers";

/**
 * Organization invitations, end to end — issue #35.
 *
 * The link is built from **`invitationAcceptPath`**, never from a literal. That
 * is what makes this a coupling check rather than a decoration: the invitation
 * email is minted from the same constant inside `createAuth`, so if it and the
 * `accept-invitation` entry in `routes.ts` ever disagree, production mail points
 * at the branded 404 — and so does every walk below, which then fails on the
 * missing accept button. Hard-coding the path here would let exactly that drift
 * through, which is how the reset flow's equivalent bug survived review once.
 *
 * The invitation **id** is read out of the local D1, the same seam
 * `readPasswordResetToken` uses and for the same reason: with no
 * `RESEND_API_KEY` the message only reaches the dev server's log, which
 * Playwright cannot read. Taking the id from the invite call's response instead
 * would be a back door no real invitee has.
 *
 * **Every describe carries its own client address**, and no describe mints more
 * than three invitations. `/organization/invite-member` sits in the strict
 * `mail` class — three per minute per IP+path — and this file creates eight.
 * Sign-ups are charged separately, since the limiter keys on `${ip}|${path}`,
 * but each account is still created behind an address of its own.
 *
 * **Each invitation goes to an address that is not yet in the target
 * organization.** Better Auth refuses a second invitation to an existing member
 * (`USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION`), so a user who accepts in
 * one block cannot be the subject of another.
 */

const PASSWORD = "invitationpassword123";
const RUN = Date.now();

const user = (slug: string, name: string) => ({
  name,
  email: `e2e-inv-${slug}-${RUN}@example.com`,
});

/** Owns `ORG` and sends most of the invitations below. */
const OWNER = user("owner", "E2E Invite Owner");
/** Owns `OTHER_ORG`, so tenant isolation has a second tenant to isolate from. */
const OTHER_OWNER = user("other-owner", "E2E Other Owner");
/** Accepts, in the happy path. Also owns `OWN_ORG` — see that block for why. */
const JOINER = user("joiner", "E2E Joiner");
/** Arrives signed out and is carried through `/login`. */
const LOGIN_USER = user("login", "E2E Login Invitee");
/** Registers through the UI during its own test, so it is not created up front. */
const NEWCOMER = user("newcomer", "E2E Newcomer");
const EXPIRED_USER = user("expired", "E2E Expired Invitee");
const REVOKED_USER = user("revoked", "E2E Revoked Invitee");
/** Signed in, and the recipient of nothing. Every deny path is driven from here. */
const BYSTANDER = user("bystander", "E2E Bystander");

const ORG = { slug: `invite-org-${RUN}`, name: "Invitation Trading" };
const OTHER_ORG = { slug: `other-org-${RUN}`, name: "Unrelated Industries" };
/** `JOINER`'s own organization, seeded before they accept anything. */
const OWN_ORG = { slug: `own-org-${RUN}`, name: "Joiner Holdings" };

/** `giveOrganization` derives the row id from the slug; restated rather than guessed. */
const orgId = (slug: string) => `e2e-org-${slug}`;

/* --------------------------------- helpers -------------------------------- */

const sidebar = (page: Page) => page.getByRole("complementary");

/** The heading each dead-end state renders — `AuthNotice` puts its title in an `<h2>`. */
const DEAD = "This invitation is no longer valid";
const WRONG_ACCOUNT = "This invitation is for a different account";

/**
 * Create a verified account through the API, behind an address of its own.
 *
 * The registration *form* is covered by `auth.spec.ts` and, for the invitation
 * round trip specifically, by the sign-up block below — everything else here
 * only needs the account to exist, and a UI registration per user would spend
 * most of the file's wall-clock on scenery. `context.request` shares the
 * context's `baseURL` and headers, so the `cf-connecting-ip` still applies.
 */
async function createAccount(browser: Browser, account: { name: string; email: string }) {
  const context = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": clientIp() },
  });

  const response = await context.request.post("/api/auth/sign-up/email", {
    data: { name: account.name, email: account.email, password: PASSWORD },
  });
  expect(response.ok(), await response.text()).toBe(true);

  // No session was minted — `requireEmailVerification` withholds it — so the
  // column is flipped the same way every other spec does it.
  markEmailVerified(account.email);
  await context.close();
}

/**
 * The `Origin` a browser would send, which Playwright's API context does not.
 *
 * Better Auth's `validateOrigin` runs **only when the request carries a
 * cookie** (`api/middlewares/origin-check.mjs`: `if (!(forceValidate ||
 * useCookies)) return`), so an anonymous sign-in passes without one and every
 * session-authenticated call after it answers `403 MISSING_OR_NULL_ORIGIN`.
 * Sending it is not routing around the check — it is sending what the real
 * client sends, and it keeps these calls on the same path the UI takes.
 *
 * Read from the project config rather than restated, since `baseURL` is pinned
 * to `localhost` there for a reason `playwright.config.ts` explains.
 */
const appOrigin = () => new URL(test.info().project.use.baseURL!).origin;

/** Sign in through the API, so this context's cookie jar can act as that user. */
async function apiSignIn(request: APIRequestContext, email: string) {
  const response = await request.post("/api/auth/sign-in/email", {
    data: { email, password: PASSWORD },
    headers: { Origin: appOrigin() },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

/**
 * Mint an invitation the way the product does: through Better Auth's own
 * session-authenticated endpoint, which is exactly what the invite dialog
 * calls. This file is about what happens to the *link* afterwards, so it skips
 * the form rather than re-testing it — `member-actions.spec.ts` drives that.
 *
 * `organizationId` is passed explicitly so the call names its target rather
 * than inheriting whichever organization the session happens to be in — since
 * #36 a session starts in the caller's first one, and this file signs accounts
 * in that own more than one. `role` is passed because `baseInvitationSchema`
 * requires it: "the Better Auth default" is a value this call has to state, not
 * one it can omit.
 */
async function invite(request: APIRequestContext, email: string, organizationSlug: string) {
  const response = await request.post("/api/auth/organization/invite-member", {
    data: { email, role: "member", organizationId: orgId(organizationSlug) },
    headers: { Origin: appOrigin() },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return readInvitationId(email);
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

test.beforeAll(async ({ browser }) => {
  for (const account of [
    OWNER,
    OTHER_OWNER,
    JOINER,
    LOGIN_USER,
    EXPIRED_USER,
    REVOKED_USER,
    BYSTANDER,
  ]) {
    await createAccount(browser, account);
  }

  giveOrganization(OWNER.email, ORG.slug, ORG.name);
  giveOrganization(OTHER_OWNER.email, OTHER_ORG.slug, OTHER_ORG.name);
  // Seeded **before** anything is accepted, so it is first in
  // `listOrganizations` and therefore what the switcher falls back to.
  giveOrganization(JOINER.email, OWN_ORG.slug, OWN_ORG.name);
});

/* ---------------------------------- specs --------------------------------- */

test.describe("an invited teammate joins the organization", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  let invitationId: string;

  test("a signed-in invitee accepts, and the new organization becomes active", async ({
    page,
    request,
  }) => {
    await apiSignIn(request, OWNER.email);
    invitationId = await invite(request, JOINER.email, ORG.slug);

    await signIn(page, JOINER.email);
    await page.goto(invitationAcceptPath(invitationId));

    await expect(page.getByRole("heading", { name: `Join ${ORG.name}` })).toBeVisible({
      timeout: 15000,
    });
    // Who sent it, so an unexpected invitation is recognisable as one.
    await expect(page.getByText(OWNER.email)).toBeVisible();

    await page.getByRole("button", { name: "Accept invitation" }).click();
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    /**
     * The stronger half of "and set that org active". This account already
     * owned `OWN_ORG`, seeded first — so the session hook made *that* one
     * active when they signed in, and the switcher renders whatever the
     * session says with no fallback of its own (#36). Seeing the joined
     * organization here therefore means the active id actually moved, which is
     * better-auth's own `setActiveOrganization` running — and why nothing in
     * the app calls `setActive` after accepting.
     */
    const switcher = sidebar(page).getByRole("button", { name: new RegExp(ORG.name) });
    await expect(switcher).toBeVisible({ timeout: 15000 });

    // Persisted, not merely rendered: a reload re-reads the active id from the
    // session row in D1.
    await page.reload();
    await expect(switcher).toBeVisible({ timeout: 15000 });
  });

  /**
   * Deny path: a reused invitation. Better Auth flips `status` to `accepted`
   * and refuses anything but `pending`, so a second visit is a dead end rather
   * than a second membership.
   */
  test("the same invitation cannot be accepted twice", async ({ page }) => {
    const before = membershipCount(JOINER.email);

    await signIn(page, JOINER.email);
    await page.goto(invitationAcceptPath(invitationId));

    await expect(page.getByRole("heading", { name: DEAD })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);

    expect(membershipCount(JOINER.email)).toBe(before);
  });

  /** The same refusal at the endpoint — the vector a screen-only check misses. */
  test("a direct POST with the spent invitation is refused", async ({ request }) => {
    await apiSignIn(request, JOINER.email);
    const before = membershipCount(JOINER.email);

    const response = await request.post("/api/auth/organization/accept-invitation", {
      data: { invitationId },
      headers: { Origin: appOrigin() },
    });

    expect(response.status()).toBe(400);
    expect(membershipCount(JOINER.email)).toBe(before);
  });
});

test.describe("a signed-out invitee is carried through sign-in and back", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  test("the invitation survives the round trip to /login", async ({ page, request }) => {
    await apiSignIn(request, OWNER.email);
    const invitationId = await invite(request, LOGIN_USER.email, ORG.slug);

    // Signed out, straight from a mailbox. This is the whole reason the loader
    // does not call `requireUser`: a redirect to /login would lose the id.
    await page.goto(invitationAcceptPath(invitationId));

    await expect(
      page.getByRole("heading", { name: "You have been invited to a team" }),
    ).toBeVisible({ timeout: 15000 });
    // Nothing about the organization is disclosed to an anonymous caller —
    // everything past this screen comes from better-auth's recipient check.
    await expect(page.getByText(ORG.name)).toHaveCount(0);

    await page.getByRole("link", { name: "Sign in" }).click();
    await page.waitForURL(`**/login?${INVITATION_PARAM}=${invitationId}`, { timeout: 15000 });

    const field = page.getByRole("textbox", { name: "Email", exact: true });
    await waitForHydration(field);
    await field.fill(LOGIN_USER.email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign In" }).click();

    // Back where they started, rather than at /dashboard.
    await page.waitForURL(`**${invitationAcceptPath(invitationId)}`, { timeout: 15000 });
    await expect(page.getByRole("heading", { name: `Join ${ORG.name}` })).toBeVisible({
      timeout: 15000,
    });

    await page.getByRole("button", { name: "Accept invitation" }).click();
    await page.waitForURL("**/dashboard", { timeout: 15000 });
  });
});

test.describe("an invitee with no account is carried through sign-up", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  /**
   * The register leg stops where the mailbox does. Sign-up mints no session —
   * `requireEmailVerification` withholds it — so the reader's next step is the
   * emailed verification link, whose `callbackURL` is the invitation. Nothing
   * driving a browser can follow that link, since it only reaches the dev
   * server's log. So this asserts the two halves that *are* reachable: the
   * invitation survives into `/register`, and it survives the sign-in that
   * follows verification. `packages/auth`'s unit tests cover the third.
   */
  test("the invitation survives the round trip to /register", async ({ page, request }) => {
    await apiSignIn(request, OWNER.email);
    const invitationId = await invite(request, NEWCOMER.email, ORG.slug);

    await page.goto(invitationAcceptPath(invitationId));
    await page.getByRole("link", { name: "Sign up" }).click();
    await page.waitForURL(`**/register?${INVITATION_PARAM}=${invitationId}`, { timeout: 15000 });

    const name = page.getByRole("textbox", { name: "Name", exact: true });
    await expect(page.getByRole("button", { name: "Create Account" })).toBeVisible({
      timeout: 15000,
    });
    await waitForHydration(name);

    await name.fill(NEWCOMER.name);
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(NEWCOMER.email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Create Account" }).click();

    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
      timeout: 15000,
    });
    // Still carried, on the one link out of this screen.
    await expect(page.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
      "href",
      `/login?${INVITATION_PARAM}=${invitationId}`,
    );

    markEmailVerified(NEWCOMER.email);
    await page.getByRole("link", { name: "Back to sign in" }).click();

    const field = page.getByRole("textbox", { name: "Email", exact: true });
    await waitForHydration(field);
    await field.fill(NEWCOMER.email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign In" }).click();

    await page.waitForURL(`**${invitationAcceptPath(invitationId)}`, { timeout: 15000 });
    await expect(page.getByRole("heading", { name: `Join ${ORG.name}` })).toBeVisible({
      timeout: 15000,
    });
  });
});

test.describe("an invitation that can no longer be used", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  /**
   * **The expiry case below is the repo's reference fixture time-travel test**
   * — the template for the retention and timeline tests arriving with #21, and
   * an instance of the convention in `docs/adr/004-time-and-timezones.md`:
   * behaviour that depends on time is tested by moving the *data's* timestamps,
   * never the world's clock, which this runtime does not let anything set.
   * `tests/e2e/CLAUDE.md` has the pattern in full.
   *
   * It was checked the way that section demands: with `expiresAt` moved a day
   * into the future the invitation is live, the accept form renders, and this
   * assertion fails — so it really does key on the seeded expiry rather than
   * passing for the same reason the mangled-link case does.
   *
   * Expiry and revocation are written into D1 directly — the window is seven
   * days, and revoking through the UI would spend a describe on scenery for a
   * state one `UPDATE` reaches. The refusal is entirely better-auth's either
   * way: it re-reads `expiresAt` and `status` on every call, so the screen
   * under test is the one production produces.
   *
   * Both are driven as the **real recipient**, not as a bystander. Better Auth
   * checks the invitation's state before the address, so a stranger would see
   * this same screen — and the test would then pass for the wrong reason.
   */
  test("an expired invitation is a dead end, not a form", async ({ page, request }) => {
    await apiSignIn(request, OWNER.email);
    const invitationId = await invite(request, EXPIRED_USER.email, ORG.slug);
    expireInvitation(invitationId);

    await signIn(page, EXPIRED_USER.email);
    await page.goto(invitationAcceptPath(invitationId));

    await expect(page.getByRole("heading", { name: DEAD })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);
  });

  test("a revoked invitation is the same dead end", async ({ page, request }) => {
    await apiSignIn(request, OWNER.email);
    const invitationId = await invite(request, REVOKED_USER.email, ORG.slug);
    revokeInvitation(invitationId);

    await signIn(page, REVOKED_USER.email);
    await page.goto(invitationAcceptPath(invitationId));

    await expect(page.getByRole("heading", { name: DEAD })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);

    // The deny half of the link rule above: a revoked invitation has nothing to
    // come back to, so the way out must **not** offer a round trip to it.
    await expect(
      page.getByRole("link", { name: "Sign in with a different account" }),
    ).toHaveAttribute("href", "/login");
  });

  /** A mangled link — `?id=` with nothing after it — must not render a form either. */
  test("a link with no invitation id is a dead end", async ({ page }) => {
    await signIn(page, BYSTANDER.email);
    await page.goto("/accept-invitation?id=");

    await expect(page.getByRole("heading", { name: DEAD })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);
  });
});

test.describe("an invitation cannot be taken by the wrong account", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  /** Addressed to nobody in particular — an invitation needs no existing account. */
  const stranger = () =>
    `e2e-inv-stranger-${RUN}-${Math.random().toString(36).slice(2, 8)}@example.com`;

  /**
   * The deny path the whole flow rests on. Anyone can hold the link — it
   * travels by email, and email gets forwarded — so the recipient check is the
   * only thing between a forwarded invitation and a stranger in the
   * organization.
   */
  test("a signed-in user whose address does not match cannot accept", async ({ page, request }) => {
    await apiSignIn(request, OWNER.email);
    const invitationId = await invite(request, stranger(), ORG.slug);

    await signIn(page, BYSTANDER.email);
    const before = membershipCount(BYSTANDER.email);

    await page.goto(invitationAcceptPath(invitationId));

    await expect(page.getByRole("heading", { name: WRONG_ACCOUNT })).toBeVisible({
      timeout: 15000,
    });
    // Names the signed-in address, so the reader can see *which* account is the
    // problem — the whole reason this is not folded into the dead-link state.
    await expect(page.getByText(BYSTANDER.email)).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);

    /**
     * The way out has to carry the invitation. This screen tells the reader to
     * sign in as somebody else, and the invitation is still **pending** the
     * whole time — a bare `/login` here drops it, so they do exactly as asked,
     * land on `/dashboard`, and have to go back to their mailbox for a link
     * that never stopped working.
     */
    await expect(
      page.getByRole("link", { name: "Sign in with a different account" }),
    ).toHaveAttribute("href", `/login?${INVITATION_PARAM}=${invitationId}`);

    expect(membershipCount(BYSTANDER.email)).toBe(before);
  });

  test("a direct POST from the wrong account is refused, and creates no membership", async ({
    request,
  }) => {
    await apiSignIn(request, OWNER.email);
    const invitationId = await invite(request, stranger(), ORG.slug);

    await apiSignIn(request, BYSTANDER.email);
    const before = membershipCount(BYSTANDER.email);

    const response = await request.post("/api/auth/organization/accept-invitation", {
      data: { invitationId },
      headers: { Origin: appOrigin() },
    });

    expect(response.status()).toBe(403);
    expect(membershipCount(BYSTANDER.email)).toBe(before);
  });
});

test.describe("an invitation into another tenant stays there", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  /**
   * Tenant isolation, stated as its own case rather than folded into the
   * mismatch above: this invitation belongs to an organization the caller has
   * nothing to do with and cannot see, and holding its id must not be a way in.
   *
   * Better Auth reduces both cases to the recipient check, which is exactly the
   * property worth pinning — if that check were ever relaxed to "any signed-in
   * member may accept", this is the test that goes red.
   */
  test("a member of one organization cannot accept another tenant's invitation", async ({
    page,
    request,
  }) => {
    await apiSignIn(request, OTHER_OWNER.email);
    const invitationId = await invite(
      request,
      `e2e-inv-other-recipient-${RUN}@example.com`,
      OTHER_ORG.slug,
    );

    await signIn(page, BYSTANDER.email);
    const before = membershipCount(BYSTANDER.email);

    await page.goto(invitationAcceptPath(invitationId));

    await expect(page.getByRole("heading", { name: WRONG_ACCOUNT })).toBeVisible({
      timeout: 15000,
    });
    // The other tenant's name is never rendered to a non-recipient.
    await expect(page.getByText(OTHER_ORG.name)).toHaveCount(0);

    expect(membershipCount(BYSTANDER.email)).toBe(before);
  });
});
