import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { ApiPrincipal, PrincipalEnv } from "@starter/auth";
import { apiApp } from "../api";

const SESSION_PRINCIPAL: ApiPrincipal = {
  userId: "user_1",
  organizationId: "org_1",
  via: "session",
};

const TOKEN_PRINCIPAL: ApiPrincipal = {
  userId: "user_1",
  organizationId: "org_1",
  via: "token",
  tokenId: "tok_1",
};

const store = vi.hoisted(() => ({
  listApiTokens: vi.fn(),
  createApiToken: vi.fn(),
  revokeApiToken: vi.fn(),
}));

vi.mock("@starter/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@starter/auth")>()),
  ...store,
}));

/** Mount the real API with a pre-set principal, skipping the middleware. */
function appWith(principal: ApiPrincipal | null) {
  const app = new Hono<PrincipalEnv>();
  app.use(async (c, next) => {
    c.set("db", {} as never);
    c.set("principal", principal);
    await next();
  });
  app.route("/", apiApp);
  return app;
}

const json = { "content-type": "application/json" };

describe("GET /me", () => {
  it("reports a session principal", async () => {
    const res = await appWith(SESSION_PRINCIPAL).request("/me");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      userId: "user_1",
      organizationId: "org_1",
      via: "session",
    });
  });

  it("reports a token principal without leaking the token id", async () => {
    const res = await appWith(TOKEN_PRINCIPAL).request("/me");

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.via).toBe("token");
    expect(body).not.toHaveProperty("tokenId");
  });

  it("401s when anonymous", async () => {
    const res = await appWith(null).request("/me");
    expect(res.status).toBe(401);
  });
});

describe("token management is session-only", () => {
  // A token that can mint tokens outlives revocation of the one that leaked.
  it.each([
    ["GET", "/tokens", undefined],
    ["POST", "/tokens", JSON.stringify({ name: "ci" })],
    ["DELETE", "/tokens/tok_9", undefined],
  ])("403s %s %s when authenticated by token", async (method, path, body) => {
    const res = await appWith(TOKEN_PRINCIPAL).request(path, {
      method,
      ...(body ? { body, headers: json } : {}),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "API tokens can only be managed from an interactive session",
    });
  });

  it.each([
    ["GET", "/tokens", undefined],
    ["POST", "/tokens", JSON.stringify({ name: "ci" })],
    ["DELETE", "/tokens/tok_9", undefined],
  ])("401s %s %s when anonymous", async (method, path, body) => {
    const res = await appWith(null).request(path, {
      method,
      ...(body ? { body, headers: json } : {}),
    });

    expect(res.status).toBe(401);
  });
});

describe("POST /tokens", () => {
  it("returns the plaintext exactly once, alongside the summary", async () => {
    store.createApiToken.mockResolvedValue({
      id: "tok_new",
      name: "ci",
      prefix: "sk_abcd1234",
      lastUsedAt: null,
      expiresAt: null,
      createdAt: "2026-08-04T00:00:00.000Z",
      token: "sk_the-actual-secret",
    });

    const res = await appWith(SESSION_PRINCIPAL).request("/tokens", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ name: "ci" }),
    });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      id: "tok_new",
      token: "sk_the-actual-secret",
    });
  });

  it("scopes the new token to the caller, not to request input", async () => {
    store.createApiToken.mockResolvedValue({
      id: "t",
      name: "ci",
      prefix: "sk_x",
      lastUsedAt: null,
      expiresAt: null,
      createdAt: "2026-08-04T00:00:00.000Z",
      token: "sk_y",
    });

    await appWith(SESSION_PRINCIPAL).request("/tokens", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ name: "ci", userId: "attacker", organizationId: "org_evil" }),
    });

    expect(store.createApiToken).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "user_1", organizationId: "org_1" }),
    );
  });

  const invalidBodies: Array<[Record<string, unknown>, string]> = [
    [{}, "missing name"],
    [{ name: "" }, "empty name"],
    [{ name: "x".repeat(101) }, "name too long"],
    [{ name: "ci", expiresInDays: 0 }, "zero expiry"],
    [{ name: "ci", expiresInDays: -1 }, "negative expiry"],
    [{ name: "ci", expiresInDays: 400 }, "expiry beyond a year"],
    [{ name: "ci", expiresInDays: 1.5 }, "fractional expiry"],
  ];

  it.each(invalidBodies)("400s on invalid input (%s)", async (body) => {
    const res = await appWith(SESSION_PRINCIPAL).request("/tokens", {
      method: "POST",
      headers: json,
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(400);
  });
});

describe("GET /tokens", () => {
  it("lists the caller's tokens and never exposes a hash or plaintext", async () => {
    store.listApiTokens.mockResolvedValue([
      {
        id: "tok_1",
        name: "ci",
        prefix: "sk_abcd1234",
        lastUsedAt: null,
        expiresAt: null,
        createdAt: "2026-08-04T00:00:00.000Z",
      },
    ]);

    const res = await appWith(SESSION_PRINCIPAL).request("/tokens");
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(JSON.parse(text).tokens).toHaveLength(1);
    expect(text).not.toMatch(/tokenHash|"token"/);
  });

  it("asks the store only for the caller's own tokens", async () => {
    store.listApiTokens.mockResolvedValue([]);
    await appWith(SESSION_PRINCIPAL).request("/tokens");

    expect(store.listApiTokens).toHaveBeenCalledWith(expect.anything(), "user_1");
  });
});

describe("DELETE /tokens/{id}", () => {
  it("revokes and reports success", async () => {
    store.revokeApiToken.mockResolvedValue(true);

    const res = await appWith(SESSION_PRINCIPAL).request("/tokens/tok_1", { method: "DELETE" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ revoked: true });
  });

  it("404s when the token is absent, already revoked, or someone else's", async () => {
    store.revokeApiToken.mockResolvedValue(false);

    const res = await appWith(SESSION_PRINCIPAL).request("/tokens/tok_other", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
  });

  it("always scopes the revoke to the caller", async () => {
    store.revokeApiToken.mockResolvedValue(true);
    await appWith(SESSION_PRINCIPAL).request("/tokens/tok_1", { method: "DELETE" });

    expect(store.revokeApiToken).toHaveBeenCalledWith(expect.anything(), {
      userId: "user_1",
      id: "tok_1",
    });
  });
});
