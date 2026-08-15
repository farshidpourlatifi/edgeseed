import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { Database } from "@starter/db";
import { generateApiToken } from "../helpers/api-token";
import {
  getPrincipal,
  principalMiddleware,
  requireInteractivePrincipal,
  requireOrganization,
  requirePrincipal,
  type ApiPrincipal,
  type PrincipalEnv,
} from "../helpers/principal";

type TokenRow = {
  id: string;
  userId: string;
  organizationId: string | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
};

/** Chainable stub that satisfies both the select and the update call shapes. */
function fakeDb(rows: TokenRow[]) {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    set: () => chain,
    update: () => chain,
    limit: () => Promise.resolve(rows),
    then: (fn: (v: unknown) => unknown) => Promise.resolve(rows).then(fn),
    catch: () => Promise.resolve(),
  });
  return chain as unknown as Database;
}

function fakeAuth(session: unknown) {
  return { api: { getSession: vi.fn().mockResolvedValue(session) } };
}

const SESSION = {
  user: { id: "user_session" },
  session: { activeOrganizationId: "org_1" },
};

function appWith(opts: { rows?: TokenRow[]; session?: unknown }) {
  const app = new Hono<PrincipalEnv>();
  app.use(async (c, next) => {
    c.set("db", fakeDb(opts.rows ?? []));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    c.set("auth", fakeAuth(opts.session ?? null) as any);
    await next();
  });
  app.use(principalMiddleware);
  app.get("/who", (c) => c.json({ principal: getPrincipal(c) }));
  app.get("/guarded", (c) => c.json({ principal: requirePrincipal(c) }));
  app.get("/org", (c) => c.json(requireOrganization(c)));
  app.get("/interactive", (c) => c.json(requireInteractivePrincipal(c)));
  app.get("/interactive-custom", (c) => c.json(requireInteractivePrincipal(c, CUSTOM_REASON)));
  return app;
}

/** What a second surface — the organization writes — refuses a token with. */
const CUSTOM_REASON = "Organization membership can only be changed from an interactive session";

const usableRow: TokenRow = {
  id: "tok_1",
  userId: "user_token",
  organizationId: "org_9",
  revokedAt: null,
  expiresAt: null,
};

async function bearer() {
  const { token } = await generateApiToken();
  return { Authorization: `Bearer ${token}` };
}

describe("principalMiddleware", () => {
  it("leaves the principal null for an anonymous request", async () => {
    const res = await appWith({}).request("/who");
    await expect(res.json()).resolves.toEqual({ principal: null });
  });

  it("resolves a session into a principal", async () => {
    const res = await appWith({ session: SESSION }).request("/who");

    await expect(res.json()).resolves.toEqual({
      principal: { userId: "user_session", organizationId: "org_1", via: "session" },
    });
  });

  it("resolves a valid bearer token into a principal", async () => {
    const res = await appWith({ rows: [usableRow] }).request("/who", { headers: await bearer() });

    await expect(res.json()).resolves.toEqual({
      principal: {
        userId: "user_token",
        organizationId: "org_9",
        via: "token",
        tokenId: "tok_1",
      },
    });
  });

  it("maps a token with no organization to a null organizationId", async () => {
    const res = await appWith({
      rows: [{ ...usableRow, organizationId: null }],
    }).request("/who", { headers: await bearer() });

    const body = (await res.json()) as { principal: ApiPrincipal };
    expect(body.principal.organizationId).toBeNull();
  });

  it("401s when the token is not in the database", async () => {
    const res = await appWith({ rows: [] }).request("/who", { headers: await bearer() });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Invalid API token" });
  });

  it("401s on a revoked token", async () => {
    const res = await appWith({
      rows: [{ ...usableRow, revokedAt: new Date("2020-01-01") }],
    }).request("/who", { headers: await bearer() });

    expect(res.status).toBe(401);
  });

  it("401s on an expired token", async () => {
    const res = await appWith({
      rows: [{ ...usableRow, expiresAt: new Date("2020-01-01") }],
    }).request("/who", { headers: await bearer() });

    expect(res.status).toBe(401);
  });

  it("401s on a malformed bearer value without touching the database", async () => {
    const rows: TokenRow[] = [usableRow];
    const db = fakeDb(rows);
    const spy = vi.spyOn(db as unknown as { select: () => unknown }, "select");

    const app = new Hono<PrincipalEnv>();
    app.use(async (c, next) => {
      c.set("db", db);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      c.set("auth", fakeAuth(null) as any);
      await next();
    });
    app.use(principalMiddleware);
    app.get("/who", (c) => c.json({ principal: getPrincipal(c) }));

    const res = await app.request("/who", { headers: { Authorization: "Bearer not-a-token" } });

    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  // The important one: a bad credential must fail loudly rather than quietly
  // downgrading to whatever cookie happens to be attached.
  it("does not fall through to session auth when the token is invalid", async () => {
    const res = await appWith({ rows: [], session: SESSION }).request("/who", {
      headers: await bearer(),
    });

    expect(res.status).toBe(401);
  });

  it("ignores a non-Bearer Authorization header and uses the session", async () => {
    const res = await appWith({ session: SESSION }).request("/who", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });

    const body = (await res.json()) as { principal: ApiPrincipal };
    expect(body.principal.via).toBe("session");
  });
});

describe("requirePrincipal", () => {
  it("returns the principal when authenticated", async () => {
    const res = await appWith({ session: SESSION }).request("/guarded");
    expect(res.status).toBe(200);
  });

  it("throws a 401 Response when anonymous", async () => {
    const res = await appWith({}).request("/guarded");

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });
});

describe("requireInteractivePrincipal", () => {
  it("lets a session through", async () => {
    const res = await appWith({ session: SESSION }).request("/interactive");
    expect(res.status).toBe(200);
  });

  it("403s a bearer token", async () => {
    const res = await appWith({ rows: [usableRow] }).request("/interactive", {
      headers: await bearer(),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "API tokens can only be managed from an interactive session",
    });
  });

  /*
   * The reason two surfaces can share one rule. Token management and membership
   * writes refuse a token for related but distinct reasons, and a call site that
   * could not say its own would have re-implemented the check — and got to pick
   * its own status while doing it.
   */
  it("carries a caller-supplied reason instead", async () => {
    const res = await appWith({ rows: [usableRow] }).request("/interactive-custom", {
      headers: await bearer(),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: CUSTOM_REASON });
  });

  it("401s when anonymous, before the credential-type check", async () => {
    const res = await appWith({}).request("/interactive-custom");

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });
});

describe("requireOrganization", () => {
  it("returns the organization when the principal has one", async () => {
    const res = await appWith({ session: SESSION }).request("/org");

    await expect(res.json()).resolves.toMatchObject({ organizationId: "org_1" });
  });

  it("403s when the principal has no active organization", async () => {
    const res = await appWith({
      rows: [{ ...usableRow, organizationId: null }],
    }).request("/org", { headers: await bearer() });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "No active organization" });
  });

  it("401s when anonymous, before any organization check", async () => {
    const res = await appWith({}).request("/org");
    expect(res.status).toBe(401);
  });
});
