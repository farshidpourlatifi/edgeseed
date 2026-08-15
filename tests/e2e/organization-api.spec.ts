import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import {
  clientIp,
  giveMembership,
  giveOrganization,
  invitationRow,
  markEmailVerified,
  memberRole,
  readInvitationId,
} from "./helpers";

/**
 * `/api/v1/organization/*` against real D1, for the one guarantee a unit test
 * cannot reach.
 *
 * Everything about the routes' ladder — credential, organization, role, target —
 * is asserted in `apps/web/server/__tests__/organization-api.test.ts` with the
 * stores mocked. What that cannot prove is the half the mocks stand in for: that
 * the `WHERE` clauses in `org-store.ts` actually scope to the caller's
 * organization. A store returning `null` because a test said so is not evidence
 * that a real member id from another tenant reads as absent.
 *
 * So this spec is narrow on purpose. It is **not** the two-user lifecycle (#40):
 * there is one reader here, a second tenant seeded beside them, and every
 * assertion is either "the rows are mine" or "somebody else's id is a 404".
 *
 * No page is driven at all. Sessions are minted through Better Auth's own
 * sign-in endpoint, which is what an API client's cookie would come from, and
 * `Origin` is sent because the CSRF guard requires a same-origin signal on every
 * unsafe method (`server/api.ts`) — Playwright's request context sends neither
 * that nor `Sec-Fetch-Site` by itself.
 */

const PASSWORD = "orgapipassword123";
const RUN = Date.now();

const user = (slug: string, name: string) => ({
  name,
  email: `e2e-api-${slug}-${RUN}@example.com`,
});

/** Owns `ORG`. Every read below is theirs. */
const ANA = user("ana", "E2E Api Ana");
/** Admin of `ORG` — the role that may invite but may not promote. */
const BEN = user("ben", "E2E Api Ben");
/** Plain member of `ORG`, and the only row this spec mutates. */
const CAI = user("cai", "E2E Api Cai");
/** Owns `OTHER_ORG` and belongs to nothing else. The second tenant. */
const DIA = user("dia", "E2E Api Dia");

/** Invited into `OTHER_ORG`, so its id is one `ANA` must not be able to spend. */
const OTHER_INVITEE = `e2e-api-fin-${RUN}@example.com`;

const ORG = { slug: `api-org-${RUN}`, name: "Api Trading" };
const OTHER_ORG = { slug: `api-other-${RUN}`, name: "Unrelated Holdings" };

/** `giveOrganization` derives both ids from the slug; restated rather than guessed. */
const orgId = (slug: string) => `e2e-org-${slug}`;
const ownerMemberId = (slug: string) => `${orgId(slug)}-member`;

/** A real membership row, in an organization the reader has nothing to do with. */
const OTHER_TENANT_MEMBER = ownerMemberId(OTHER_ORG.slug);

let otherTenantInvitation: string;

/* --------------------------------- helpers -------------------------------- */

/** The `Origin` a browser would send. Better Auth wants it, and so does the API's CSRF guard. */
const appOrigin = () => new URL(test.info().project.use.baseURL!).origin;

/**
 * Register every account through the API, then verify them in one call.
 *
 * One context and one verification call rather than one of each: every helper
 * here spawns `pnpm → wrangler → miniflare`, and `members.spec.ts` learned what
 * a per-account loop does to a 30-second hook budget. `cf-connecting-ip` varies
 * per request because `/sign-up/email` sits in the `mail` class at three a
 * minute.
 */
async function createAccounts(browser: Browser, accounts: { name: string; email: string }[]) {
  const context = await browser.newContext();

  for (const account of accounts) {
    const response = await context.request.post("/api/auth/sign-up/email", {
      data: { name: account.name, email: account.email, password: PASSWORD },
      headers: { "cf-connecting-ip": clientIp() },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }

  await context.close();
  markEmailVerified(accounts.map((account) => account.email));
}

/**
 * A request context holding `email`'s session cookie.
 *
 * Signed in through the API rather than the login form: the form is
 * `auth.spec.ts`'s subject, and what this spec needs is only the cookie an API
 * client would be carrying. `sessionDatabaseHooks` is what puts an active
 * organization on it, which is the value every route below scopes by.
 */
async function signedIn(browser: Browser, email: string): Promise<APIRequestContext> {
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

/** A write as an API client issues it, carrying the origin signal the CSRF guard checks. */
const write = (data?: unknown) => ({
  headers: { Origin: appOrigin() },
  ...(data ? { data } : {}),
});

/* ---------------------------------- setup --------------------------------- */

test.beforeAll(async ({ browser }) => {
  // Four registrations plus half a dozen wrangler spawns, none of it test work
  // the default 30s was meant to bound.
  test.setTimeout(180_000);

  await createAccounts(browser, [ANA, BEN, CAI, DIA]);

  giveOrganization(ANA.email, ORG.slug, ORG.name);
  giveMembership(BEN.email, ORG.slug, "admin");
  giveMembership(CAI.email, ORG.slug, "member");

  giveOrganization(DIA.email, OTHER_ORG.slug, OTHER_ORG.name);

  // One invitation, in the *other* tenant, minted through Better Auth's own
  // endpoint so the row is exactly what the product writes.
  const dia = await signedIn(browser, DIA.email);
  const invited = await dia.post("/api/auth/organization/invite-member", {
    data: { email: OTHER_INVITEE, role: "member", organizationId: orgId(OTHER_ORG.slug) },
    headers: { Origin: appOrigin() },
  });
  expect(invited.ok(), await invited.text()).toBe(true);

  otherTenantInvitation = readInvitationId(OTHER_INVITEE);
});

/* ---------------------------------- specs --------------------------------- */

test.describe("organization API", () => {
  // The promotion at the end changes a role the deny case above it reads.
  test.describe.configure({ mode: "serial" });

  test("reports the caller's own organization and what their role permits", async ({ browser }) => {
    const ana = await signedIn(browser, ANA.email);

    const response = await ana.get("/api/v1/organization");
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({
      id: orgId(ORG.slug),
      name: ORG.name,
      slug: ORG.slug,
      role: "owner",
    });
    expect(body.capabilities).toMatchObject({ changeRole: true, removeMember: true });
  });

  test("lists only the caller's own members", async ({ browser }) => {
    const ana = await signedIn(browser, ANA.email);

    const response = await ana.get("/api/v1/organization/members");
    expect(response.status()).toBe(200);

    const body = await response.json();
    const emails = body.members.map((member: { email: string }) => member.email);

    expect(emails).toEqual(expect.arrayContaining([ANA.email, BEN.email, CAI.email]));
    // The second tenant's owner, who exists and is a member of nothing here.
    expect(emails).not.toContain(DIA.email);
    expect(body.total).toBe(3);
  });

  test("lists only the caller's own pending invitations", async ({ browser }) => {
    const ana = await signedIn(browser, ANA.email);

    const response = await ana.get("/api/v1/organization/invitations");
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.invitations.map((row: { email: string }) => row.email)).not.toContain(
      OTHER_INVITEE,
    );
    expect(body.total).toBe(0);
  });

  /*
   * The three cases this spec exists for. Each id is real — a row that exists in
   * D1 right now — and belongs to an organization the caller is not in. Better
   * Auth would distinguish all three from "no such id"; `remove-member` would
   * even report whether that member is an owner, because its last-owner check
   * runs before it compares organizations.
   */
  test("404s a member id from another organization, and leaves the row alone", async ({
    browser,
  }) => {
    const ana = await signedIn(browser, ANA.email);

    const response = await ana.delete(
      `/api/v1/organization/members/${OTHER_TENANT_MEMBER}`,
      write(),
    );

    expect(response.status()).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Member not found" });
    expect(memberRole(DIA.email, OTHER_ORG.slug)).toBe("owner");
  });

  test("404s a role change aimed at another organization's member", async ({ browser }) => {
    const ana = await signedIn(browser, ANA.email);

    const response = await ana.patch(`/api/v1/organization/members/${OTHER_TENANT_MEMBER}`, {
      ...write({ role: "member" }),
    });

    expect(response.status()).toBe(404);
    expect(memberRole(DIA.email, OTHER_ORG.slug)).toBe("owner");
  });

  test("404s an invitation id from another organization, and leaves it pending", async ({
    browser,
  }) => {
    const ana = await signedIn(browser, ANA.email);

    const response = await ana.delete(
      `/api/v1/organization/invitations/${otherTenantInvitation}`,
      write(),
    );

    expect(response.status()).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Invitation not found" });
    expect(invitationRow(otherTenantInvitation).status).toBe("pending");
  });

  /*
   * The deny path at the endpoint rather than at a missing button — the members
   * page renders no promote control for an admin, which proves nothing about
   * what happens when one posts anyway.
   */
  test("403s an admin changing a role", async ({ browser }) => {
    const ben = await signedIn(browser, BEN.email);

    const members = await (await ben.get("/api/v1/organization/members")).json();
    const cai = members.members.find((member: { email: string }) => member.email === CAI.email);

    const response = await ben.patch(`/api/v1/organization/members/${cai.id}`, {
      ...write({ role: "admin" }),
    });

    expect(response.status()).toBe(403);
    expect(memberRole(CAI.email, ORG.slug)).toBe("member");
  });

  test("lets the owner promote, and the column moves", async ({ browser }) => {
    const ana = await signedIn(browser, ANA.email);

    const members = await (await ana.get("/api/v1/organization/members")).json();
    const cai = members.members.find((member: { email: string }) => member.email === CAI.email);

    const response = await ana.patch(`/api/v1/organization/members/${cai.id}`, {
      ...write({ role: "admin" }),
    });

    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: cai.id, role: "admin" });
    // Asserted in the database, not from the response: the write is the point.
    expect(memberRole(CAI.email, ORG.slug)).toBe("admin");
  });
});
