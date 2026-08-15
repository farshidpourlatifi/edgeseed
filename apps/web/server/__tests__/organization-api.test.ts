import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { ApiPrincipal, PrincipalEnv } from "@starter/auth";
import { OWNER_MUST_BE_PROMOTED } from "@starter/auth/roles";
import { RATE_LIMIT_RULES } from "@starter/auth/rate-limit";
import { createFakeEnv } from "@starter/testing/fake-env";
import { createFakeRateLimiter } from "@starter/testing/fake-rate-limit";
import { PAGE_SIZE } from "../../app/lib/pagination";
import { apiApp } from "../api";

/**
 * `/api/v1/organization/*`, exercised through the real `apiApp` so the
 * default-deny guard and the CSRF check are part of every case rather than
 * assumed.
 *
 * The **stores are mocked and `can()` is not**: what these tests are for is the
 * ladder each route walks — credential, then organization, then role, then
 * target — and the role rung has to be judged by the real `ORG_CAPABILITIES`,
 * or a matrix change would leave the suite green while the API stopped agreeing
 * with the members page.
 *
 * The queries the stores run are proven in `tests/e2e/organization-api.spec.ts`
 * against real D1, which is where the cross-tenant 404 stops being a mock
 * returning `null` and starts being a `WHERE` clause.
 */

const store = vi.hoisted(() => ({
  getOrganizationForMember: vi.fn(),
  listOrganizationMembers: vi.fn(),
  listPendingInvitations: vi.fn(),
  findOrganizationMember: vi.fn(),
  findPendingInvitation: vi.fn(),
}));

vi.mock("@starter/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@starter/auth")>()),
  ...store,
}));

const ORG = "org_1";

const SESSION: ApiPrincipal = { userId: "user_1", organizationId: ORG, via: "session" };
const TOKEN: ApiPrincipal = {
  userId: "user_1",
  organizationId: ORG,
  via: "token",
  tokenId: "tok_1",
};
/** A credential that names no organization at all — a token minted before one existed. */
const NO_ORG: ApiPrincipal = { userId: "user_1", organizationId: null, via: "session" };

const ORGANIZATION = {
  id: ORG,
  name: "Members Trading",
  slug: "members-trading",
  logo: null,
  createdAt: "2026-08-01T00:00:00.000Z",
};

const MEMBER_ROW = {
  id: "mem_1",
  userId: "user_2",
  name: "Ben",
  email: "ben@example.com",
  role: "member",
  createdAt: "2026-08-02T00:00:00.000Z",
};

const INVITATION_ROW = {
  id: "inv_1",
  email: "fin@example.com",
  role: "member",
  expiresAt: "2026-08-20T00:00:00.000Z",
  createdAt: "2026-08-13T00:00:00.000Z",
};

/** What a browser sends on a same-origin non-GET request; the CSRF guard checks it. */
const sameOrigin = { "sec-fetch-site": "same-origin" };
const json = { "content-type": "application/json", ...sameOrigin };

const auth = {
  api: {
    createInvitation: vi.fn(),
    cancelInvitation: vi.fn(),
    updateMemberRole: vi.fn(),
    removeMember: vi.fn(),
  },
};

/** Mount the real API with a pre-set principal, skipping `principalMiddleware`. */
function appWith(principal: ApiPrincipal | null) {
  const app = new Hono<PrincipalEnv>();
  app.use(async (c, next) => {
    c.set("db", {} as never);
    c.set("auth", auth as never);
    c.set("principal", principal);
    await next();
  });
  app.route("/", apiApp);
  return app;
}

/**
 * A request carrying a Worker env, which these routes need: the invite and the
 * three other writes charge a rate-limit binding themselves, read through
 * `parseEnv`. Unlimited unless a test says otherwise.
 */
function request(
  principal: ApiPrincipal | null,
  path: string,
  init?: RequestInit,
  env: Record<string, unknown> = createFakeEnv(),
) {
  return appWith(principal).request(path, init, env);
}

/**
 * Better Auth's refusal, shaped the way its own `isAPIError` recognises.
 *
 * **`statusCode` is required, and that is a scar.** It defaulted to 400, so the
 * invite-as-owner case below asserted a status the hook does not throw:
 * `beforeCreateInvitation` raises `APIError("FORBIDDEN", …)` because 403 is the
 * only status a hook can use, and the route mapped 400 alone — so the real path
 * answered 500 with the test green. A mock with a convenient default is a test
 * that agrees with itself.
 */
function apiError(code: string, statusCode: number) {
  return Object.assign(new Error(code), { name: "APIError", statusCode, body: { code } });
}

/** What Better Auth's own `APIError.from("FORBIDDEN", …)` and `("BAD_REQUEST", …)` produce. */
const FORBIDDEN = 403;
const BAD_REQUEST = 400;

beforeEach(() => {
  vi.clearAllMocks();

  store.getOrganizationForMember.mockResolvedValue({ organization: ORGANIZATION, role: "owner" });
  store.listOrganizationMembers.mockResolvedValue({ rows: [MEMBER_ROW], total: 1 });
  store.listPendingInvitations.mockResolvedValue({ rows: [INVITATION_ROW], total: 1 });
  store.findOrganizationMember.mockResolvedValue({ id: "mem_1", userId: "user_2", role: "member" });
  store.findPendingInvitation.mockResolvedValue(INVITATION_ROW);

  auth.api.createInvitation.mockResolvedValue({
    id: "inv_new",
    email: "fin@example.com",
    role: "member",
    expiresAt: new Date("2026-08-22T00:00:00.000Z"),
    createdAt: new Date("2026-08-15T00:00:00.000Z"),
  });
  auth.api.cancelInvitation.mockResolvedValue({});
  auth.api.updateMemberRole.mockResolvedValue({});
  auth.api.removeMember.mockResolvedValue({});
});

/* -------------------------------------------------------------------------- */

describe("GET /organization", () => {
  it("reports the active organization and the caller's role", async () => {
    const res = await request(SESSION, "/organization");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ...ORGANIZATION, role: "owner" });
  });

  it("derives capabilities from the role rather than the caller's word for it", async () => {
    store.getOrganizationForMember.mockResolvedValue({ organization: ORGANIZATION, role: "admin" });

    const body = (await (await request(SESSION, "/organization")).json()) as {
      capabilities: Record<string, boolean>;
    };

    // The matrix itself: admin invites and revokes, owner alone changes roles.
    expect(body.capabilities).toMatchObject({
      invite: true,
      revokeInvitation: true,
      readInvitations: true,
      changeRole: false,
      removeMember: false,
      leave: true,
    });
  });

  it("answers a bearer token — reads are not session-only", async () => {
    expect((await request(TOKEN, "/organization")).status).toBe(200);
  });

  it("401s when anonymous", async () => {
    expect((await request(null, "/organization")).status).toBe(401);
  });

  it("403s a credential that names no organization", async () => {
    const res = await request(NO_ORG, "/organization");

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "No active organization" });
  });

  /*
   * The case the membership lookup exists for. `removeMember` clears the
   * *remover's* session and never the removed member's, and a token's
   * organization is stamped once at creation — so both credentials outlive the
   * membership they name.
   */
  it("403s when the credential names an organization the caller is no longer in", async () => {
    store.getOrganizationForMember.mockResolvedValue(null);

    const res = await request(SESSION, "/organization");

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "You are not a member of this organization",
    });
  });

  it("never reads the organization from the request", async () => {
    await request(SESSION, "/organization?organizationId=org_evil");

    expect(store.getOrganizationForMember).toHaveBeenCalledWith(expect.anything(), {
      userId: "user_1",
      organizationId: ORG,
    });
  });
});

describe("GET /organization/members", () => {
  it("returns one page and the unfiltered total", async () => {
    const res = await request(SESSION, "/organization/members");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ members: [MEMBER_ROW], total: 1 });
  });

  it("defaults to the page size the members page reads under", async () => {
    await request(SESSION, "/organization/members");

    expect(store.listOrganizationMembers).toHaveBeenCalledWith(expect.anything(), {
      userId: "user_1",
      organizationId: ORG,
      limit: PAGE_SIZE,
      offset: 0,
    });
  });

  it("passes an explicit window through", async () => {
    await request(SESSION, "/organization/members?limit=5&offset=40");

    expect(store.listOrganizationMembers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 5, offset: 40 }),
    );
  });

  const badWindows: Array<[string, string]> = [
    [`limit=${PAGE_SIZE + 1}`, "above the cap"],
    ["limit=0", "zero rows"],
    ["limit=-1", "negative limit"],
    ["limit=2.5", "fractional limit"],
    ["offset=-1", "negative offset"],
    ["limit=all", "not a number"],
  ];

  // The bound is a cost decision — D1 bills rows scanned — so a caller cannot
  // opt out of it, and a bad window is refused rather than clamped silently.
  it.each(badWindows)("400s on ?%s (%s)", async (query) => {
    expect((await request(SESSION, `/organization/members?${query}`)).status).toBe(400);
  });

  it("answers a bearer token", async () => {
    expect((await request(TOKEN, "/organization/members")).status).toBe(200);
  });

  it("401s when anonymous", async () => {
    expect((await request(null, "/organization/members")).status).toBe(401);
  });

  it("403s when the credential names an organization the caller is not in", async () => {
    store.getOrganizationForMember.mockResolvedValue(null);
    expect((await request(SESSION, "/organization/members")).status).toBe(403);
  });
});

describe("GET /organization/invitations", () => {
  it.each(["owner", "admin"])("lists them for %s", async (role) => {
    store.getOrganizationForMember.mockResolvedValue({ organization: ORGANIZATION, role });

    const res = await request(SESSION, "/organization/invitations");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ invitations: [INVITATION_ROW], total: 1 });
  });

  /*
   * Not an empty list — a refusal. The rows carry addresses nobody else in the
   * organization has seen, which is what `readInvitations` is a capability of
   * its own for (#36).
   */
  it("403s a plain member, and reads nothing", async () => {
    store.getOrganizationForMember.mockResolvedValue({
      organization: ORGANIZATION,
      role: "member",
    });

    const res = await request(SESSION, "/organization/invitations");

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Your role does not permit this" });
    expect(store.listPendingInvitations).not.toHaveBeenCalled();
  });

  it("401s when anonymous", async () => {
    expect((await request(null, "/organization/invitations")).status).toBe(401);
  });
});

describe("POST /organization/invitations", () => {
  const invite = (principal: ApiPrincipal | null, body: unknown, env?: Record<string, unknown>) =>
    request(
      principal,
      "/organization/invitations",
      { method: "POST", headers: json, body: JSON.stringify(body) },
      env,
    );

  it("creates one and reports it", async () => {
    const res = await invite(SESSION, { email: "fin@example.com", role: "member" });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      id: "inv_new",
      email: "fin@example.com",
      role: "member",
      expiresAt: "2026-08-22T00:00:00.000Z",
      createdAt: "2026-08-15T00:00:00.000Z",
    });
  });

  it("scopes the invitation to the caller's organization, not to request input", async () => {
    await invite(SESSION, {
      email: "fin@example.com",
      role: "member",
      organizationId: "org_evil",
    });

    expect(auth.api.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ organizationId: ORG, email: "fin@example.com" }),
      }),
    );
  });

  it("passes resend through — the same endpoint, not a second path", async () => {
    await invite(SESSION, { email: "fin@example.com", role: "member", resend: true });

    expect(auth.api.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ resend: true }) }),
    );
  });

  it.each(["admin", "owner"])("lets %s invite", async (role) => {
    store.getOrganizationForMember.mockResolvedValue({ organization: ORGANIZATION, role });
    expect((await invite(SESSION, { email: "fin@example.com", role: "member" })).status).toBe(201);
  });

  it("403s a plain member, and sends nothing", async () => {
    store.getOrganizationForMember.mockResolvedValue({
      organization: ORGANIZATION,
      role: "member",
    });

    expect((await invite(SESSION, { email: "fin@example.com", role: "member" })).status).toBe(403);
    expect(auth.api.createInvitation).not.toHaveBeenCalled();
  });

  it("403s a bearer token, with the membership sentence", async () => {
    const res = await invite(TOKEN, { email: "fin@example.com", role: "member" });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Organization membership can only be changed from an interactive session",
    });
    expect(auth.api.createInvitation).not.toHaveBeenCalled();
  });

  it("401s when anonymous", async () => {
    expect((await invite(null, { email: "fin@example.com", role: "member" })).status).toBe(401);
  });

  const invalidBodies: Array<[Record<string, unknown>, string]> = [
    [{ role: "member" }, "no email"],
    [{ email: "not-an-address", role: "member" }, "not an email"],
    [{ email: "fin@example.com" }, "no role"],
    [{ email: "fin@example.com", role: "superuser" }, "unknown role"],
  ];

  it.each(invalidBodies)("400s on invalid input (%s)", async (body) => {
    expect((await invite(SESSION, body)).status).toBe(400);
  });

  /*
   * `owner` passes validation on purpose and is refused by the hook that owns
   * the rule, so the caller hears *why* rather than a bare validation error.
   * Nobody is invited as an owner — that is a promotion.
   *
   * **The hook throws 403, not 400**, because `FORBIDDEN` is the only status an
   * `organizationHooks` rule can raise with — `packages/auth/src/organization.ts`,
   * and `tests/e2e/member-actions.spec.ts` asserts the browser sees exactly that.
   * Mapping 400 alone made this a 500 on the API while this test passed against
   * a mock of its own invention.
   */
  it("reports the invite-as-owner refusal, which the hook raises as 403", async () => {
    auth.api.createInvitation.mockRejectedValue(apiError(OWNER_MUST_BE_PROMOTED, FORBIDDEN));

    const res = await invite(SESSION, { email: "fin@example.com", role: "owner" });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "The organization refused that change.",
      code: OWNER_MUST_BE_PROMOTED,
    });
  });

  /*
   * The other half of that distinction, and why the fix is a code set rather
   * than "map every 403". Better Auth's own permission refusal can only be
   * reached here if `can()` and `ORGANIZATION_ROLES` disagree — a bug in this
   * repo. Reporting it to the caller would blame them for it and hide it from
   * Sentry, so it escapes as a 500 with a correlation id.
   */
  it("does not dress up a permission 403 as the caller's fault", async () => {
    auth.api.createInvitation.mockRejectedValue(
      apiError("YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION", FORBIDDEN),
    );

    const res = await invite(SESSION, { email: "fin@example.com", role: "member" });

    expect(res.status).toBe(500);
  });

  it("passes better-auth's other refusals through by code", async () => {
    auth.api.createInvitation.mockRejectedValue(
      apiError("USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION", BAD_REQUEST),
    );

    const res = await invite(SESSION, { email: "ben@example.com", role: "member" });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      code: "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION",
    });
  });

  /*
   * The whole reason this route touches a limiter at all: `auth.api.*` bypasses
   * better-auth's own, which lives in its HTTP router hook. Without the charge
   * below, `mail` would be enforced on the browser's invite and unenforced one
   * path over.
   */
  it("charges the mail limiter and refuses past it", async () => {
    const mail = createFakeRateLimiter(1);
    const env = createFakeEnv({ RATE_LIMIT_MAIL: mail });
    const body = { email: "fin@example.com", role: "member" };

    expect((await invite(SESSION, body, env)).status).toBe(201);

    const refused = await invite(SESSION, body, env);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe(String(RATE_LIMIT_RULES.mail.window));

    // Only the first one reached better-auth.
    expect(auth.api.createInvitation).toHaveBeenCalledTimes(1);
  });

  // The same key better-auth builds for its own endpoint, so the browser and
  // the API draw on one budget per address rather than one each.
  it("keys the charge on the client address and better-auth's own path", async () => {
    const mail = createFakeRateLimiter();
    await invite(
      SESSION,
      { email: "fin@example.com", role: "member" },
      createFakeEnv({
        RATE_LIMIT_MAIL: mail,
      }),
    );

    expect(mail.keys).toEqual(["no-trusted-ip|/organization/invite-member"]);
  });

  it("keys on cf-connecting-ip when the edge supplied one", async () => {
    const mail = createFakeRateLimiter();
    await request(
      SESSION,
      "/organization/invitations",
      {
        method: "POST",
        headers: { ...json, "cf-connecting-ip": "203.0.113.7" },
        body: JSON.stringify({ email: "fin@example.com", role: "member" }),
      },
      createFakeEnv({ RATE_LIMIT_MAIL: mail }),
    );

    expect(mail.keys).toEqual(["203.0.113.7|/organization/invite-member"]);
  });
});

/**
 * The three writes that are not invite.
 *
 * They sit in the loose `default` class rather than `mail`, which makes it
 * tempting to leave them untested — and that is exactly how the charge would
 * come to be deleted without anything failing. `auth.api.*` bypasses Better
 * Auth's own limiter, so these calls are the only thing bounding a membership
 * write that arrives through the API rather than the browser.
 */
const DEFAULT_CLASS_WRITES: Array<{
  label: string;
  path: string;
  init: RequestInit;
  /** The Better Auth path the charge is keyed under — its bucket, shared with the browser. */
  limitPath: string;
  delegate: ReturnType<typeof vi.fn>;
}> = [
  {
    label: "revoking an invitation",
    path: "/organization/invitations/inv_1",
    init: { method: "DELETE", headers: sameOrigin },
    limitPath: "/organization/cancel-invitation",
    delegate: auth.api.cancelInvitation,
  },
  {
    label: "changing a role",
    path: "/organization/members/mem_1",
    init: { method: "PATCH", headers: json, body: JSON.stringify({ role: "admin" }) },
    limitPath: "/organization/update-member-role",
    delegate: auth.api.updateMemberRole,
  },
  {
    label: "removing a member",
    path: "/organization/members/mem_1",
    init: { method: "DELETE", headers: sameOrigin },
    limitPath: "/organization/remove-member",
    delegate: auth.api.removeMember,
  },
];

describe("every write charges the limiter, not just invite", () => {
  it.each(DEFAULT_CLASS_WRITES)(
    "429s $label on an empty bucket, and writes nothing",
    async (write) => {
      const limiter = createFakeRateLimiter(0);

      const res = await request(
        SESSION,
        write.path,
        write.init,
        createFakeEnv({ RATE_LIMIT_DEFAULT: limiter }),
      );

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe(String(RATE_LIMIT_RULES.default.window));
      expect(write.delegate).not.toHaveBeenCalled();
    },
  );

  // The same key better-auth builds for its own endpoint, so a membership write
  // draws on one budget per address whichever door it came through.
  it.each(DEFAULT_CLASS_WRITES)("keys $label under its Better Auth path", async (write) => {
    const limiter = createFakeRateLimiter();

    await request(SESSION, write.path, write.init, createFakeEnv({ RATE_LIMIT_DEFAULT: limiter }));

    expect(limiter.keys).toEqual([`no-trusted-ip|${write.limitPath}`]);
  });

  /*
   * The ordering, pinned as a decision rather than left as an accident. The
   * charge happens after the target is resolved, so a request that is about to
   * 404 costs a member nothing — one stale page id cannot throttle the writes
   * they are entitled to make.
   */
  it("does not charge for a target outside the caller's organization", async () => {
    store.findOrganizationMember.mockResolvedValue(null);
    const limiter = createFakeRateLimiter();

    const res = await request(
      SESSION,
      "/organization/members/mem_other_tenant",
      { method: "DELETE", headers: sameOrigin },
      createFakeEnv({ RATE_LIMIT_DEFAULT: limiter }),
    );

    expect(res.status).toBe(404);
    expect(limiter.keys).toEqual([]);
  });
});

describe("DELETE /organization/invitations/{id}", () => {
  const revoke = (principal: ApiPrincipal | null, id = "inv_1") =>
    request(principal, `/organization/invitations/${id}`, {
      method: "DELETE",
      headers: sameOrigin,
    });

  it("withdraws it", async () => {
    const res = await revoke(SESSION);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ revoked: true });
  });

  it("cancels the row it resolved, never the id as it arrived", async () => {
    await revoke(SESSION, "inv_1");

    expect(store.findPendingInvitation).toHaveBeenCalledWith(expect.anything(), {
      userId: "user_1",
      organizationId: ORG,
      invitationId: "inv_1",
    });
    expect(auth.api.cancelInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ body: { invitationId: "inv_1" } }),
    );
  });

  /*
   * Another tenant's invitation and one that never existed are the same answer.
   * Better Auth distinguishes them — it resolves the id globally and then fails
   * on the *membership* lookup — which is why the target is resolved here first.
   */
  it("404s an invitation that is not in this organization, and cancels nothing", async () => {
    store.findPendingInvitation.mockResolvedValue(null);

    const res = await revoke(SESSION, "inv_other_tenant");

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Invitation not found" });
    expect(auth.api.cancelInvitation).not.toHaveBeenCalled();
  });

  it("403s a plain member", async () => {
    store.getOrganizationForMember.mockResolvedValue({
      organization: ORGANIZATION,
      role: "member",
    });

    expect((await revoke(SESSION)).status).toBe(403);
    expect(auth.api.cancelInvitation).not.toHaveBeenCalled();
  });

  it("403s a bearer token", async () => {
    const res = await revoke(TOKEN);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Organization membership can only be changed from an interactive session",
    });
  });

  it("401s when anonymous", async () => {
    expect((await revoke(null)).status).toBe(401);
  });

  it("403s a session write with no origin signal", async () => {
    const res = await request(SESSION, "/organization/invitations/inv_1", { method: "DELETE" });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Cross-origin request refused" });
  });
});

describe("PATCH /organization/members/{id}", () => {
  const changeRole = (principal: ApiPrincipal | null, role = "admin", id = "mem_1") =>
    request(principal, `/organization/members/${id}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ role }),
    });

  it("promotes and reports the new role", async () => {
    const res = await changeRole(SESSION, "admin");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: "mem_1", userId: "user_2", role: "admin" });
  });

  it("sends the resolved membership id and the caller's organization", async () => {
    await changeRole(SESSION, "admin");

    expect(auth.api.updateMemberRole).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { memberId: "mem_1", role: "admin", organizationId: ORG },
      }),
    );
  });

  it("404s a member of another organization, and changes nothing", async () => {
    store.findOrganizationMember.mockResolvedValue(null);

    const res = await changeRole(SESSION, "admin", "mem_other_tenant");

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Member not found" });
    expect(auth.api.updateMemberRole).not.toHaveBeenCalled();
  });

  // Owner-only — stricter than better-auth's stock `adminAc`, which grants
  // `member: ["update", "delete"]`.
  it.each(["admin", "member"])("403s %s", async (role) => {
    store.getOrganizationForMember.mockResolvedValue({ organization: ORGANIZATION, role });

    expect((await changeRole(SESSION, "admin")).status).toBe(403);
    expect(auth.api.updateMemberRole).not.toHaveBeenCalled();
  });

  it("403s a bearer token", async () => {
    expect((await changeRole(TOKEN)).status).toBe(403);
  });

  it("401s when anonymous", async () => {
    expect((await changeRole(null)).status).toBe(401);
  });

  it("400s an unknown role", async () => {
    expect((await changeRole(SESSION, "superuser")).status).toBe(400);
  });

  // The last owner is better-auth's rule, at the moment of the write.
  it("reports the last-owner refusal by code", async () => {
    auth.api.updateMemberRole.mockRejectedValue(
      apiError("YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER", BAD_REQUEST),
    );

    const res = await changeRole(SESSION, "member");

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      code: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER",
    });
  });
});

describe("DELETE /organization/members/{id}", () => {
  const remove = (principal: ApiPrincipal | null, id = "mem_1") =>
    request(principal, `/organization/members/${id}`, { method: "DELETE", headers: sameOrigin });

  it("removes them", async () => {
    const res = await remove(SESSION);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ removed: true });
  });

  it("removes the row it resolved, addressed by id rather than by email", async () => {
    await remove(SESSION);

    expect(auth.api.removeMember).toHaveBeenCalledWith(
      expect.objectContaining({ body: { memberIdOrEmail: "mem_1", organizationId: ORG } }),
    );
  });

  /*
   * The oracle this route exists to close. Better Auth runs its last-owner check
   * *before* comparing organizations, so a foreign id can come back
   * "you cannot leave as the only owner" — which reports whether an id the
   * caller does not own belongs to an owner.
   */
  it("404s a member of another organization, and removes nothing", async () => {
    store.findOrganizationMember.mockResolvedValue(null);

    const res = await remove(SESSION, "mem_other_tenant");

    expect(res.status).toBe(404);
    expect(auth.api.removeMember).not.toHaveBeenCalled();
  });

  it.each(["admin", "member"])("403s %s", async (role) => {
    store.getOrganizationForMember.mockResolvedValue({ organization: ORGANIZATION, role });

    expect((await remove(SESSION)).status).toBe(403);
    expect(auth.api.removeMember).not.toHaveBeenCalled();
  });

  it("403s a bearer token", async () => {
    expect((await remove(TOKEN)).status).toBe(403);
  });

  it("401s when anonymous", async () => {
    expect((await remove(null)).status).toBe(401);
  });
});
